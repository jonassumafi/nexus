// Narrow IPC bridge for the Nexus Setup renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupAPI', {
  // Skin tokens the main process resolved before window.show()
  getSkin()               { return ipcRenderer.invoke('setup:get-skin'); },

  // Install detection + payload metadata
  getContext()            { return ipcRenderer.invoke('setup:get-context'); },

  // Lifecycle actions
  install(opts)           { return ipcRenderer.invoke('setup:install', opts); },
  repair(opts)            { return ipcRenderer.invoke('setup:repair', opts); },
  uninstall(opts)         { return ipcRenderer.invoke('setup:uninstall', opts); },
  cancel()                { return ipcRenderer.invoke('setup:cancel'); },
  launchApp()             { return ipcRenderer.invoke('setup:launch-app'); },

  // Window controls
  minimize()              { return ipcRenderer.invoke('setup:minimize'); },
  close()                 { return ipcRenderer.invoke('setup:close'); },

  // Streaming progress
  onStep(handler) {
    const listener = (_e, step) => handler(step);
    ipcRenderer.on('setup:step', listener);
    return () => ipcRenderer.removeListener('setup:step', listener);
  },

  // Open native folder-picker for install dir
  pickFolder(current)     { return ipcRenderer.invoke('setup:pick-folder', current); },

  // Clipboard — for Copy log button on Failed screen
  copyText(text)          { return ipcRenderer.invoke('setup:copy', text); },
});
