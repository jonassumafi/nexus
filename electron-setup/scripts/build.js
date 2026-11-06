// One-shot build: builds the companion as an unpacked directory, zips
// it into payload/nexus-companion.zip, writes payload/manifest.json,
// then packages the setup exe via electron-builder. Finally emits a
// latest-udp.yml next to the exe so electron-updater keeps working.
//
// Usage: npm run build (from electron-setup/).

const fs      = require('fs');
const path    = require('path');
const child   = require('child_process');
const crypto  = require('crypto');
const AdmZip  = require('adm-zip');

const ROOT          = path.resolve(__dirname, '..');
const REPO          = path.resolve(ROOT, '..');
const COMPANION     = path.join(REPO, 'electron');
const PAYLOAD_DIR   = path.join(ROOT, 'payload');
const DIST_DIR      = path.join(ROOT, 'dist');
const UNPACKED_SRC  = path.join(COMPANION, 'dist', 'win-unpacked');
const COMPANION_PKG = require(path.join(COMPANION, 'package.json'));
const SETUP_PKG     = require(path.join(ROOT, 'package.json'));

function log(step) { console.log('\n▶ ' + step); }
function run(cmd, args, opts) {
  log(cmd + ' ' + args.join(' '));
  const r = child.spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) { console.error('✗ failed: ' + cmd + ' ' + args.join(' ')); process.exit(r.status || 1); }
}
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function rimraf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }
function sha512OfFile(p) {
  const h = crypto.createHash('sha512');
  h.update(fs.readFileSync(p));
  return h.digest('base64');
}

// 1) Build the companion as an unpacked dir with the UDP config.
log('Building companion (electron-builder --dir)');
run('npx', [
  '--yes', 'electron-builder@25.1.8',
  '--win', 'dir',
  '--config', 'electron-builder.udp.yml',
], { cwd: COMPANION });

if (!fs.existsSync(UNPACKED_SRC)) {
  console.error('✗ expected unpacked output at ' + UNPACKED_SRC);
  process.exit(1);
}

// 2) Zip the unpacked directory into payload/
log('Zipping companion payload');
mkdirp(PAYLOAD_DIR);
const zipPath = path.join(PAYLOAD_DIR, 'nexus-companion.zip');
rimraf(zipPath);
const zip = new AdmZip();
zip.addLocalFolder(UNPACKED_SRC);
zip.writeZip(zipPath);

// 3) Find the companion exe name inside the unpacked dir.
const exeMatch = fs.readdirSync(UNPACKED_SRC).find(n => n.toLowerCase().endsWith('.exe'));
const exeName  = exeMatch || 'Nexus Companion UDP.exe';

// 4) Write manifest.json so the installer knows what it's carrying.
const size = fs.statSync(zipPath).size;
const manifest = {
  productName: 'Nexus Companion UDP',
  version:     COMPANION_PKG.version,
  exeName,
  size,
  sha512:      sha512OfFile(zipPath),
  builtAt:     new Date().toISOString(),
};
fs.writeFileSync(path.join(PAYLOAD_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 5) Bump setup package.json to match companion version (keeps versions aligned).
if (SETUP_PKG.version !== COMPANION_PKG.version) {
  log('Aligning setup version → ' + COMPANION_PKG.version);
  SETUP_PKG.version = COMPANION_PKG.version;
  fs.writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify(SETUP_PKG, null, 2) + '\n');
}

// 6) Package the setup exe.
log('Packaging Nexus Setup installer');
rimraf(DIST_DIR);
run('npx', [
  '--yes', 'electron-builder@25.1.8',
  '--win',
  '--config', 'electron-builder.yml',
], { cwd: ROOT });

// 7) Emit latest-udp.yml so electron-updater handoff keeps working.
log('Emitting latest-udp.yml');
const setupExe = fs.readdirSync(DIST_DIR).find(n => n.startsWith('Nexus UDP Setup ') && n.endsWith('.exe'));
if (!setupExe) {
  console.error('✗ installer exe not found in ' + DIST_DIR);
  process.exit(1);
}
const setupPath = path.join(DIST_DIR, setupExe);
const setupSize = fs.statSync(setupPath).size;
const setupHash = sha512OfFile(setupPath);
const yml = [
  'version: ' + COMPANION_PKG.version,
  'files:',
  '  - url: ' + setupExe,
  '    sha512: ' + setupHash,
  '    size: ' + setupSize,
  'path: ' + setupExe,
  'sha512: ' + setupHash,
  'releaseDate: ' + new Date().toISOString(),
  '',
].join('\n');
fs.writeFileSync(path.join(DIST_DIR, 'latest-udp.yml'), yml);

console.log('\n✓ Done: ' + path.relative(REPO, setupPath));
console.log('  update manifest: ' + path.relative(REPO, path.join(DIST_DIR, 'latest-udp.yml')));
console.log('\nNext: copy both files into backend/releases/ to publish.');
