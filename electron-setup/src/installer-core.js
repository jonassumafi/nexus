// Core install / update / repair / uninstall logic. Pure Node — no
// Electron imports — so it can be unit-tested headless and reused by
// silent (CLI) mode without spinning up a BrowserWindow.
//
// Public surface:
//   await runInstall(opts)      // fresh or update, same path
//   await runRepair(opts)       // re-extract over the existing install
//   await runUninstall(opts)    // remove files, shortcuts, registry
//   detectInstall()             // read HKCU, return { installed, path, version } or null
//   getDefaultInstallDir()      // %LOCALAPPDATA%\Programs\Nexus
//
// `opts.onStep({ name, status, detail })` is the single progress sink.
// Status is one of: 'start', 'ok', 'warn', 'err'. Renderer maps these
// to log lines + a pct value driven off `opts.plan` indexing.

// Under Electron, `fs` treats any path ending in .asar as an archive, so
// extracting / moving / deleting the companion's resources\app.asar
// fails ("Invalid package"). original-fs is the unpatched module; plain
// Node (headless tests) keeps using fs.
const fs = process.versions.electron ? require('original-fs') : require('fs');
const path = require('path');
const os = require('os');
const child = require('child_process');
const AdmZip = require('adm-zip');

const REG_ROOT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Nexus';
const STAGING_DIR = '_staging';
const BACKUP_DIR  = '_backup';
// Lists the top-level entries this installer placed in the install dir.
// Update / rollback / uninstall touch only these, so a custom /D= path
// that already holds other files never loses them.
const MARKER_FILE = '.nexus-install.json';
// A copy of the setup exe kept in the install dir, so the uninstall entry
// keeps working after the downloaded installer (or electron-updater's
// cached copy) is deleted.
const UNINSTALLER = 'Uninstall Nexus.exe';

// ─── Paths ────────────────────────────────────────────────────────────

function getDefaultInstallDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'Programs', 'Nexus');
}
function getPayloadZipPath() {
  // When packaged, asarUnpack rewrites `payload/` to live next to the
  // asar. app.asar.unpacked/payload/nexus-companion.zip
  const candidates = [
    path.join(__dirname, '..', 'payload', 'nexus-companion.zip'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'payload', 'nexus-companion.zip'),
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  throw new Error('payload zip not found; build did not bundle nexus-companion.zip');
}
function getPayloadManifestPath() {
  const candidates = [
    path.join(__dirname, '..', 'payload', 'manifest.json'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'payload', 'manifest.json'),
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}
function readManifest() {
  const p = getPayloadManifestPath();
  if (!p) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) || {}; } catch { return {}; }
}

// ─── Registry helpers (HKCU only, no admin) ───────────────────────────

function regAdd(key, name, value, type = 'REG_SZ') {
  return runSync('reg', ['add', key, '/v', name, '/t', type, '/d', String(value), '/f']);
}
function regDelete(key) {
  return runSync('reg', ['delete', key, '/f']);
}
function regQuery(key, name) {
  const r = runSync('reg', ['query', key, '/v', name]);
  if (r.code !== 0) return null;
  const m = r.stdout.match(new RegExp(name + '\\s+REG_\\w+\\s+(.+?)\\r?\\n'));
  return m ? m[1].trim() : null;
}
function runSync(cmd, args) {
  try {
    const r = child.spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true });
    return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
  } catch (err) { return { code: 1, stdout: '', stderr: err.message }; }
}
function runAsync(cmd, args) {
  return new Promise((resolve) => {
    try {
      const p = child.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let out = '', err = '';
      p.stdout.on('data', d => { out += d; });
      p.stderr.on('data', d => { err += d; });
      p.on('close', code => resolve({ code, stdout: out, stderr: err }));
    } catch (e) { resolve({ code: 1, stdout: '', stderr: e.message }); }
  });
}

// ─── Install detection ────────────────────────────────────────────────

function detectInstall() {
  const dir     = regQuery(REG_ROOT, 'InstallLocation');
  const version = regQuery(REG_ROOT, 'DisplayVersion');
  if (!dir) return null;
  const exists = fs.existsSync(dir);
  return { installed: true, path: dir, version: version || '', exists };
}

// ─── Process gating ───────────────────────────────────────────────────

async function isNexusRunning() {
  const r = await runAsync('tasklist', ['/FI', 'IMAGENAME eq Nexus Companion*', '/FO', 'CSV', '/NH']);
  return /Nexus Companion/i.test(r.stdout);
}
// taskkill returns as soon as termination is requested; the processes
// (Electron runs several) hold file locks until they've actually exited.
// Since close-to-tray, "closed" Nexus is usually still running, so wait
// for it to be gone before touching its files.
async function killNexus({ timeoutMs = 15000 } = {}) {
  await runAsync('taskkill', ['/F', '/T', '/IM', 'Nexus Companion UDP.exe']);
  await runAsync('taskkill', ['/F', '/T', '/IM', 'Nexus Companion.exe']);
  const deadline = Date.now() + timeoutMs;
  while (await isNexusRunning()) {
    if (Date.now() > deadline) throw new Error('Nexus is still running and could not be closed — quit it from the tray and try again');
    await new Promise(r => setTimeout(r, 250));
  }
  await new Promise(r => setTimeout(r, 300)); // let Windows release file handles
}

// ─── FS helpers ───────────────────────────────────────────────────────

function rimraf(dir) {
  // Retries cover brief EBUSY/EPERM locks (antivirus scans, handles
  // still closing after a kill).
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
}
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function listDirShallow(dir) {
  try { return fs.readdirSync(dir).map(n => path.join(dir, n)); } catch { return []; }
}
function rmdirIfEmpty(dir) {
  try { fs.rmdirSync(dir); } catch {} // fails (harmlessly) when not empty
}
function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

// ─── Uninstaller copy ─────────────────────────────────────────────────

// Copies the portable setup exe the user launched into installDir as
// UNINSTALLER. Returns its path, or null when not running as the
// packaged portable exe (dev runs). Skips the copy when we are already
// running from that file (update/repair launched from the uninstaller).
function installUninstaller(installDir) {
  const src = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!src || !fs.existsSync(src)) return null;
  const dest = path.join(installDir, UNINSTALLER);
  if (samePath(src, dest)) return dest;
  const tmp = dest + '.new';
  try {
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dest); // replaces an older uninstaller
  } catch (err) { rimraf(tmp); throw err; }
  return dest;
}

// Windows won't delete (or rename) a running exe, and the portable
// launcher keeps the uninstaller open until it exits. So when the
// uninstall runs from the installed uninstaller, hand the last step to a
// tiny script that retries deleting it every second until the launcher
// has exited, then removes the install dir if that left it empty, then
// deletes itself. Gives up after about an hour.
//
// It runs under wscript.exe, a windowless (GUI-subsystem) host, so the
// user sees nothing. Console tools here (cmd, ping, powershell) each pop
// a visible console window when started without one, and it must be
// started detached: libuv puts non-detached children in a kill-on-close
// job, so they'd die with us.
const SELF_DELETE_JS = [
  'var fso = new ActiveXObject("Scripting.FileSystemObject");',
  'var f = WScript.Arguments(0), d = WScript.Arguments(1);',
  'for (var i = 0; i < 3600; i++) {',
  '  try { if (fso.FileExists(f)) fso.DeleteFile(f, true); } catch (e) {}',
  '  if (!fso.FileExists(f)) break;',
  '  WScript.Sleep(1000);',
  '}',
  'try { var fo = fso.GetFolder(d); if (fo.Files.Count === 0 && fo.SubFolders.Count === 0) fo.Delete(true); } catch (e) {}',
  'try { fso.DeleteFile(WScript.ScriptFullName, true); } catch (e) {}',
].join('\r\n');
function scheduleSelfDelete(file, dir) {
  try {
    const script = path.join(os.tmpdir(), 'nexus-uninstall-cleanup-' + process.pid + '.js');
    fs.writeFileSync(script, SELF_DELETE_JS);
    const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
    const p = child.spawn(wscript, ['//B', '//Nologo', '//E:JScript', script, file, dir], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    p.unref();
    return true;
  } catch { return false; }
}

// ─── Ownership tracking ───────────────────────────────────────────────

function zipTopLevel(zip) {
  const names = new Set();
  for (const e of zip.getEntries()) {
    const top = e.entryName.split(/[\\/]/)[0];
    if (top) names.add(top);
  }
  return names;
}
function readMarker(installDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(installDir, MARKER_FILE), 'utf8'));
    return Array.isArray(m.entries) ? m.entries.filter(n => typeof n === 'string' && n && !/[\\/]/.test(n) && n !== '..' && n !== '.') : [];
  } catch { return []; }
}
function writeMarker(installDir, entries, version) {
  fs.writeFileSync(path.join(installDir, MARKER_FILE), JSON.stringify({ version, entries: [...entries].sort() }, null, 2));
}
// Entries in installDir that belong to us: what the previous install
// recorded plus what the current payload ships (covers legacy installs
// that predate the marker). Only names that exist are returned.
function ownedEntries(installDir, payloadNames) {
  const names = new Set([...readMarker(installDir), ...payloadNames, MARKER_FILE]);
  return [...names].map(n => path.join(installDir, n)).filter(p => fs.existsSync(p));
}

// ─── Shortcut creation (powershell COM, no admin) ─────────────────────

async function makeShortcut(lnkPath, targetPath, args = '', workingDir = '', iconPath = '', description = '') {
  const ps = [
    `$WS = New-Object -ComObject WScript.Shell;`,
    `$s = $WS.CreateShortcut('${lnkPath.replace(/'/g, "''")}');`,
    `$s.TargetPath = '${targetPath.replace(/'/g, "''")}';`,
    args        ? `$s.Arguments = '${args.replace(/'/g, "''")}';` : '',
    workingDir  ? `$s.WorkingDirectory = '${workingDir.replace(/'/g, "''")}';` : '',
    iconPath    ? `$s.IconLocation = '${iconPath.replace(/'/g, "''")}';` : '',
    description ? `$s.Description = '${description.replace(/'/g, "''")}';` : '',
    `$s.Save();`,
  ].filter(Boolean).join(' ');
  return runAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
}
function startMenuDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
}
function desktopDir() {
  // USERPROFILE\Desktop is the non-redirected per-user location.
  return path.join(process.env.USERPROFILE || os.homedir(), 'Desktop');
}

// ─── Extraction with per-entry progress ───────────────────────────────

async function extractZip(zip, destDir, { onFile, cancelSignal } = {}) {
  const entries = zip.getEntries();
  const total = entries.length;
  for (let i = 0; i < total; i++) {
    if (cancelSignal && cancelSignal.canceled) throw new Error('canceled');
    const e = entries[i];
    const outPath = path.join(destDir, e.entryName);
    if (e.isDirectory) {
      ensureDir(outPath);
    } else {
      ensureDir(path.dirname(outPath));
      fs.writeFileSync(outPath, e.getData());
    }
    if (onFile) onFile({ index: i, total, name: e.entryName });
  }
}

// ─── Orchestration ────────────────────────────────────────────────────

function cancelHandle() { return { canceled: false, cancel() { this.canceled = true; } }; }

async function runInstall({
  installDir      = getDefaultInstallDir(),
  createDesktop   = true,
  startWithLogin  = false,
  onStep          = () => {},
  cancel          = cancelHandle(),
} = {}) {
  const manifest    = readManifest();
  const productName = manifest.productName || 'Nexus Companion UDP';
  const version     = manifest.version     || '0.0.0';
  const exeName     = manifest.exeName     || `${productName}.exe`;
  const stagingDir  = path.join(installDir, STAGING_DIR);
  const backupDir   = path.join(installDir, BACKUP_DIR);
  const existing    = detectInstall();
  const isUpdate    = !!existing;
  const finalExe    = path.join(installDir, exeName);
  const dirExisted  = fs.existsSync(installDir);
  let zip = null, payloadNames = new Set();
  const promoted = []; // paths moved staging → installDir by this run

  const steps = [
    'checking disk space and permissions',
    isUpdate ? 'closing running Nexus'      : 'creating install folder',
    isUpdate ? 'backing up current version' : 'staging payload',
    'extracting payload',
    isUpdate ? 'replacing files'            : 'moving files into place',
    'creating Start Menu shortcut',
    createDesktop ? 'creating desktop shortcut' : null,
    'registering uninstall entry',
    'finalizing',
  ].filter(Boolean);

  const bail = async (err) => {
    try {
      onStep({ name: 'rolling back changes', status: 'warn' });
      // Only entries this run promoted are removed; anything else in
      // installDir is the user's, or old files that never reached backup.
      if (fs.existsSync(backupDir)) {
        // Restore previous version: drop what we promoted, move backup back.
        for (const p of promoted) rimraf(p);
        for (const p of listDirShallow(backupDir)) {
          fs.renameSync(p, path.join(installDir, path.basename(p)));
        }
        rimraf(backupDir);
      } else if (!isUpdate) {
        // Fresh install that failed — remove only what we created.
        for (const p of promoted) rimraf(p);
      }
      rimraf(stagingDir);
      if (!isUpdate && !dirExisted) rmdirIfEmpty(installDir);
      onStep({ name: 'rollback complete', status: 'ok' });
    } catch (rollbackErr) {
      onStep({ name: 'rollback failed: ' + rollbackErr.message, status: 'err' });
    }
    throw err;
  };

  try {
    // Step 1
    onStep({ name: steps[0], status: 'start' });
    ensureDir(installDir);
    zip = new AdmZip(getPayloadZipPath());
    payloadNames = zipTopLevel(zip);
    onStep({ name: steps[0], status: 'ok' });

    // Step 2
    if (isUpdate) {
      onStep({ name: steps[1], status: 'start' });
      if (await isNexusRunning()) await killNexus();
      onStep({ name: steps[1], status: 'ok' });
    } else {
      onStep({ name: steps[1], status: 'start' });
      onStep({ name: steps[1], status: 'ok' });
    }

    // Step 3
    onStep({ name: steps[2], status: 'start' });
    if (isUpdate) {
      // Move our current files into backupDir atomically (same volume).
      // Unrelated files in installDir stay put.
      rimraf(backupDir); // leftover from an interrupted run
      ensureDir(backupDir);
      // The uninstaller stays: it may be the exe running this update, and
      // it's replaced in place after promotion anyway.
      for (const p of ownedEntries(installDir, payloadNames)) {
        if (path.basename(p).toLowerCase() === UNINSTALLER.toLowerCase()) continue;
        fs.renameSync(p, path.join(backupDir, path.basename(p)));
      }
    }
    ensureDir(stagingDir);
    onStep({ name: steps[2], status: 'ok' });

    // Step 4 — extraction with per-file callback
    onStep({ name: steps[3], status: 'start' });
    await extractZip(zip, stagingDir, {
      cancelSignal: cancel,
      onFile: ({ index, total, name }) => {
        onStep({ name: '+ ' + name, status: 'start', fileProgress: { index, total } });
      },
    });
    if (cancel.canceled) throw new Error('canceled');
    onStep({ name: steps[3], status: 'ok' });

    // Step 5 — promote staging → install root
    onStep({ name: steps[4], status: 'start' });
    for (const p of listDirShallow(stagingDir)) {
      const dest = path.join(installDir, path.basename(p));
      rimraf(dest); // repair over a dir where a stray copy remains
      fs.renameSync(p, dest);
      promoted.push(dest);
    }
    rimraf(stagingDir);
    onStep({ name: steps[4], status: 'ok' });

    onStep({ name: 'installing uninstaller', status: 'start' });
    const hadUninstaller = fs.existsSync(path.join(installDir, UNINSTALLER));
    const uninstallerExe = installUninstaller(installDir);
    if (uninstallerExe && !hadUninstaller) promoted.push(uninstallerExe);
    const owned = new Set(payloadNames);
    if (uninstallerExe) owned.add(UNINSTALLER);
    writeMarker(installDir, owned, version);
    promoted.push(path.join(installDir, MARKER_FILE));
    onStep({ name: 'installing uninstaller', status: 'ok' });

    // Step 6 — Start Menu shortcut
    onStep({ name: steps[5], status: 'start' });
    const smDir = path.join(startMenuDir(), 'Nexus Interstellar Traffic System');
    ensureDir(smDir);
    await makeShortcut(path.join(smDir, `${productName}.lnk`), finalExe, '', installDir, finalExe, productName);
    onStep({ name: steps[5], status: 'ok' });

    // Step 7 — Desktop shortcut (optional)
    if (createDesktop) {
      onStep({ name: steps[6], status: 'start' });
      await makeShortcut(path.join(desktopDir(), `${productName}.lnk`), finalExe, '', installDir, finalExe, productName);
      onStep({ name: steps[6], status: 'ok' });
    }

    // Step N-1 — HKCU uninstall entry
    const regStep = createDesktop ? steps[7] : steps[6];
    onStep({ name: regStep, status: 'start' });
    regAdd(REG_ROOT, 'DisplayName',     productName);
    regAdd(REG_ROOT, 'DisplayVersion',  version);
    regAdd(REG_ROOT, 'Publisher',       'Nexus Interstellar Traffic System');
    regAdd(REG_ROOT, 'InstallLocation', installDir);
    regAdd(REG_ROOT, 'DisplayIcon',     finalExe);
    // Self-exec for uninstall: we re-run the setup exe with --uninstall.
    // A portable build runs from a temp extraction that is deleted on
    // exit; PORTABLE_EXECUTABLE_FILE is the real exe the user launched.
    const selfExe = uninstallerExe
      || process.env.PORTABLE_EXECUTABLE_FILE
      || (process.execPath.toLowerCase().includes('electron.exe')
        ? finalExe // dev fallback; packaged build never hits this
        : process.execPath);
    regAdd(REG_ROOT, 'UninstallString', `"${selfExe}" --uninstall`);
    regAdd(REG_ROOT, 'QuietUninstallString', `"${selfExe}" --uninstall --silent`);
    regAdd(REG_ROOT, 'NoModify', 1, 'REG_DWORD');
    regAdd(REG_ROOT, 'NoRepair', 1, 'REG_DWORD');
    onStep({ name: regStep, status: 'ok' });

    // Finalize
    const finStep = steps[steps.length - 1];
    onStep({ name: finStep, status: 'start' });
    // Optional: start with login (shortcut in Startup folder)
    const startupLnk = path.join(startMenuDir(), 'Startup', `${productName}.lnk`);
    if (startWithLogin) {
      await makeShortcut(startupLnk, finalExe, '', installDir, finalExe, productName);
    } else {
      try { fs.unlinkSync(startupLnk); } catch {}
    }
    // Clean up backup now that promotion succeeded.
    rimraf(backupDir);
    onStep({ name: finStep, status: 'ok' });

    return { installDir, version, productName, exeName };
  } catch (err) {
    // bail() always rethrows the error it's given, so flag it first.
    if (err.message === 'canceled') err.canceled = true;
    await bail(err);
  }
}

async function runRepair(opts) {
  // Repair is just an install over the existing path with isUpdate semantics.
  return runInstall(opts);
}

async function runUninstall({
  keepSettings = true,
  onStep       = () => {},
} = {}) {
  const existing = detectInstall();
  if (!existing) {
    onStep({ name: 'no install found', status: 'warn' });
    return;
  }
  const productName = regQuery(REG_ROOT, 'DisplayName') || 'Nexus Companion UDP';

  onStep({ name: 'stopping Nexus', status: 'start' });
  await killNexus();
  onStep({ name: 'stopping Nexus', status: 'ok' });

  onStep({ name: 'removing files', status: 'start' });
  // Remove only what we installed, then the folder itself if that left
  // it empty. Never rimraf InstallLocation wholesale: with /D= it can be
  // a folder the user also keeps other things in.
  let payloadNames = new Set();
  try { payloadNames = zipTopLevel(new AdmZip(getPayloadZipPath())); } catch {}
  payloadNames.add(UNINSTALLER); // installs that predate the marker entry
  for (const p of ownedEntries(existing.path, payloadNames)) rimraf(p);
  rimraf(path.join(existing.path, STAGING_DIR));
  rimraf(path.join(existing.path, BACKUP_DIR));
  rimraf(path.join(existing.path, UNINSTALLER + '.new'));
  // Anything of ours still there (besides the running uninstaller) means
  // a file was locked. Fail now, before the shortcuts and uninstall entry
  // go, so the user can retry instead of being left with orphaned files
  // that Windows no longer lists.
  const leftover = ownedEntries(existing.path, payloadNames)
    .filter(p => path.basename(p).toLowerCase() !== UNINSTALLER.toLowerCase());
  if (leftover.length) {
    throw new Error('could not remove ' + leftover.map(p => path.basename(p)).join(', ')
      + ' — a file is in use. Close Nexus (tray → Quit Nexus) and try again.');
  }
  const uninstallerPath = path.join(existing.path, UNINSTALLER);
  if (fs.existsSync(uninstallerPath)) {
    // Still there → it's the exe running this uninstall; it deletes
    // itself (and the then-empty folder) once it has exited.
    scheduleSelfDelete(uninstallerPath, existing.path);
  } else {
    rmdirIfEmpty(existing.path);
  }
  onStep({ name: 'removing files', status: 'ok' });

  onStep({ name: 'removing shortcuts', status: 'start' });
  try { fs.unlinkSync(path.join(desktopDir(), `${productName}.lnk`)); } catch {}
  try { rimraf(path.join(startMenuDir(), 'Nexus Interstellar Traffic System')); } catch {}
  try { fs.unlinkSync(path.join(startMenuDir(), 'Startup', `${productName}.lnk`)); } catch {}
  onStep({ name: 'removing shortcuts', status: 'ok' });

  onStep({ name: 'removing uninstall entry', status: 'start' });
  regDelete(REG_ROOT);
  onStep({ name: 'removing uninstall entry', status: 'ok' });

  if (keepSettings) {
    onStep({ name: 'keeping your settings', status: 'ok' });
  } else {
    onStep({ name: 'removing settings', status: 'start' });
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    // This build's settings only; 'nexus-companion' belongs to the
    // separate non-UDP companion and must survive. The packaged app's
    // userData is %APPDATA%\nexus-companion-udp (package name, since it
    // ships no productName); the display-name folder is legacy.
    for (const name of ['nexus-companion-udp', 'Nexus Companion UDP']) {
      rimraf(path.join(appData, name));
    }
    onStep({ name: 'removing settings', status: 'ok' });
  }
}

module.exports = {
  runInstall,
  runRepair,
  runUninstall,
  detectInstall,
  getDefaultInstallDir,
  cancelHandle,
  readManifest,
};
