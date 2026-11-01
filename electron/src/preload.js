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

contextBridge.exposeInMainWorld('electronAPI', {
  companion: {
    platform: process.platform,
    version: '0.6.7',
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

  // Window controls — minimize / maximize / close are now handled by
  // the native title bar directly, but keep the IPC in case any
  // in-app button still wants to invoke them.
  togglePin()      { return ipcRenderer.invoke('nexus:togglePin'); },
  setMode(mode)    { return ipcRenderer.invoke('nexus:setMode', mode); },
  cycleMode()      { return ipcRenderer.invoke('nexus:cycleMode'); },
  setRadioExpanded(exp) { return ipcRenderer.invoke('nexus:setRadioExpanded', exp); },
  minimize()       { return ipcRenderer.invoke('nexus:minimize'); },
  maxToggle()      { return ipcRenderer.invoke('nexus:maxToggle'); },
  close()          { return ipcRenderer.invoke('nexus:close'); },

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
});
