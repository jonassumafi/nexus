// Nexus Companion — Electron main process.
//
// v0.4.0 adds:
//   • Mode cycling: 'full' (1280×820 dashboard) ↔ 'radio' (320×44 widget)
//   • Each mode remembers its own window position + size independently
//   • setRadioExpanded(bool) grows the radio widget downward to reveal
//     the settings drawer, snaps back when collapsed
//
// Retained from v0.3.0:
//   • Frameless + transparent window; Nexus app draws its own frame
//   • Always-on-top pin
//   • Native OS-level global PTT key hook (press + release)

const { app, BrowserWindow, session, ipcMain, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

const NEXUS_URL = process.env.NEXUS_URL || 'https://nexus-missions.space';

// ─── Mode definitions ─────────────────────────────────────────────────────
// Each mode is a URL path + a target window size. The radio mode has two
// sizes — collapsed (the ultra-compact strip) and expanded (strip + settings
// drawer unfolded below). Both snap back to the same top-left anchor so
// the pinned corner doesn't drift.
const MODES = {
  full: {
    path: '/',
    size: { width: 1280, height: 820 },
    minSize: { width: 900, height: 600 },
  },
  radio: {
    path: '/radio',
    size: { width: 320, height: 44 },
    sizeExpanded: { width: 320, height: 420 },
    minSize: { width: 320, height: 44 },
  },
};

// ─── Persisted state ──────────────────────────────────────────────────────
const STATE_PATH = () => path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH(), 'utf8');
    const s = JSON.parse(raw);
    return {
      mode: (s.mode === 'radio' || s.mode === 'full') ? s.mode : 'full',
      pinned: !!s.pinned,
      // Per-mode window bounds — remember position + size per mode so
      // switching between full and radio doesn't scramble either layout.
      full:  s.full  || {},
      radio: s.radio || {},
      radioExpanded: !!s.radioExpanded,
    };
  } catch {
    return { mode: 'full', pinned: false, full: {}, radio: {}, radioExpanded: false };
  }
}

function saveState(partial) {
  try {
    const prev = loadState();
    const next = { ...prev, ...partial };
    fs.mkdirSync(path.dirname(STATE_PATH()), { recursive: true });
    fs.writeFileSync(STATE_PATH(), JSON.stringify(next, null, 2));
  } catch (err) {
    console.error('[main] saveState failed:', err.message);
  }
}

// ─── State ────────────────────────────────────────────────────────────────
let currentPttKey = 'V';
let pttDown = false;
let mainWindow = null;
let keyboard = null;
let currentMode = 'full';
let radioExpanded = false;

// ─── Window creation ──────────────────────────────────────────────────────
function createWindow() {
  const state = loadState();
  currentMode = state.mode;
  radioExpanded = state.radioExpanded;

  const bounds = computeBounds(currentMode, state);

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width:  bounds.width,
    height: bounds.height,
    minWidth:  MODES[currentMode].minSize.width,
    minHeight: MODES[currentMode].minSize.height,
    // Solid chassis — opaque window with a device-like bezel drawn
    // inside by preload CSS. Was transparent in v0.3/v0.4; feedback was
    // "looks like a floating panel, not an app." OS draws the drop shadow.
    transparent: false,
    hasShadow: true,
    backgroundColor: '#020C14',
    autoHideMenuBar: true,
    title: 'Nexus Companion',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    frame: false,
    titleBarStyle: 'hidden',
    alwaysOnTop: state.pinned,
    resizable: currentMode === 'full', // radio widget is fixed-size
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (state.pinned) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  mainWindow.loadURL(NEXUS_URL + MODES[currentMode].path);

  mainWindow.webContents.on('did-fail-load', (_e, _code, desc) => {
    console.error(`[main] load failed: ${desc}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('nexus:window-state', {
      pinned: state.pinned,
      compact: false,
      mode: currentMode,
      radioExpanded,
    });
  });

  mainWindow.on('move',   persistBounds);
  mainWindow.on('resize', persistBounds);
  mainWindow.on('closed', () => { mainWindow = null; stopKeyHook(); });
}

// Compute initial window bounds for a mode, clamping to primary display.
function computeBounds(mode, state) {
  const m = MODES[mode];
  const saved = state[mode] || {};
  const size = (mode === 'radio' && state.radioExpanded && m.sizeExpanded)
    ? m.sizeExpanded
    : m.size;

  const area = screen.getPrimaryDisplay().workArea;
  const w = Number.isFinite(saved.width)  ? saved.width  : size.width;
  const h = Number.isFinite(saved.height) ? saved.height : size.height;
  let x = Number.isFinite(saved.x) ? saved.x : undefined;
  let y = Number.isFinite(saved.y) ? saved.y : undefined;

  // Keep the window at least mostly inside the display.
  if (x !== undefined && (x < area.x - 100 || x > area.x + area.width - 100)) x = undefined;
  if (y !== undefined && (y < area.y - 100 || y > area.y + area.height - 100)) y = undefined;

  return { x, y, width: w, height: h };
}

// Persist current window bounds for the active mode.
function persistBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const b = mainWindow.getBounds();
  const s = loadState();
  const key = currentMode;
  const nextModeBounds = { ...s[key], x: b.x, y: b.y };
  // Only persist width/height for full mode; radio size is fixed by the
  // app and controlled via setRadioExpanded.
  if (currentMode === 'full') {
    nextModeBounds.width = b.width;
    nextModeBounds.height = b.height;
  }
  saveState({ [key]: nextModeBounds });
}

// Switch to a different mode. Persists current bounds, loads the new
// route, resizes to the new mode's dimensions and remembered position.
function switchMode(nextMode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!MODES[nextMode] || nextMode === currentMode) return;
  persistBounds();
  currentMode = nextMode;
  saveState({ mode: currentMode });

  const state = loadState();
  const b = computeBounds(currentMode, state);
  // Resize first, then move — order matters for some Linux WMs.
  mainWindow.setResizable(currentMode === 'full');
  mainWindow.setMinimumSize(MODES[currentMode].minSize.width, MODES[currentMode].minSize.height);
  mainWindow.setSize(b.width, b.height, true);
  if (b.x !== undefined && b.y !== undefined) mainWindow.setPosition(b.x, b.y);
  mainWindow.loadURL(NEXUS_URL + MODES[currentMode].path);
}

// Grow / shrink the radio widget to reveal / hide the settings drawer.
function setRadioExpandedState(expanded) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (currentMode !== 'radio') return;
  radioExpanded = !!expanded;
  saveState({ radioExpanded });
  const m = MODES.radio;
  const target = radioExpanded ? m.sizeExpanded : m.size;
  mainWindow.setSize(target.width, target.height, true);
}

// ─── Native global key hook — press and release ───────────────────────────
function startKeyHook() {
  if (keyboard) return;
  try {
    const { GlobalKeyboardListener } = require('node-global-key-listener');
    keyboard = new GlobalKeyboardListener();
    keyboard.addListener((e) => {
      const name = String(e.name || '').toUpperCase();
      const want = String(currentPttKey || 'V').toUpperCase();
      if (name !== want) return;
      if (e.state === 'DOWN' && !pttDown) {
        pttDown = true;
        mainWindow?.webContents.send('nexus:ptt', { down: true });
      } else if (e.state === 'UP' && pttDown) {
        pttDown = false;
        mainWindow?.webContents.send('nexus:ptt', { down: false });
      }
    });
    console.log('[main] global key hook active, PTT key =', currentPttKey);
  } catch (err) {
    console.error('[main] key hook failed:', err.message);
  }
}
function stopKeyHook() {
  try { keyboard?.kill(); } catch {}
  keyboard = null;
}

// ─── IPC ──────────────────────────────────────────────────────────────────
ipcMain.handle('nexus:setPttKey', (_e, key) => {
  const k = String(key || 'V').toUpperCase();
  if (k !== currentPttKey) {
    currentPttKey = k;
    console.log('[main] PTT key updated to', currentPttKey);
  }
  return true;
});

ipcMain.handle('nexus:togglePin', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next, 'screen-saver');
  saveState({ pinned: next });
  return next;
});

ipcMain.handle('nexus:setMode', (_e, mode) => {
  switchMode(mode);
  return currentMode;
});

ipcMain.handle('nexus:cycleMode', () => {
  const order = ['full', 'radio'];
  const i = order.indexOf(currentMode);
  const next = order[(i + 1) % order.length];
  switchMode(next);
  return currentMode;
});

ipcMain.handle('nexus:setRadioExpanded', (_e, expanded) => {
  setRadioExpandedState(expanded);
  return radioExpanded;
});

ipcMain.handle('nexus:minimize',  () => mainWindow?.minimize());
ipcMain.handle('nexus:maxToggle', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('nexus:close', () => mainWindow?.close());

// ─── Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  startKeyHook();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  stopKeyHook();
  if (process.platform !== 'darwin') app.quit();
});
