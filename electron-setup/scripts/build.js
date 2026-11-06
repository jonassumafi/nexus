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
  if (r.error) console.error('✗ spawn error: ' + r.error.message);
  if (r.status !== 0) { console.error('✗ failed: ' + cmd + ' ' + args.join(' ')); process.exit(r.status || 1); }
}
// Run a project's locally installed electron-builder through node itself.
// Spawning `npx` fails on Windows (it's npx.cmd, and Node refuses to
// spawn .cmd files without a shell), so resolve cli.js and use execPath.
function electronBuilder(cwd, args) {
  const cli = require.resolve('electron-builder/cli.js', { paths: [cwd] });
  run(process.execPath, [cli, ...args], { cwd });
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
electronBuilder(COMPANION, ['--win', 'dir', '--config', 'electron-builder.udp.yml']);

if (!fs.existsSync(UNPACKED_SRC)) {
  console.error('✗ expected unpacked output at ' + UNPACKED_SRC);
  process.exit(1);
}

// 1b) Voice check. Run the packaged companion itself in Node mode, load
// opus the way udp-voice.js does (from inside app.asar), and encode one
// frame. Catches a native binary for the wrong OS or a missing prebuild,
// which otherwise ships silently: the app still starts, it just never
// sends voice.
log('Checking voice encoder (opus) in the packaged companion');
{
  const exe = fs.readdirSync(UNPACKED_SRC).find(n => n.toLowerCase().endsWith('.exe') && !/uninstall/i.test(n));
  const loader = path.join(UNPACKED_SRC, 'resources', 'app.asar', 'src', 'opus-loader.js');
  const probe = `const { OpusEncoder } = require(${JSON.stringify(loader)}).loadOpus();`
    + `const n = new OpusEncoder(48000, 1).encode(Buffer.alloc(1920)).length;`
    + `if (!n) throw new Error('encoder returned no data'); console.log('opus ok (' + n + ' byte frame)');`;
  const r = child.spawnSync(path.join(UNPACKED_SRC, exe), ['-e', probe], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true,
  });
  if (r.status !== 0) {
    console.error('✗ voice encoder failed to load in the packaged app — the installer would ship with broken voice.');
    console.error((r.stderr || r.stdout || (r.error && r.error.message) || '').trim().split('\n').slice(0, 6).join('\n'));
    console.error('  Fix: delete electron/node_modules and run npm install on THIS machine (never copy node_modules between OSes).');
    process.exit(1);
  }
  console.log('  ' + r.stdout.trim());
}

// 1c) Updater config. electron-updater reads resources/app-update.yml to
// know where to look for updates, but electron-builder only writes it
// for its own installer targets (nsis etc.), never for `--win dir`.
// Without it every installed copy fails its update check before it
// even contacts the server. Write it from the companion's publish block.
// No publisherName: the setup exe is unsigned, and a publisherName would
// make electron-updater reject every unsigned update.
const PUBLISH = (() => {
  const cfg = fs.readFileSync(path.join(COMPANION, 'electron-builder.udp.yml'), 'utf8');
  // [^\n]* rather than .*: a Windows checkout has CRLF and . stops at \r.
  const block = (cfg.match(/^publish:[^\n]*\n((?:[ \t-][^\n]*\n?)+)/m) || [])[1] || '';
  const url     = (block.match(/url:\s*(\S+)/) || [])[1];
  const channel = (block.match(/channel:\s*(\S+)/) || [])[1];
  if (!url || !channel) { console.error('✗ could not read publish url/channel from electron-builder.udp.yml'); process.exit(1); }
  return { url, channel };
})();
log('Writing app-update.yml (channel ' + PUBLISH.channel + ' → ' + PUBLISH.url + ')');
fs.writeFileSync(path.join(UNPACKED_SRC, 'resources', 'app-update.yml'), [
  'provider: generic',
  'url: ' + PUBLISH.url,
  'channel: ' + PUBLISH.channel,
  'updaterCacheDirName: nexus-companion-udp-updater',
  '',
].join('\n'));

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
electronBuilder(ROOT, ['--win', '--config', 'electron-builder.yml']);

// 7) Emit the update manifest. Installed apps on channel "<channel>"
// fetch <url>/<channel>.yml (udp.yml); latest-udp.yml is the same file
// under its legacy name.
const CHANNEL_YML = PUBLISH.channel + '.yml';
log('Emitting ' + CHANNEL_YML + ' (+ latest-udp.yml)');
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
fs.writeFileSync(path.join(DIST_DIR, CHANNEL_YML), yml);
fs.writeFileSync(path.join(DIST_DIR, 'latest-udp.yml'), yml);

console.log('\n✓ Done: ' + path.relative(REPO, setupPath));
console.log('  update manifest: ' + path.relative(REPO, path.join(DIST_DIR, CHANNEL_YML)));
console.log('\nNext: copy the exe and ' + CHANNEL_YML + ' into backend/releases/ to publish.');
