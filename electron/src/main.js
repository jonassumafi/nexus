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
const { autoUpdater } = require('electron-updater');

const NEXUS_URL = process.env.NEXUS_URL || 'https://nexus-missions.space';

// Close-to-tray flag. The X button on the custom title bar hides the
// window; actual quit only happens via the tray menu or an auto-update
// restart, which both set this true before firing app.quit().
let isQuitting = false;

// UDP-only sibling build. Set at build time via electron-builder.udp.yml's
// cross-env, or detected at runtime via the product name baked in by
// electron-builder. One frontend bundle, two Electron shells — the UDP
// shell appends ?udp=1 to every loadURL so the renderer locks transport.
// Detection chain for the UDP sibling build:
//   1. NEXUS_UDP_ONLY env (dev runs via `cross-env` in package.json)
//   2. package.json `name` contains "udp" (set by electron-builder.udp.yml
//      extraMetadata override — this is what works in the packaged installer)
//   3. app.getName() contains "UDP" (fallback if a future rename only
//      touches productName)
const UDP_ONLY = process.env.NEXUS_UDP_ONLY === '1'
  || /udp/i.test(app.getName() || '')
  || /udp/i.test(app.getAppPath() || '');
function urlFor(path) {
  const base = NEXUS_URL + path;
  if (!UDP_ONLY) return base;
  return base + (base.includes('?') ? '&' : '?') + 'udp=1';
}

// electron-updater config:
//   • autoDownload=false — nothing is pulled until the renderer calls
//     nexus:update:download (user clicks Download / pill)
//   • autoInstallOnAppQuit=false — the user opts into the restart
//   • allowPrerelease=false — stable channel only
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;
autoUpdater.logger = {
  info:  (...args) => console.log('[updater]', ...args),
  warn:  (...args) => console.warn('[updater]', ...args),
  error: (...args) => console.error('[updater]', ...args),
  debug: () => {},
};

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
    // v0.9.0 — grew by ~120px vertically to fit the Command tuner card.
    size: { width: 340, height: 660 },
    minSize: { width: 340, height: 540 },
  },
  radio: {
    path: '/radio',
    // v0.9.0 — Command tuner card added below the primary strip. Default
    // height raised to accommodate; user can still drag taller to see more
    // peers or shrink to just the primary strip.
    size: { width: 560, height: 290 },
    minSize: { width: 420, height: 120 },
  },
};

// ─── Persisted state ──────────────────────────────────────────────────────
const STATE_PATH = () => path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH(), 'utf8');
    const s = JSON.parse(raw);
    // Pin is remembered per mode. Before v0.9.21 one `pinned` flag
    // applied to every mode, so pinning the radio widget also pinned the
    // full dashboard: a screen-sized always-on-top window that covered
    // everything. Migrate that flag to the compact modes only.
    const pm = (s.pinnedModes && typeof s.pinnedModes === 'object') ? s.pinnedModes
      : { full: false, companion: !!s.pinned, radio: !!s.pinned };
    return {
      mode: ['full', 'companion', 'radio'].includes(s.mode) ? s.mode : 'full',
      pinned: !!s.pinned,
      pinnedModes: { full: !!pm.full, companion: !!pm.companion, radio: !!pm.radio },
      full:      s.full      || {},
      companion: s.companion || {},
      radio:     s.radio     || {},
      radioExpanded: !!s.radioExpanded,
    };
  } catch {
    return { mode: 'full', pinned: false, pinnedModes: { full: false, companion: false, radio: false },
      full: {}, companion: {}, radio: {}, radioExpanded: false };
  }
}

// Apply the current mode's pin preference to the window.
function applyPin() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const on = !!loadState().pinnedModes[currentMode];
  // See createWindow for the level choice ('floating').
  try { mainWindow.setAlwaysOnTop(on, 'floating'); } catch {}
  return on;
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
// v0.9 — two-radio PTT bindings. `pttKeys.left` and `pttKeys.right` each
// hold either a key name ('v', 'CapsLock'), a mouse-button name ('Mouse4'),
// or null (unbound). Legacy single-key API maps to the 'right' slot so
// pre-v0.9 clients keep working.
let currentPttKey = 'v'; // legacy mirror of pttKeys.right
const pttKeys = { left: null, right: 'v' };
const pttDownState = { left: false, right: false };

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
    // Shown in the taskbar, Alt+Tab and Task Manager.
    title: `Nexus ${app.getVersion()}`,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    // Frameless — the custom <TitleBar /> component drawn by the renderer
    // owns the drag region and the min / max / close controls. v0.6.3
    // rebuilds this cleanly: drag region is limited to empty bar space,
    // every control is explicitly no-drag, nothing is overlayed on top
    // of app content.
    frame: false,
    alwaysOnTop: !!state.pinnedModes.full,
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

  // Restore a maximized full window as maximized (the on('maximize')
  // handler snaps it flush to the work area) rather than as a normal
  // window at the raw maximized bounds, which opened offset by -8px.
  if (state.full && state.full.maximized) {
    try { mainWindow.maximize(); } catch {}
  }

  if (state.pinnedModes.full) {
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

  // Belt-and-suspenders: also disable background throttling on the
  // existing webContents, in case webPreferences wasn't honored for some
  // reason on this platform / Electron version.
  try { mainWindow.webContents.setBackgroundThrottling(false); } catch {}

  // Clear the HTTP cache on launch AND await it before the first load, so
  // the window never gets served stale bundles from a prior session. The
  // on-disk cost of a cold-start asset fetch is negligible compared to the
  // risk of running against a prior version's JS — which is exactly how
  // v0.4.0's broken /radio bundle persisted after upgrading to v0.5.0.
  // Backend-only / server-side radio-routing fixes land as soon as the
  // user relaunches the app, with no electron-updater installer needed.
  session.defaultSession.clearCache()
    .catch(() => {})
    .finally(() => {
      mainWindow.loadURL(urlFor(MODES[currentMode].path));
    });

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
    // Fresh state, not createWindow's snapshot: this fires again on every
    // mode switch, and the pin button must show the new mode's pin.
    mainWindow.webContents.send('nexus:window-state', {
      pinned: !!loadState().pinnedModes[currentMode],
      compact: false,
      mode: currentMode,
      radioExpanded,
    });
  });

  mainWindow.on('move',   persistBounds);
  mainWindow.on('resize', persistBounds);
  mainWindow.on('closed', () => { mainWindow = null; stopKeyHook(); });

  // Close-to-tray: Discord-style. X hides the window but keeps the app
  // running in the tray. The user has to pick Quit from the tray menu
  // (or an auto-update restart sets isQuitting=true) to actually exit.
  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });

  // Maximize-to-work-area fix. Frameless Electron windows overshoot
  // the screen by ~8px on maximize because Windows applies invisible
  // resize-border padding. Intercept and set bounds directly to the
  // active display's work area so the content sits flush with the top
  // edge. The window still reports isMaximized() === true afterward.
  mainWindow.on('maximize', () => {
    try {
      const display = screen.getDisplayNearestPoint(mainWindow.getBounds());
      mainWindow.setBounds(display.workArea);
    } catch {}
    persistBounds();
  });
  mainWindow.on('unmaximize', persistBounds);
  // Keep "Nexus <version>" instead of each page's own <title>.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
}

// Compute initial window bounds for a mode, clamping to primary display.
function computeBounds(mode, state) {
  const m = MODES[mode];
  const saved = state[mode] || {};
  const size = (mode === 'radio' && state.radioExpanded && m.sizeExpanded)
    ? m.sizeExpanded
    : m.size;

  const area = screen.getPrimaryDisplay().workArea;
  let w = Number.isFinite(saved.width)  ? saved.width  : size.width;
  let h = Number.isFinite(saved.height) ? saved.height : size.height;
  let x = Number.isFinite(saved.x) ? saved.x : undefined;
  let y = Number.isFinite(saved.y) ? saved.y : undefined;

  // A "normal" size that fills the screen is a maximized rect saved by
  // pre-0.9.21 builds. Fall back to the default size, centered (the
  // maximized flag, if set, maximizes it properly after creation).
  if (w >= area.width && h >= area.height) {
    w = size.width; h = size.height; x = undefined; y = undefined;
  }
  w = Math.min(w, area.width);
  h = Math.min(h, area.height);

  // Keep the window at least mostly inside the display.
  if (x !== undefined && (x < area.x - 100 || x > area.x + area.width - 100)) x = undefined;
  if (y !== undefined && (y < area.y - 100 || y > area.y + area.height - 100)) y = undefined;
  // No usable saved position → center on the work area.
  if (x === undefined || y === undefined) {
    x = Math.round(area.x + (area.width - w) / 2);
    y = Math.round(area.y + (area.height - h) / 2);
  }

  return { x, y, width: w, height: h };
}

// Persist current window bounds for the active mode.
function persistBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // While maximized, getBounds() is the maximized rect (-8,-8 + 16px on
  // Windows); saving that as a normal size made the next launch open a
  // misaligned screen-sized window. Save the normal (restored) bounds and
  // a maximized flag instead.
  const maximized = (() => { try { return mainWindow.isMaximized(); } catch { return false; } })();
  const b = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  const s = loadState();
  const key = currentMode;
  // v0.8.0 — persist width/height for every mode (companion + radio are
  // now user-resizable). Each mode remembers its own dimensions.
  const nextModeBounds = {
    ...s[key], x: b.x, y: b.y, width: b.width, height: b.height, maximized,
  };
  saveState({ [key]: nextModeBounds });
}

// Switch to a different mode. Persists current bounds, loads the new
// route, resizes to the new mode's dimensions.
//
// Placement rules (v0.9.2+):
//   full       → maximize to the work area of the current display
//   companion  → center on the current display's work area
//   radio      → center on the current display's work area
//
// Reason: previously the companion / radio modes would "snap" to a
// stale saved top-left that was often off-screen or at (0,0) on first
// switch, which looked like the window had warped away. Centering on
// switch gives the user a predictable starting point they can then
// drag wherever they want.
//
// v0.9.21: full mode no longer force-maximizes. A maximized window can't
// be dragged, and combined with pin it made the dashboard feel stuck. It
// comes back maximized only if the user left it maximized, otherwise at
// its last normal size. Pin is applied per mode (applyPin).
//
// opts.force re-applies placement even when already in nextMode (tray
// "Reset layout" while in full mode used to do nothing).
function switchMode(nextMode, opts = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!MODES[nextMode] || (nextMode === currentMode && !opts.force)) return;
  if (nextMode !== currentMode) persistBounds();
  currentMode = nextMode;
  saveState({ mode: currentMode });

  const m = MODES[currentMode];
  const state = loadState();
  // All modes are user-resizable (and draggable). The per-mode minSize
  // keeps shrinking the companion / radio-only windows to a floor that
  // still renders their layout. Full mode gets maximized below and the
  // user drags it via the OS; companion / radio windows get their
  // frameless drag region from the renderer's title bar.
  mainWindow.setResizable(true);
  mainWindow.setMovable(true);
  mainWindow.setMinimumSize(m.minSize.width, m.minSize.height);

  if (currentMode === 'full') {
    // Restore the last normal size/position (computeBounds rejects stale
    // screen-sized values and centers when there's none), then maximize
    // only if the user left it maximized — the on('maximize') handler
    // snaps that flush to the work area.
    const b = computeBounds('full', state);
    try { if (mainWindow.isMaximized()) mainWindow.unmaximize(); } catch {}
    mainWindow.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height }, true);
    if (state.full && state.full.maximized) {
      try { mainWindow.maximize(); } catch {}
    }
  } else {
    // Companion + radio: resize to the mode's default size (or whatever
    // the user last resized this mode to) and center on the active
    // display. We do not reuse saved x/y here — the user explicitly
    // asked for centering on switch so they can drag from a known
    // predictable starting point.
    const saved = state[currentMode] || {};
    const width  = Number.isFinite(saved.width)  ? saved.width  : m.size.width;
    const height = Number.isFinite(saved.height) ? saved.height : m.size.height;
    try { if (mainWindow.isMaximized()) mainWindow.unmaximize(); } catch {}
    mainWindow.setSize(width, height, true);
    try {
      const display = screen.getDisplayNearestPoint(mainWindow.getBounds());
      const area = display.workArea;
      const cx = Math.round(area.x + (area.width  - width)  / 2);
      const cy = Math.round(area.y + (area.height - height) / 2);
      mainWindow.setPosition(cx, cy);
    } catch {}
  }
  applyPin();
  // Clear cache on mode switch too, so any mid-session frontend deploy is
  // picked up without a full app relaunch.
  session.defaultSession.clearCache()
    .catch(() => {})
    .finally(() => {
      mainWindow.loadURL(urlFor(MODES[currentMode].path));
    });
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

    // v0.9 — fire PTT for whichever tuner's binding matches. If both
    // tuners share a binding (shouldn't happen in UI — duplicate rejection
    // is enforced client-side — but defend here too) we fire the right
    // tuner only. The renderer handles independent transmit chains per
    // tuner id.
    const matchTuner = (candidate) => {
      const c = normKey(candidate);
      if (pttKeys.right && c === normKey(pttKeys.right)) return 'right';
      if (pttKeys.left  && c === normKey(pttKeys.left))  return 'left';
      return null;
    };
    const firePttDown = (tunerId) => {
      if (!tunerId || pttDownState[tunerId]) return;
      pttDownState[tunerId] = true;
      pttDown = pttDownState.left || pttDownState.right;
      mainWindow?.webContents.send('nexus:ptt', { down: true, tunerId });
    };
    const firePttUp = (tunerId) => {
      if (!tunerId || !pttDownState[tunerId]) return;
      pttDownState[tunerId] = false;
      pttDown = pttDownState.left || pttDownState.right;
      mainWindow?.webContents.send('nexus:ptt', { down: false, tunerId });
    };

    uIOhook.on('keydown', (e) => firePttDown(matchTuner(nameFor(e.keycode))));
    uIOhook.on('keyup',   (e) => firePttUp  (matchTuner(nameFor(e.keycode))));

    // Mouse-button PTT. Side buttons (Mouse4+) only; left/middle/right
    // (1-3) are rejected to avoid colliding with normal UI clicks.
    uIOhook.on('mousedown', (e) => {
      if (!e || typeof e.button !== 'number' || e.button < 4) return;
      firePttDown(matchTuner(`Mouse${e.button}`));
    });
    uIOhook.on('mouseup', (e) => {
      if (!e || typeof e.button !== 'number' || e.button < 4) return;
      firePttUp(matchTuner(`Mouse${e.button}`));
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
// Legacy single-key API — kept for backwards compatibility. Maps to the
// 'right' tuner slot so old clients that only know one PTT key keep
// working. Dual-radio clients should use nexus:setPttKeys instead.
ipcMain.handle('nexus:setPttKey', (_e, key) => {
  const k = String(key || 'v');
  if (normKey(k) !== normKey(pttKeys.right)) {
    pttKeys.right = k;
    currentPttKey = k;
    console.log('[main] PTT key (right/legacy) updated to', k);
  }
  return true;
});

// v0.9 — two-radio PTT bindings. Accepts { left?, right? } with either
// a key name, mouse button name, or null to clear. Only the keys passed
// are updated; omitted keys preserve their current value.
ipcMain.handle('nexus:setPttKeys', (_e, bindings) => {
  const next = bindings || {};
  if ('left' in next) {
    pttKeys.left = next.left ? String(next.left) : null;
    if (pttDownState.left && pttKeys.left === null) {
      pttDownState.left = false;
      mainWindow?.webContents.send('nexus:ptt', { down: false, tunerId: 'left' });
    }
  }
  if ('right' in next) {
    pttKeys.right = next.right ? String(next.right) : null;
    currentPttKey = pttKeys.right || 'v';
    if (pttDownState.right && pttKeys.right === null) {
      pttDownState.right = false;
      mainWindow?.webContents.send('nexus:ptt', { down: false, tunerId: 'right' });
    }
  }
  console.log('[main] PTT keys →', { left: pttKeys.left, right: pttKeys.right });
  return { left: pttKeys.left, right: pttKeys.right };
});

ipcMain.handle('nexus:togglePin', () => {
  if (!mainWindow) return false;
  // Pin belongs to the current mode only (see loadState).
  const next = !mainWindow.isAlwaysOnTop();
  const pinnedModes = { ...loadState().pinnedModes, [currentMode]: next };
  saveState({ pinnedModes });
  return applyPin();
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

// ─── Skin mirror (for the custom installer) ───────────────────────────
// Renderer's localStorage lives inside Chromium's LevelDB, which the
// installer cannot practically read. We mirror the current skin id to a
// plain JSON file in userData so the installer can match the app's
// colors on first paint. Writes are idempotent and fire-and-forget; the
// app never reads this file back.
const SKIN_PATH = () => path.join(app.getPath('userData'), 'skin.json');
ipcMain.handle('nexus:save-skin', (_e, skin) => {
  try {
    const id = typeof skin === 'string' ? skin.trim() : '';
    if (!id) return false;
    fs.mkdirSync(path.dirname(SKIN_PATH()), { recursive: true });
    fs.writeFileSync(SKIN_PATH(), JSON.stringify({ skin: id }, null, 2));
    return true;
  } catch { return false; }
});

// ─── UDP voice (experimental) ─────────────────────────────────────────
// Thin IPC → udp-voice module. Renderer owns the mic PCM path; main
// process owns the encoder + socket. See src/udp-voice.js for the wire
// format. onRx forwards raw packet buffers back to the renderer, which
// decodes them in step 3.
const udpVoice = require('./udp-voice');
let udpRxUnsub = null;
ipcMain.handle('nexus:udp:open', (_e, opts) => {
  try {
    const info = udpVoice.open(opts || {});
    udpRxUnsub?.();
    udpRxUnsub = udpVoice.onRx((buf) => {
      try { mainWindow?.webContents?.send('nexus:udp:rx', buf); } catch {}
    });
    return { ok: true, ...info };
  } catch (err) { return { ok: false, error: err.message }; }
});
// close(sessionId): a stale id (late cleanup from the previous view) is
// ignored entirely. That includes the RX forwarder, which belongs to the
// live session; dropping it would leave the new session open but deaf.
ipcMain.handle('nexus:udp:close', (_e, sessionId) => {
  try {
    if (!udpVoice.isCurrent(sessionId)) return { ok: true, ignored: true };
    udpRxUnsub?.(); udpRxUnsub = null;
    udpVoice.close(sessionId);
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('nexus:udp:retune', (_e, opts) => {
  try { udpVoice.retune(opts || {}); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('nexus:udp:send', (_e, pcm16) => {
  try {
    // IPC may hand us an ArrayBuffer, a Buffer, or a typed array. Normalize.
    let buf;
    if (Buffer.isBuffer(pcm16)) buf = pcm16;
    else if (pcm16 instanceof ArrayBuffer) buf = Buffer.from(pcm16);
    else if (pcm16?.buffer) buf = Buffer.from(pcm16.buffer, pcm16.byteOffset || 0, pcm16.byteLength);
    else return { ok: false, error: 'bad pcm payload' };
    const n = udpVoice.send(buf);
    return { ok: true, encodedBytes: n };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('nexus:udp:keepalive', () => {
  try { udpVoice.keepalive(); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('nexus:udp:status', () => udpVoice.status());

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
  chatPopout.loadURL(urlFor('/chat-popout'));
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
            // Also unpins every mode: a pinned window is the usual reason
            // someone reaches for "Reset layout".
            saveState({ mode: 'full', full: {}, companion: {}, radio: {}, radioExpanded: false,
              pinned: false, pinnedModes: { full: false, companion: false, radio: false } });
            switchMode('full', { force: true });
          } catch {}
        } },
      { type: 'separator' },
      { label: 'Quit Nexus', click: () => { isQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => { try { mainWindow?.show(); mainWindow?.focus(); } catch {} });
  } catch (err) {
    console.error('[main] tray failed:', err.message);
  }
}

// ─── Single-instance guard ───────────────────────────────────────────────
// Prevents the "two Nexus windows open and each thinks it's the only one"
// situation. First launch takes the lock; any subsequent launch (double-
// click on the desktop shortcut while the app is already running, auto-
// start firing while the user has it open, etc.) exits immediately after
// signalling the first instance to show/focus its window.
//
// Also fixes the knock-on Discord re-login prompt: without the lock, the
// second Electron process couldn't share Chromium's LevelDB profile with
// the first, so its localStorage read came back empty and it bounced to
// the login gate.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  // If the primary is on its way out (tray Quit, auto-update restart),
  // don't try to show a window that's about to be destroyed.
  if (isQuitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

// Windows AppUserModelId — groups all Nexus taskbar entries, shortcuts,
// and jump lists under one identity. Without this, a shortcut launch
// and an auto-start launch can appear as two separate apps in the
// taskbar even when they're the same process — which looked like "two
// instances" to users even when the single-instance lock was holding.
if (process.platform === 'win32') {
  try { app.setAppUserModelId('space.nexus-missions.companion-udp'); } catch {}
}

// ─── Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  startKeyHook();
  registerSafeMode();
  createTray();
  // First check 4s after launch (lets the renderer mount its IPC listeners),
  // then every 10 min while running. Unpacked dev builds no-op internally.
  const runCheck = () => {
    try { autoUpdater.checkForUpdates(); }
    catch (err) { console.warn('[updater] check failed:', err?.message); }
  };
  setTimeout(runCheck, 4000);
  setInterval(runCheck, 10 * 60 * 1000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ─── Auto-updater events → renderer ───────────────────────────────────────
// The renderer shows a small banner using these channels. The main process
// is the source of truth; IPC is one-way (main → renderer) for status +
// progress, and two-way for user actions ("install now", "later").
autoUpdater.on('checking-for-update', () => {
  mainWindow?.webContents.send('nexus:update:checking');
});
autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('nexus:update:available', {
    version: info?.version,
    releaseDate: info?.releaseDate,
    releaseNotes: info?.releaseNotes,
  });
});
autoUpdater.on('update-not-available', () => {
  mainWindow?.webContents.send('nexus:update:none');
});
autoUpdater.on('download-progress', (p) => {
  mainWindow?.webContents.send('nexus:update:progress', {
    percent: Math.round(p?.percent || 0),
    bytesPerSecond: p?.bytesPerSecond || 0,
    transferred: p?.transferred || 0,
    total: p?.total || 0,
  });
});
autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send('nexus:update:ready', {
    version: info?.version,
    releaseNotes: info?.releaseNotes,
  });
});
autoUpdater.on('error', (err) => {
  console.warn('[updater] error:', err?.message);
  mainWindow?.webContents.send('nexus:update:error', { message: err?.message });
});

ipcMain.handle('nexus:update:checkNow', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, version: result?.updateInfo?.version || null };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
});
ipcMain.handle('nexus:update:download', async () => {
  // Kicks off the manual download. autoDownload is false, so without this
  // the user would be stuck at "update available" forever.
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
});
ipcMain.handle('nexus:update:installNow', () => {
  // Fires the install + restart flow immediately. The user should save
  // whatever they're doing first — we don't force a confirmation here
  // because the renderer already does.
  isQuitting = true;
  try { autoUpdater.quitAndInstall(false, true); }
  catch (err) { console.error('[updater] quitAndInstall failed:', err?.message); }
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch {}
});
app.on('window-all-closed', () => {
  stopKeyHook();
  if (process.platform !== 'darwin') app.quit();
});
