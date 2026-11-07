// Discovers the newest "Nexus Setup X.Y.Z.exe" sitting in
// backend/releases/ so the website landing page can fill its own
// Download button without a manual edit on every build.
//
// Shape: { version, filename, url, sizeBytes, sizeMB }
// The route caches the lookup by directory mtime so dropping a new
// .exe into releases/ is picked up without a backend restart.
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const DIR = path.join(__dirname, '..', 'releases');
const PATTERN = /^Nexus Setup (\d+)\.(\d+)\.(\d+)\.exe$/;

let cache = null;
let cacheMtime = 0;

function cmpSemver(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function scan() {
  try {
    const st = fs.statSync(DIR);
    if (cache && st.mtimeMs === cacheMtime) return cache;
    const entries = fs.readdirSync(DIR);
    let best = null;
    for (const name of entries) {
      const m = PATTERN.exec(name);
      if (!m) continue;
      const parts = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!best || cmpSemver(parts, best.parts) > 0) {
        best = { parts, name };
      }
    }
    if (!best) { cache = null; cacheMtime = st.mtimeMs; return null; }
    const filePath = path.join(DIR, best.name);
    const fst = fs.statSync(filePath);
    cache = {
      version: best.parts.join('.'),
      filename: best.name,
      url: `/api/releases/${encodeURIComponent(best.name)}`,
      sizeBytes: fst.size,
      sizeMB: Math.round(fst.size / (1024 * 1024)),
    };
    cacheMtime = st.mtimeMs;
    return cache;
  } catch (err) {
    console.error('[releaseInfo] scan failed:', err.message);
    return null;
  }
}

router.get('/latest', (req, res) => {
  const info = scan();
  res.set('Cache-Control', 'public, max-age=60');
  if (!info) return res.status(404).json({ error: 'no release found' });
  res.json(info);
});

module.exports = router;
