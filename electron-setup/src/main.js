// Nexus Setup — Electron main process.
// Builds the frameless window, routes IPC to installer-core, applies
// the saved skin before the window paints, and handles the --silent
// / --uninstall CLI switches for electron-updater handoff.

const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadSavedSkin } = require('./skin-loader');
const core = require('./installer-core');

// ─── CLI parsing ──────────────────────────────────────────────────────

const argv = process.argv.slice(1);
const flags = {
  silent:    argv.includes('--silent') || argv.includes('/S'),
  uninstall: argv.includes('--uninstall'),
  dir:       null,
};
for (const a of argv) {
  if (a.startsWith('--dir=')) flags.dir = a.slice(6);
  else if (a.startsWith('/D=')) flags.dir = a.slice(3);
}

// Single-instance guard — a second launch while an install is live just
// focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ─── Skin applied before window.show() ───────────────────────────────
// Resolved once at launch and frozen for the lifetime of the installer.
const skin = loadSavedSkin();

// ─── Silent mode (no window) ─────────────────────────────────────────

async function runSilent() {
  const sink = (s) => {
    const prefix = s.status === 'err' ? '[err] ' : s.status === 'warn' ? '[warn] ' : '';
    process.stdout.write(prefix + s.name + '\n');
  };
  try {
    if (flags.uninstall) {
      await core.runUninstall({ keepSettings: true, onStep: sink });
    } else {
      await core.runInstall({
        installDir:     flags.dir || core.getDefaultInstallDir(),
        createDesktop:  false,
        startWithLogin: false,
        onStep:         sink,
      });
    }
    app.exit(0);
  } catch (err) {
    process.stderr.write('[err] ' + err.message + '\n');
    app.exit(err.canceled ? 2 : 1);
  }
}

// ─── Window mode ─────────────────────────────────────────────────────

let win = null;
let cancelSignal = core.cancelHandle();

function createWindow() {
  win = new BrowserWindow({
    width: 640,
    height: 400,
    useContentSize: true,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: skin.bg0,   // paints before DOM loads to avoid flash
    show: false,                 // show() fires after did-finish-load
    icon: path.join(__dirname, '..', 'payload', 'icon.ico'),
    webPreferences: {
      preload:           path.join(__dirname, 'preload.js'),
      contextIsolation:  true,
      nodeIntegration:   false,
      sandbox:           false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => { win.show(); });
}

// ─── IPC ─────────────────────────────────────────────────────────────

function emit(step) { if (win && !win.isDestroyed()) win.webContents.send('setup:step', step); }

ipcMain.handle('setup:get-skin', () => skin);
ipcMain.handle('setup:get-context', () => {
  const existing = core.detectInstall();
  const m = core.readManifest();
  return {
    existing,
    defaultDir: core.getDefaultInstallDir(),
    manifest: m,
    version: m.version || '0.0.0',
    productName: m.productName || 'Nexus Companion UDP',
  };
});

ipcMain.handle('setup:install', async (_e, opts) => {
  cancelSignal = core.cancelHandle();
  try {
    const result = await core.runInstall({
      installDir:     (opts && opts.installDir) || core.getDefaultInstallDir(),
      createDesktop:  !!(opts && opts.createDesktop),
      startWithLogin: !!(opts && opts.startWithLogin),
      onStep:         emit,
      cancel:         cancelSignal,
    });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, canceled: !!err.canceled, error: err.message };
  }
});

ipcMain.handle('setup:repair', async (_e, opts) => {
  cancelSignal = core.cancelHandle();
  try {
    const result = await core.runRepair({
      installDir:     (opts && opts.installDir) || (core.detectInstall() || {}).path || core.getDefaultInstallDir(),
      createDesktop:  false,
      startWithLogin: false,
      onStep:         emit,
      cancel:         cancelSignal,
    });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, canceled: !!err.canceled, error: err.message };
  }
});

ipcMain.handle('setup:uninstall', async (_e, opts) => {
  try {
    await core.runUninstall({
      keepSettings: !!(opts && opts.keepSettings),
      onStep:       emit,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('setup:cancel', () => { cancelSignal.cancel(); return true; });

ipcMain.handle('setup:launch-app', () => {
  const existing = core.detectInstall();
  if (!existing || !existing.path) return false;
  const m = core.readManifest();
  const exe = path.join(existing.path, m.exeName || 'Nexus Companion UDP.exe');
  if (!fs.existsSync(exe)) return false;
  shell.openPath(exe).catch(() => {});
  return true;
});

ipcMain.handle('setup:minimize', () => { win?.minimize(); });
ipcMain.handle('setup:close',    () => { win?.close(); });
ipcMain.handle('setup:copy', (_e, text) => { try { clipboard.writeText(String(text || '')); return true; } catch { return false; } });
ipcMain.handle('setup:pick-folder', async (_e, current) => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: current || core.getDefaultInstallDir(),
  });
  if (r.canceled || !r.filePaths?.[0]) return null;
  return r.filePaths[0];
});

// ─── App lifecycle ───────────────────────────────────────────────────

app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  if (flags.silent) return runSilent();
  createWindow();
});
