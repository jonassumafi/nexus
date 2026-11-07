// Keeps frontend/dist/landing.html's hard-coded fallbacks in lockstep
// with whatever newest "Nexus Setup X.Y.Z.exe" sits in backend/releases/.
//
// The landing page already fetches /api/release-info/latest on load,
// so visitors with JS enabled always see the current version. The
// static HTML also carries a baked-in href + version + size for three
// reasons:
//   1. If the backend is reachable but the JSON fetch is somehow
//      blocked (corporate proxy, extension), the baked-in link still
//      points at the right file.
//   2. Search engines / preview cards read the static HTML.
//   3. "View source" doesn't lie about the current version.
//
// Trigger points: backend startup, and any time backend/releases/
// changes (new .exe dropped in, old one removed).

const fs = require('fs');
const path = require('path');

const DIST_HTML = path.join(__dirname, '..', '..', 'frontend', 'dist', 'landing.html');
const RELEASES_DIR = path.join(__dirname, '..', 'releases');
const PATTERN = /^Nexus Setup (\d+)\.(\d+)\.(\d+)\.exe$/;

function cmpSemver(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function findLatest() {
  let best = null;
  for (const name of fs.readdirSync(RELEASES_DIR)) {
    const m = PATTERN.exec(name);
    if (!m) continue;
    const parts = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!best || cmpSemver(parts, best.parts) > 0) best = { parts, name };
  }
  if (!best) return null;
  const st = fs.statSync(path.join(RELEASES_DIR, best.name));
  return {
    version: best.parts.join('.'),
    filename: best.name,
    url: `/api/releases/${encodeURIComponent(best.name)}`,
    sizeMB: Math.round(st.size / (1024 * 1024)),
  };
}

function rewrite(html, info) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1. Every <a ... href="/api/releases/....exe" ...> swaps to the new url.
  let out = html.replace(
    /href="\/api\/releases\/[^"]*\.exe"/g,
    `href="${info.url}"`,
  );

  // 2. Any <span data-dl-version>X</span> span body.
  out = out.replace(
    /(<span data-dl-version>)[^<]*(<\/span>)/g,
    `$1${info.version}$2`,
  );

  // 3. Any <span data-dl-size>N</span> span body.
  out = out.replace(
    /(<span data-dl-size>)[^<]*(<\/span>)/g,
    `$1${info.sizeMB}$2`,
  );

  // 4. The JS fallback literal on one line:
  //    var DL={version:"...",filename:"...",url:"...",sizeMB:...};
  out = out.replace(
    /var DL=\{[^}]*\};/,
    `var DL={version:"${info.version}",filename:${JSON.stringify(info.filename)},url:"${info.url}",sizeMB:${info.sizeMB}};`,
  );

  return out;
}

function syncLandingHtml() {
  try {
    const info = findLatest();
    if (!info) { console.warn('[landingHtml] no Nexus Setup .exe in releases/; skipping'); return; }
    if (!fs.existsSync(DIST_HTML)) {
      console.warn('[landingHtml] dist/landing.html not found; run vite build first');
      return;
    }
    const before = fs.readFileSync(DIST_HTML, 'utf8');
    const after = rewrite(before, info);
    if (after === before) return;
    fs.writeFileSync(DIST_HTML, after, 'utf8');
    console.log(`[landingHtml] synced dist/landing.html → ${info.filename}`);
  } catch (err) {
    console.error('[landingHtml] sync failed:', err.message);
  }
}

// Watches the releases dir and re-runs on any change (debounced).
function watchReleases() {
  try {
    let timer = null;
    fs.watch(RELEASES_DIR, { persistent: false }, () => {
      clearTimeout(timer);
      timer = setTimeout(syncLandingHtml, 500);
    });
  } catch (err) {
    console.warn('[landingHtml] fs.watch failed:', err.message);
  }
}

module.exports = { syncLandingHtml, watchReleases };
