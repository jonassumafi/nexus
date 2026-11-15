// Changelog feed. Served from the same host as the update yml so the
// companion never crosses origins.
//
// Schema (per row):
//   { id, date, version|null, dev, text|null, commit? }
//
// Record flow:
//   1. The pre-migrated backend/data/changelog.json carries historical
//      curated player-facing text for 31 rows (ids 133..163). It is the
//      source of truth for anything already shipped.
//   2. Going forward, commits add a trailing `Changelog: <sentence>`
//      line in their message. At runtime the route scans `git log` and,
//      for any commit whose hash is not already pinned to a JSON row,
//      it synthesises a row from that trailer. If no trailer is present
//      `text` is null and the row never shows to players.
//   3. If `.git` is unavailable (e.g. inside a built installer), fall
//      back to the JSON file alone.
//
// Why this hybrid instead of the pure "commit count as id" preferred
// form:
//   - Existing ids (133..163) are curated and already stored in players'
//     localStorage as `nexus_last_seen_changelog_id`. Renumbering from
//     commit count would renumber everything and lose seen-bookkeeping.
//   - No historic commit has a `Changelog:` trailer, so a pure-git
//     stream would have `text: null` for everything shipped so far.
//
// GET /api/changelog returns:
//   { entries: [... up to 5 text-having rows, newest first],
//     newestId: <highest id across the whole stream> }
//
// Optional query:
//   ?since=<id>   — only text-having rows with id > since
//   ?limit=<n>    — cap entries returned (default 5, max 200)

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const router = express.Router();
const FILE = path.join(__dirname, '..', 'data', 'changelog.json');

// ─── JSON file read (mtime-cached) ───────────────────────────────────
let jsonCache = null;
let jsonCacheMtime = 0;
function readJsonEntries() {
  try {
    const st = fs.statSync(FILE);
    const mtime = st.mtimeMs;
    if (jsonCache && mtime === jsonCacheMtime) return jsonCache;
    const raw = fs.readFileSync(FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('changelog.json is not an array');
    // Normalise. Legacy `tag` is silently dropped.
    const normalised = data
      .filter(e => Number.isFinite(e?.id))
      .map(e => ({
        id: e.id,
        date: e.date,
        version: e.version ?? null,
        dev: e.dev != null ? e.dev : (e.text != null ? e.text : ''),
        text: e.text ?? null,
        commit: e.commit || null,
      }));
    jsonCache = normalised;
    jsonCacheMtime = mtime;
    return normalised;
  } catch (err) {
    console.error('[changelog] json read failed:', err.message);
    return [];
  }
}

// ─── Git log scan (10 s memory cache) ─────────────────────────────────
// Walk up from backend/ until .git is found. If it isn't, GIT_ROOT
// stays null and the route falls through to pure-JSON mode.
function findGitRoot() {
  let dir = path.join(__dirname, '..', '..');
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
const GIT_ROOT = findGitRoot();

let gitCache = null;
let gitCacheTs = 0;
const GIT_TTL_MS = 10 * 1000;
function readGitCommits() {
  if (!GIT_ROOT) return [];
  const now = Date.now();
  if (gitCache && (now - gitCacheTs) < GIT_TTL_MS) return gitCache;
  try {
    // Fields separated by \x1f, records by \x1e so bodies with newlines
    // survive. Oldest → newest after reverse.
    const out = execFileSync('git', [
      'log',
      '--pretty=format:%H%x1f%ad%x1f%s%x1f%b%x1e',
      '--date=short',
    ], { cwd: GIT_ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    const records = out.split('\x1e').map(r => r.trim()).filter(Boolean);
    records.reverse();
    const commits = records.map(rec => {
      const [hash, date, subject, body] = rec.split('\x1f');
      // Scan subject + body for the last `Changelog: <sentence>` line.
      const full = `${subject || ''}\n${body || ''}`;
      const lines = full.split('\n').map(l => l.trim()).filter(Boolean);
      let text = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = lines[i].match(/^Changelog:\s*(.+)$/);
        if (m) { text = m[1].trim(); break; }
      }
      return { hash, date, subject: subject || '', text };
    });
    gitCache = commits;
    gitCacheTs = now;
    return commits;
  } catch (err) {
    console.error('[changelog] git read failed:', err.message);
    gitCache = [];
    gitCacheTs = now;
    return [];
  }
}

// ─── Merge strategy ──────────────────────────────────────────────────
// 1. JSON rows are the baseline (keep their ids 133..163).
// 2. For each git commit, if its hash matches a JSON row's `commit`
//    field, the JSON row is left alone (no duplicate synthesis).
// 3. For any commit whose hash is NOT already pinned to a JSON row AND
//    which has a `Changelog:` trailer, a row is synthesised with
//    id = (max existing id) + 1 + its position past the last pinned
//    commit, so ids are stable per commit.
// 4. Commits without a trailer are ignored for the player stream but
//    still available as `dev`-only rows for future tooling if needed.
// Resulting stream is sorted newest-first by id.
function buildStream() {
  const json = readJsonEntries();
  const commits = readGitCommits();

  const byCommit = new Map();
  for (const row of json) if (row.commit) byCommit.set(row.commit, row);

  const maxId = json.reduce((m, r) => Math.max(m, r.id), 0);
  const extras = [];
  let nextId = maxId + 1;
  for (const c of commits) {
    if (byCommit.has(c.hash)) continue;
    if (!c.text) continue;
    extras.push({
      id: nextId++,
      date: c.date,
      version: null,
      dev: c.subject,
      text: c.text,
      commit: c.hash,
    });
  }
  const all = [...json, ...extras];
  all.sort((a, b) => b.id - a.id);
  return all;
}

// ─── Route ────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const since = Number(req.query.since);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 5));
  const all = buildStream();
  // Only rows with non-null `text` are player-visible.
  const visible = all.filter(e => e.text != null);
  const filtered = Number.isFinite(since)
    ? visible.filter(e => e.id > since)
    : visible;
  const newestId = all.length > 0 ? all[0].id : 0;
  res.set('Cache-Control', 'public, max-age=30');
  res.json({
    entries: filtered.slice(0, limit),
    newestId,
    hasMore: filtered.length > limit,
  });
});

module.exports = router;
