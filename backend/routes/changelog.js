// Changelog feed. Served from the same host as the update yml so the
// companion never crosses origins.
//
// Add a release entry by appending to backend/data/changelog.json:
//   { "id": <next int>, "version": "<string | null>", "date": "YYYY-MM-DD",
//     "tag": "new" | "better" | "fix", "text": "<one-line>" }
// Highest id wins "newest" — ordering in the file is for human reading.
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const FILE = path.join(__dirname, '..', 'data', 'changelog.json');

// Simple in-memory cache with mtime-based bust so pushing a new
// changelog entry doesn't require a backend restart.
let cache = null;
let cacheMtime = 0;
function readEntries() {
  try {
    const st = fs.statSync(FILE);
    const mtime = st.mtimeMs;
    if (cache && mtime === cacheMtime) return cache;
    const raw = fs.readFileSync(FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('changelog.json is not an array');
    // Sort newest first by id. Anything missing an id is dropped.
    const sorted = data.filter(e => Number.isFinite(e?.id))
                       .sort((a, b) => b.id - a.id);
    cache = sorted; cacheMtime = mtime;
    return sorted;
  } catch (err) {
    console.error('[changelog] read failed:', err.message);
    return [];
  }
}

// GET /api/changelog
// Optional query:
//   ?since=<id>   — only entries with id > since
//   ?limit=<n>    — cap entries returned (default 50, max 200)
router.get('/', (req, res) => {
  const since = Number(req.query.since);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const all = readEntries();
  const filtered = Number.isFinite(since)
    ? all.filter(e => e.id > since)
    : all;
  res.set('Cache-Control', 'public, max-age=30');
  res.json({
    entries: filtered.slice(0, limit),
    newestId: all.length > 0 ? all[0].id : 0,
    hasMore: filtered.length > limit,
  });
});

module.exports = router;
