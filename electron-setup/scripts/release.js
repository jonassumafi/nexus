// Publish the built installer to the release server.
//
// Usage (from electron-setup/, after `npm run build`):
//   npm run release              upload dist/<exe> + dist/udp.yml
//   npm run release -- --prune   also delete installers older than the
//                                previous one (keeps current + 1 rollback)
//
// Steps: upload both files into <dir>/.incoming/, verify the exe's
// sha512 on the server, then move the exe into place before udp.yml, so
// installed apps are never told about a file that isn't there yet.
// Finally checks the public URL serves the new udp.yml.
//
// Config (env vars, defaults in brackets):
//   NEXUS_RELEASE_HOST  [kylo-mini@100.84.108.15]   ssh target
//   NEXUS_RELEASE_DIR   [nexus/backend/releases]    relative to ~ on the host
//   NEXUS_RELEASE_URL   [https://nexus-missions.space/api/releases/]
// Needs key-based ssh to the host (ssh/scp ship with Windows 10+).

const fs     = require('fs');
const path   = require('path');
const child  = require('child_process');
const crypto = require('crypto');

const ROOT  = path.resolve(__dirname, '..');
const DIST  = path.join(ROOT, 'dist');
const HOST  = process.env.NEXUS_RELEASE_HOST || 'kylo-mini@100.84.108.15';
const DIR   = (process.env.NEXUS_RELEASE_DIR || 'nexus/backend/releases').replace(/\/+$/, '');
const URL_  = (process.env.NEXUS_RELEASE_URL || 'https://nexus-missions.space/api/releases/').replace(/\/?$/, '/');
const PRUNE = process.argv.includes('--prune');
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];

function fail(msg) { console.error('\n✗ ' + msg); process.exit(1); }
function step(msg) { console.log('\n▶ ' + msg); }
function sh(q) { return "'" + String(q).replace(/'/g, "'\\''") + "'"; } // POSIX single-quote
function ssh(cmd, { capture = false } = {}) {
  const r = child.spawnSync('ssh', [...SSH_OPTS, HOST, cmd], { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (r.error) fail('could not run ssh: ' + r.error.message);
  if (r.status !== 0) fail('ssh command failed (exit ' + r.status + '): ' + cmd + (capture ? '\n' + (r.stderr || '') : ''));
  return (r.stdout || '').trim();
}

// ── What to publish ───────────────────────────────────────────────────
const ymlPath = path.join(DIST, 'udp.yml');
if (!fs.existsSync(ymlPath)) fail('dist/udp.yml not found — run `npm run build` first');
const yml     = fs.readFileSync(ymlPath, 'utf8');
const version = (yml.match(/^version:\s*(\S+)/m) || [])[1];
const exeName = (yml.match(/^path:\s*(.+?)\s*$/m) || [])[1];
const exePath = exeName && path.join(DIST, exeName);
if (!version || !exeName) fail('could not read version/path from dist/udp.yml');
if (!fs.existsSync(exePath)) fail('dist/' + exeName + ' not found (udp.yml points at it)');
const localHex = crypto.createHash('sha512').update(fs.readFileSync(exePath)).digest('hex');
const ymlB64   = (yml.match(/^sha512:\s*(\S+)/m) || [])[1];
if (Buffer.from(localHex, 'hex').toString('base64') !== ymlB64) fail('dist/udp.yml sha512 does not match ' + exeName + ' — rebuild');

console.log(`Publishing ${exeName} (v${version}, ${(fs.statSync(exePath).size / 1048576).toFixed(0)} MB) → ${HOST}:~/${DIR}/`);

// ── Upload to staging ─────────────────────────────────────────────────
const INCOMING = DIR + '/.incoming';
step('Preparing ' + INCOMING);
ssh(`mkdir -p ${sh(INCOMING)} && rm -f ${sh(INCOMING)}/*`);

step('Uploading (this takes a minute)');
const up = child.spawnSync('scp', [...SSH_OPTS, exePath, ymlPath, `${HOST}:${INCOMING}/`], { stdio: 'inherit' });
if (up.error) fail('could not run scp: ' + up.error.message);
if (up.status !== 0) fail('upload failed (scp exit ' + up.status + '); nothing was published');

step('Verifying checksum on the server');
const remoteHex = ssh(`sha512sum ${sh(INCOMING + '/' + exeName)} | cut -d' ' -f1`, { capture: true });
if (remoteHex !== localHex) fail('checksum mismatch after upload; nothing was published (staged copy left in .incoming)');
console.log('  sha512 matches');

// ── Go live: exe first, then the manifest ─────────────────────────────
step('Publishing');
ssh(`cd ${sh(DIR)} && mv -f .incoming/${sh(exeName)} . && mv -f .incoming/udp.yml udp.yml && rmdir .incoming`);
console.log('  live: ' + exeName + ' + udp.yml');

// ── Optional cleanup ──────────────────────────────────────────────────
// Keep the newest two "Nexus UDP Setup <ver>.exe" (current + rollback).
const listing = ssh(`cd ${sh(DIR)} && ls -1 -- 'Nexus UDP Setup '*.exe 2>/dev/null || true`, { capture: true })
  .split('\n').map(s => s.trim()).filter(Boolean);
const verOf = n => (n.match(/Setup (\d+)\.(\d+)\.(\d+)\.exe$/) || []).slice(1).map(Number);
const sorted = listing.filter(n => verOf(n).length === 3)
  .sort((a, b) => { const x = verOf(a), y = verOf(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; });
const old = sorted.slice(2);
if (old.length) {
  if (PRUNE) {
    step('Pruning old installers (keeping ' + sorted.slice(0, 2).join(', ') + ')');
    ssh(`cd ${sh(DIR)} && rm -f -- ${old.map(sh).join(' ')}`);
    old.forEach(n => console.log('  deleted ' + n));
  } else {
    console.log('\n  Older installers still on the server (run with --prune to delete): ' + old.join(', '));
  }
}

// ── Check the public URL ──────────────────────────────────────────────
step('Checking ' + URL_ + 'udp.yml');
fetch(URL_ + 'udp.yml?cb=' + Date.now(), { cache: 'no-store' })
  .then(r => r.text())
  .then(text => {
    const live = (text.match(/^version:\s*(\S+)/m) || [])[1];
    if (live !== version) fail('server says version ' + live + ', expected ' + version + ' (cache? check the backend route)');
    console.log(`\n✓ v${version} is live. Installed apps will offer it on their next update check.`);
  })
  .catch(err => fail('could not reach ' + URL_ + ': ' + err.message));
