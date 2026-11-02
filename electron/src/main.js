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

const { app, BrowserWindow, session, ipcMain, screen, globalShortcut, Menu, Tray } = require('electron');
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
  companion: {
    path: '/companion',
    size: { width: 340, height: 540 },
    minSize: { width: 340, height: 540 },
  },
  radio: {
    path: '/radio',
    // v0.8.0 — resizable. Thin horizontal strip by default; user can drag
    // taller to see more peers, or shrink to a one-row minimum. Width
    // minimum reflects the number of controls that must fit in a row.
    size: { width: 560, height: 120 },
    minSize: { width: 420, height: 80 },
  },
};

// ─── Persisted state ──────────────────────────────────────────────────────
const STATE_PATH = () => path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH(), 'utf8');
    const s = JSON.parse(raw);
    return {
      mode: ['full', 'companion', 'radio'].includes(s.mode) ? s.mode : 'full',
      pinned: !!s.pinned,
      full:      s.full      || {},
      companion: s.companion || {},
      radio:     s.radio     || {},
      radioExpanded: !!s.radioExpanded,
    };
  } catch {
    return { mode: 'full', pinned: false, full: {}, companion: {}, radio: {}, radioExpanded: false };
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
let currentPttKey = 'v';

// Normalize a key name for cross-source matching. node-global-key-listener
// reports e.g. "CAPS LOCK" (with a space); JS KeyboardEvent.key reports
// "CapsLock" (no space). Strip spaces + uppercase so both forms compare
// equal.
function normKey(k) {
  return String(k || '').toUpperCase().replace(/\s+/g, '');
}
let pttDown = false;
let mainWindow = null;
let keyboard = null;
let currentMode = 'full';
let radioExpanded = false;

// ─── Window creation ──────────────────────────────────────────────────────
function createWindow() {
  const state = loadState();
  // Always start in full mode. Launching into a saved radio-only or
  // companion mode has been a footgun: if the renderer or Chromium cache
  // has issues, users can boot stuck in a broken small window with no
  // obvious way out. Starting in full gives them a known-good entry
  // point every launch. Per-mode window positions are still persisted,
  // so switching back to radio-only in-session restores the saved spot.
  currentMode = 'full';
  radioExpanded = false;
  // Also clear mode from persisted state so the tray's "Reset layout"
  // doesn't need to be fired manually to clean up v0.4.0 remnants.
  if (state.mode !== 'full') {
    saveState({ mode: 'full', radioExpanded: false });
  }

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
    // Frameless — the custom <TitleBar /> component drawn by the renderer
    // owns the drag region and the min / max / close controls. v0.6.3
    // rebuilds this cleanly: drag region is limited to empty bar space,
    // every control is explicitly no-drag, nothing is overlayed on top
    // of app content.
    frame: false,
    alwaysOnTop: state.pinned,
    // v0.8.0 — all modes resizable. Companion + radio were previously
    // locked; users wanted to drag them larger / smaller to fit their
    // overlay layout. The minSize per mode still enforces a sane floor.
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Chromium throttles background windows by default — pausing media
      // tracks, suspending AudioContexts, and slowing timers. For a radio
      // app that must transmit while in-game windows have focus, that's a
      // death sentence: global PTT hotkey fires, IPC reaches the renderer,
      // but the audio pipeline is asleep. Disabling throttling keeps the
      // WebRTC mic path hot regardless of window focus.
      backgroundThrottling: false,
    },
  });

  if (state.pinned) {
    // Pin level: 'floating' (not 'screen-saver').
    //
    // 'screen-saver' is the highest window level and will visually
    // sit above every other window — including the one the user just
    // clicked. That breaks normal Windows focus semantics (click
    // another app → that app should cover Nexus). 'floating' keeps
    // Nexus above regular desktop windows but still respects focus:
    // clicking a normal app brings it to the foreground over Nexus.
    //
    // Trade-off: 'floating' may NOT reliably stay above true
    // exclusive-fullscreen Star Citizen. If that regresses, we'll
    // need a dynamic swap (detect SC foreground → 'screen-saver',
    // otherwise 'floating').
    mainWindow.setAlwaysOnTop(true, 'floating');
  }

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  // Clear the HTTP cache on launch. The on-disk cost of a cold-start
  // asset fetch is negligible compared to the risk of serving stale
  // bundles from a prior installed version — which is exactly how v0.4.0's
  // broken /radio bundle persisted after upgrading to v0.5.0.
  session.defaultSession.clearCache().catch(() => {});

  // Belt-and-suspenders: also disable background throttling on the
  // existing webContents, in case webPreferences wasn't honored for some
  // reason on this platform / Electron version.
  try { mainWindow.webContents.setBackgroundThrottling(false); } catch {}

  mainWindow.loadURL(NEXUS_URL + MODES[currentMode].path);

  mainWindow.webContents.on('did-fail-load', (_e, _code, desc) => {
    console.error(`[main] load failed: ${desc}`);
  });

  // If the renderer process dies in a sub-mode (companion/radio), the
  // window would just vanish — which is exactly the "abruptly closes"
  // symptom reported in companion mode. Instead, catch the crash, log
  // it, and reload into full mode so the user never ends up stuck.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] renderer gone:', details?.reason, details?.exitCode);
    try {
      if (currentMode !== 'full') {
        switchMode('full');
      } else {
        mainWindow?.reload();
      }
    } catch (err) {
      console.error('[main] crash recovery failed:', err.message);
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.error('[main] renderer unresponsive');
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
  // v0.8.0 — persist width/height for every mode (companion + radio are
  // now user-resizable). Each mode remembers its own dimensions.
  const nextModeBounds = {
    ...s[key], x: b.x, y: b.y, width: b.width, height: b.height,
  };
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
  // v0.6.3 — radio mode is now one fixed size; sizeExpanded is gone.
  mainWindow.setSize(m.size.width, m.size.height, true);
}

// ─── Native global key hook — press and release ───────────────────────────
// v0.7.0 — swapped from node-global-key-listener (spawned a helper .exe
// that was being quarantined by Windows Defender in packaged builds) to
// uiohook-napi (native addon compiled into the Electron binary, no helper
// process, no .exe to quarantine).
function startKeyHook() {
  if (keyboard) return;
  try {
    const { uIOhook, UiohookKey } = require('uiohook-napi');
    keyboard = uIOhook;

    // Reverse-lookup table from uIOhook numeric keycodes → readable names.
    const CODE_TO_NAME = {};
    for (const [name, code] of Object.entries(UiohookKey)) {
      CODE_TO_NAME[code] = name;
    }

    const nameFor = (keycode) => CODE_TO_NAME[keycode] || `code-${keycode}`;

    uIOhook.on('keydown', (e) => {
      if (normKey(nameFor(e.keycode)) !== normKey(currentPttKey)) return;
      if (pttDown) return;
      pttDown = true;
      mainWindow?.webContents.send('nexus:ptt', { down: true });
    });
    uIOhook.on('keyup', (e) => {
      if (normKey(nameFor(e.keycode)) !== normKey(currentPttKey)) return;
      if (!pttDown) return;
      pttDown = false;
      mainWindow?.webContents.send('nexus:ptt', { down: false });
    });

    // Mouse-button PTT. Side buttons (Mouse4+) are gaming-mouse extras
    // that don't collide with normal UI clicking, so we accept those as
    // PTT bindings. Left/middle/right (1-3) are intentionally rejected.
    uIOhook.on('mousedown', (e) => {
      if (!e || typeof e.button !== 'number' || e.button < 4) return;
      if (normKey(`Mouse${e.button}`) !== normKey(currentPttKey)) return;
      if (pttDown) return;
      pttDown = true;
      mainWindow?.webContents.send('nexus:ptt', { down: true });
    });
    uIOhook.on('mouseup', (e) => {
      if (!e || typeof e.button !== 'number' || e.button < 4) return;
      if (normKey(`Mouse${e.button}`) !== normKey(currentPttKey)) return;
      if (!pttDown) return;
      pttDown = false;
      mainWindow?.webContents.send('nexus:ptt', { down: false });
    });
    uIOhook.start();

    console.log('[main] global key hook active (uiohook-napi), PTT key =', currentPttKey);
    setTimeout(() => {
      try { mainWindow?.webContents.send('nexus:hook-status', { ok: true, pttKey: currentPttKey, impl: 'uiohook-napi' }); } catch {}
    }, 2000);
  } catch (err) {
    console.error('[main] key hook failed:', err.message);
    setTimeout(() => {
      try { mainWindow?.webContents.send('nexus:hook-status', { ok: false, error: err.message }); } catch {}
    }, 2000);
  }
}
function stopKeyHook() {
  try { keyboard?.stop(); } catch {}
  keyboard = null;
}

// ─── IPC ──────────────────────────────────────────────────────────────────
ipcMain.handle('nexus:setPttKey', (_e, key) => {
  const k = String(key || 'v');
  if (normKey(k) !== normKey(currentPttKey)) {
    currentPttKey = k;
    console.log('[main] PTT key updated to', currentPttKey);
  }
  return true;
});

ipcMain.handle('nexus:togglePin', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isAlwaysOnTop();
  // See comment in createMainWindow for level choice ('floating').
  mainWindow.setAlwaysOnTop(next, 'floating');
  saveState({ pinned: next });
  return next;
});

ipcMain.handle('nexus:setOpacity', (_e, v) => {
  if (!mainWindow) return 1;
  const value = Math.max(0.3, Math.min(1, Number(v) || 1));
  try { mainWindow.setOpacity(value); } catch {}
  saveState({ opacity: value });
  return value;
});

ipcMain.handle('nexus:getOpacity', () => {
  try { return mainWindow?.getOpacity?.() ?? 1; } catch { return 1; }
});

ipcMain.handle('nexus:setMode', (_e, mode) => {
  switchMode(mode);
  return currentMode;
});

ipcMain.handle('nexus:cycleMode', () => {
  const order = ['full', 'companion', 'radio'];
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

// ─── Chat popout window ────────────────────────────────────────────────
// Detachable Global Chat — a separate frameless BrowserWindow that
// loads the /chat-popout route. Supports pin-on-top (so it floats over
// Star Citizen) and runtime opacity adjustment.
let chatPopout = null;

function openChatPopout() {
  if (chatPopout && !chatPopout.isDestroyed()) {
    try { chatPopout.show(); chatPopout.focus(); } catch {}
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  chatPopout = new BrowserWindow({
    width: 420, height: 520,
    x: Math.max(area.x, area.x + area.width - 460),
    y: Math.max(area.y, area.y + 60),
    minWidth: 280, minHeight: 220,
    frame: false,
    transparent: true,     // required so setOpacity gives true transparency over games
    hasShadow: false,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    title: 'Nexus Chat',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  chatPopout.loadURL(NEXUS_URL + '/chat-popout');
  chatPopout.on('closed', () => { chatPopout = null; });
}

ipcMain.handle('nexus:chatPopout:open',    () => { openChatPopout(); return true; });
ipcMain.handle('nexus:chatPopout:close',   () => { try { chatPopout?.close(); } catch {}; return true; });
ipcMain.handle('nexus:chatPopout:setOpacity', (_e, value) => {
  const v = Math.max(0.15, Math.min(1, Number(value) || 1));
  try { chatPopout?.setOpacity(v); } catch {}
  return v;
});
ipcMain.handle('nexus:chatPopout:togglePin', () => {
  if (!chatPopout) return false;
  const next = !chatPopout.isAlwaysOnTop();
  chatPopout.setAlwaysOnTop(next, 'floating');
  return next;
});
ipcMain.handle('nexus:chatPopout:minimize', () => { try { chatPopout?.minimize(); } catch {} });
ipcMain.handle('nexus:chatPopout:isOpen',   () => !!chatPopout && !chatPopout.isDestroyed());

// ─── Safe-mode recovery ───────────────────────────────────────────────────
// If a user ends up stuck in a broken mode (e.g. the renderer errors out
// in a non-full mode), this hard-coded global shortcut forces the window
// back to full dashboard mode regardless of what the renderer is doing.
// Ctrl+Shift+F is unlikely to collide with Star Citizen bindings.
function registerSafeMode() {
  try {
    globalShortcut.register('CommandOrControl+Shift+F', () => {
      switchMode('full');
      try { mainWindow?.show(); mainWindow?.focus(); } catch {}
    });
    // Emergency quit — in case the window is stranded on a page that
    // doesn't render our own close button (OAuth error, Cloudflare
    // interstitial, etc.) and the preload-injected emergency chrome
    // somehow didn't render. Last-resort kill switch.
    globalShortcut.register('CommandOrControl+Shift+Q', () => {
      try { app.quit(); } catch {}
    });
    // DevTools openers — F12 is standard, Ctrl+Alt+D is a backup for
    // when graphics-overlay software has hijacked F12.
    const openDevTools = () => {
      try {
        const wc = mainWindow?.webContents;
        if (!wc) return;
        if (wc.isDevToolsOpened()) wc.closeDevTools();
        else wc.openDevTools({ mode: 'detach' });
      } catch (err) {
        console.error('[main] devtools toggle failed:', err.message);
      }
    };
    globalShortcut.register('F12', openDevTools);
    globalShortcut.register('CommandOrControl+Alt+D', openDevTools);
  } catch (err) {
    console.error('[main] safe-mode shortcut failed:', err.message);
  }
}

// System tray — right-click menu with mode options + quit.
// Lets the user escape a broken state even if the renderer is unresponsive.
let tray = null;
function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
    tray = new Tray(iconPath);
    tray.setToolTip('Nexus Companion');
    const menu = Menu.buildFromTemplate([
      { label: 'Full dashboard',   click: () => switchMode('full') },
      { label: 'Companion (340×540)', click: () => switchMode('companion') },
      { label: 'Radio-only (compact)', click: () => switchMode('radio') },
      { type: 'separator' },
      { label: 'Show window', click: () => { try { mainWindow?.show(); mainWindow?.focus(); } catch {} } },
      { label: 'Reset layout', click: () => {
          try {
            saveState({ mode: 'full', full: {}, companion: {}, radio: {}, radioExpanded: false });
            switchMode('full');
          } catch {}
        } },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => { try { mainWindow?.show(); mainWindow?.focus(); } catch {} });
  } catch (err) {
    console.error('[main] tray failed:', err.message);
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  startKeyHook();
  registerSafeMode();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch {}
});
app.on('window-all-closed', () => {
  stopKeyHook();
  if (process.platform !== 'darwin') app.quit();
});
