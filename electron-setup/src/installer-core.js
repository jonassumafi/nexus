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

const fs = require('fs');
const path = require('path');
const os = require('os');
const child = require('child_process');
const AdmZip = require('adm-zip');

const REG_ROOT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Nexus';
const STAGING_DIR = '_staging';
const BACKUP_DIR  = '_backup';

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
  const r = await runAsync('tasklist', ['/FI', 'IMAGENAME eq Nexus Companion*.exe', '/FO', 'CSV', '/NH']);
  return /Nexus Companion/i.test(r.stdout);
}
async function killNexus() {
  await runAsync('taskkill', ['/F', '/IM', 'Nexus Companion UDP.exe']);
  await runAsync('taskkill', ['/F', '/IM', 'Nexus Companion.exe']);
}

// ─── FS helpers ───────────────────────────────────────────────────────

function rimraf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function listDirShallow(dir) {
  try { return fs.readdirSync(dir).map(n => path.join(dir, n)); } catch { return []; }
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

async function extractZip(zipPath, destDir, { onFile, cancelSignal } = {}) {
  const zip = new AdmZip(zipPath);
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
      if (fs.existsSync(backupDir)) {
        // Restore previous version: delete whatever's at installDir (except backup/staging), move backup back.
        for (const p of listDirShallow(installDir)) {
          if (path.basename(p) === STAGING_DIR || path.basename(p) === BACKUP_DIR) continue;
          rimraf(p);
        }
        for (const p of listDirShallow(backupDir)) {
          fs.renameSync(p, path.join(installDir, path.basename(p)));
        }
        rimraf(backupDir);
      } else if (!isUpdate) {
        // Fresh install that failed — remove everything we created.
        rimraf(installDir);
      }
      rimraf(stagingDir);
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
      // Move current contents into backupDir atomically (same volume).
      ensureDir(backupDir);
      for (const p of listDirShallow(installDir)) {
        if (path.basename(p) === STAGING_DIR || path.basename(p) === BACKUP_DIR) continue;
        fs.renameSync(p, path.join(backupDir, path.basename(p)));
      }
    }
    ensureDir(stagingDir);
    onStep({ name: steps[2], status: 'ok' });

    // Step 4 — extraction with per-file callback
    onStep({ name: steps[3], status: 'start' });
    await extractZip(getPayloadZipPath(), stagingDir, {
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
      fs.renameSync(p, path.join(installDir, path.basename(p)));
    }
    rimraf(stagingDir);
    onStep({ name: steps[4], status: 'ok' });

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
    const selfExe = process.execPath.toLowerCase().includes('electron.exe')
      ? finalExe // dev fallback; packaged build never hits this
      : process.execPath;
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
    if (err.message === 'canceled') { await bail(err); const e = new Error('canceled'); e.canceled = true; throw e; }
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
  rimraf(existing.path);
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
    for (const name of ['Nexus Companion UDP', 'Nexus Companion']) {
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
