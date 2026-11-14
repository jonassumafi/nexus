// Preload bridge for the Nexus Companion renderer.
//
// Exposes a narrow `window.electronAPI` object to the Nexus web page so it
// can:
//   • subscribe to global PTT events delivered from the OS-level key hook
//   • report the user's current PTT key so the main process can filter
//   • toggle always-on-top (pin)
//   • switch window modes (full / companion / radio)
//   • control the native window chrome (min / maxToggle / close)
//
// v0.6.2 — reverted to the native OS title bar. All of v0.6.0's injected
// chassis bezel + hover-reveal drag strip has been removed because they
// were swallowing clicks on buttons and inputs. The window now has a
// standard Windows frame; the renderer is a plain web page inside it.

const { contextBridge, ipcRenderer } = require('electron');
// Pull the version from package.json so the title-bar badge never drifts
// out of sync with the installer. Hardcoded strings here caused a 0.9.12
// badge to persist through the 0.9.13 build.
const APP_VERSION = (() => {
  try { return require('../package.json').version || 'dev'; }
  catch { return 'dev'; }
})();

// Log the native key-hook startup result once at launch so a quick DevTools
// peek (F12 or Ctrl+Alt+D) can confirm the hook is alive without flooding
// the console with every keystroke.
ipcRenderer.on('nexus:hook-status', (_e, payload) => {
  try {
    // eslint-disable-next-line no-console
    console.log('[hook-status]', payload);
  } catch {}
});

contextBridge.exposeInMainWorld('electronAPI', {
  companion: {
    platform: process.platform,
    version: APP_VERSION,
    // Baked at build time via electron-builder.udp.yml. Renderer uses this
    // to lock transport to UDP + hide the toggle. Also readable via the
    // ?udp=1 URL param (set by main.js urlFor()) so the single frontend
    // bundle doesn't need a separate build.
    udpOnly: process.env.NEXUS_UDP_ONLY === '1',
  },

  // ─── UDP voice (experimental) ─────────────────────────────────────────
  // Narrow bridge to the native-side dgram+Opus module. The renderer
  // feeds raw PCM frames (960 samples, 16-bit mono @ 48 kHz) via send();
  // the main process encodes + transmits. See electron/src/udp-voice.js.
  udp: {
    open(opts)   { return ipcRenderer.invoke('nexus:udp:open', opts); },
    // sessionId (from open()) is optional; without it, closes whatever is open.
    close(sessionId) { return ipcRenderer.invoke('nexus:udp:close', sessionId); },
    retune(opts) { return ipcRenderer.invoke('nexus:udp:retune', opts); },
    status()     { return ipcRenderer.invoke('nexus:udp:status'); },
    // ArrayBuffer/Int16Array shuttled over IPC — Electron serializes
    // structured-cloneable buffers efficiently (zero-copy for TypedArrays).
    send(pcm16)  { return ipcRenderer.invoke('nexus:udp:send', pcm16); },
    keepalive()  { return ipcRenderer.invoke('nexus:udp:keepalive'); },
    onRx(handler) {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on('nexus:udp:rx', listener);
      return () => ipcRenderer.removeListener('nexus:udp:rx', listener);
    },
  },

  // PTT bridge from the native OS-level key hook.
  onPTT(handler) {
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on('nexus:ptt', listener);
    return () => ipcRenderer.removeListener('nexus:ptt', listener);
  },

  setPttKey(key) {
    return ipcRenderer.invoke('nexus:setPttKey', key);
  },

  // v0.9 — two-radio PTT bindings. Pass { left?, right? } with key
  // names ('v', 'CapsLock'), mouse buttons ('Mouse4'), or null to clear.
  // Omitted keys preserve their current value.
  setPttKeys(bindings) {
    return ipcRenderer.invoke('nexus:setPttKeys', bindings);
  },

  // ─── Auto-updater ──────────────────────────────────────────────────────
  update: {
    checkNow()   { return ipcRenderer.invoke('nexus:update:checkNow'); },
    download()   { return ipcRenderer.invoke('nexus:update:download'); },
    installNow() { return ipcRenderer.invoke('nexus:update:installNow'); },
    on(eventName, handler) {
      const channels = {
        checking:  'nexus:update:checking',
        available: 'nexus:update:available',
        none:      'nexus:update:none',
        progress:  'nexus:update:progress',
        ready:     'nexus:update:ready',
        error:     'nexus:update:error',
      };
      const ch = channels[eventName];
      if (!ch) return () => {};
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on(ch, listener);
      return () => ipcRenderer.removeListener(ch, listener);
    },
  },

  // Window controls — minimize / maximize / close are now handled by
  // the native title bar directly, but keep the IPC in case any
  // in-app button still wants to invoke them.
  togglePin()      { return ipcRenderer.invoke('nexus:togglePin'); },
  setOpacity(v)    { return ipcRenderer.invoke('nexus:setOpacity', v); },
  getOpacity()     { return ipcRenderer.invoke('nexus:getOpacity'); },
  setMode(mode)    { return ipcRenderer.invoke('nexus:setMode', mode); },
  cycleMode()      { return ipcRenderer.invoke('nexus:cycleMode'); },
  setRadioExpanded(exp) { return ipcRenderer.invoke('nexus:setRadioExpanded', exp); },
  minimize()       { return ipcRenderer.invoke('nexus:minimize'); },
  maxToggle()      { return ipcRenderer.invoke('nexus:maxToggle'); },
  close()          { return ipcRenderer.invoke('nexus:close'); },

  // Radio-only: renderer measures its overlay with a ResizeObserver and
  // asks the main process to shrink / grow the dedicated radio window
  // to match. Main keeps the top-right corner fixed so growth spills
  // leftward + downward, matching the HUD anchor.
  radio: {
    resize(width, height) { return ipcRenderer.invoke('nexus:radio:resize', { width, height }); },
  },

  // Skin mirror for the custom installer. Fire-and-forget; writes a
  // plain JSON file that Nexus Setup reads to match colors.
  saveSkin(id)     { return ipcRenderer.invoke('nexus:save-skin', id); },

  onWindowState(handler) {
    const listener = (_e, state) => handler(state);
    ipcRenderer.on('nexus:window-state', listener);
    return () => ipcRenderer.removeListener('nexus:window-state', listener);
  },

  // Detachable Global Chat popout (frameless, pinnable, adjustable opacity).
  chatPopout: {
    open:        () => ipcRenderer.invoke('nexus:chatPopout:open'),
    close:       () => ipcRenderer.invoke('nexus:chatPopout:close'),
    setOpacity:  (v) => ipcRenderer.invoke('nexus:chatPopout:setOpacity', v),
    togglePin:   () => ipcRenderer.invoke('nexus:chatPopout:togglePin'),
    minimize:    () => ipcRenderer.invoke('nexus:chatPopout:minimize'),
    isOpen:      () => ipcRenderer.invoke('nexus:chatPopout:isOpen'),
  },

  // App preferences (persisted to a small JSON file next to userData).
  // Currently just hardwareAcceleration — flipped off, Electron reads
  // this before app.whenReady() on next launch and calls
  // app.disableHardwareAcceleration().
  prefs: {
    get: (key) => ipcRenderer.invoke('nexus:prefs:get', key),
    set: (key, value) => ipcRenderer.invoke('nexus:prefs:set', key, value),
  },
  app: {
    relaunch: () => ipcRenderer.invoke('nexus:app:relaunch'),
  },

  // Interface zoom — Full dashboard webContents.setZoomFactor.
  // Range 0.75..1.5, persisted to prefs.json. Radio-only is unaffected;
  // its HUD is an approved fixed footprint.
  zoom: {
    get: ()   => ipcRenderer.invoke('nexus:zoom:get'),
    set: (v)  => ipcRenderer.invoke('nexus:zoom:set', v),
  },
});
