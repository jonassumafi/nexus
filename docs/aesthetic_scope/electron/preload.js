// Preload bridge for the Nexus Companion renderer.
//
// Exposes a narrow `window.electronAPI` object to the Nexus web page so it
// can:
//   • subscribe to global PTT events delivered from the OS-level key hook
//   • report the user's current PTT key so the main process can filter
//   • toggle always-on-top (pin)
//   • toggle compact mode (340×540 ↔ full)
//   • receive the initial window state (pinned/compact) so the UI can
//     render its toggle buttons in the right position

const { contextBridge, ipcRenderer } = require('electron');

// Inject the drag region CSS as early as possible so the frameless window
// can be moved by click-and-dragging the Nexus topbar brand strip.
// Interactive elements inside the topbar are explicitly marked "no-drag"
// so clicks still land on them. We also add a bit of top-right padding so
// the titleBarOverlay's three window-control buttons (drawn by Chromium
// at height 36px) don't cover anything important.
// Inject the "custom bespoke window" styling:
//   • The BrowserWindow is transparent — html/body must also be transparent
//     so no rectangle shows through.
//   • #root gets 10px of margin from the window edge, a rounded 10px
//     border-radius, a thin Nexus-blue bevel, and a big dark ambient
//     shadow that fades into the transparent margin — giving the app the
//     look of a floating bespoke panel on top of the desktop or game,
//     instead of a Windows window with content inside.
//   • The brand strip (.topbar) is the drag region, with no-drag on
//     interactive elements inside.
function injectCompanionStyles() {
  // Two frame recipes: wide windows (dashboard) get the big floating-panel
  // treatment with 10px gap + ambient shadow. Narrow windows (radio widget)
  // get a minimal flush-fit frame — a tiny widget can't afford to lose
  // 20px of usable real estate to a shadow gap.
  const css = `
    html, body {
      background: transparent !important;
    }
    #root {
      position: fixed !important;
      overflow: hidden !important;
      background: var(--bg0, #020C14) !important;
    }
    /* Wide-window frame: dashboard, companion. */
    @media (min-width: 400px) {
      #root {
        inset: 10px !important;
        width: calc(100vw - 20px) !important;
        height: calc(100vh - 20px) !important;
        border-radius: 10px !important;
        border: 1px solid var(--rim1, #2A5A7A) !important;
        box-shadow:
          0 1px 0 rgba(150, 210, 255, .14) inset,
          0 0 0 1px #000,
          0 10px 30px rgba(0, 0, 0, .6),
          0 0 60px rgba(40, 110, 170, .15) !important;
      }
    }
    /* Narrow-window frame: radio widget. Flush, minimal shadow. */
    @media (max-width: 399px) {
      #root {
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        border-radius: 6px !important;
        border: 1px solid var(--rim1, #2A5A7A) !important;
        box-shadow:
          0 1px 0 rgba(150, 210, 255, .14) inset,
          0 4px 12px rgba(0, 0, 0, .5) !important;
      }
    }
    /* The .topbar brand strip is the drag region for the dashboard mode.
       The radio widget provides its own drag region (see .r-drag below). */
    .topbar {
      -webkit-app-region: drag;
    }
    .topbar button,
    .topbar a,
    .topbar input,
    .topbar .brand img,
    .topbar [role="button"],
    .nexus-no-drag,
    [data-nexus-chip],
    [data-nexus-wincontrols],
    [data-nexus-wincontrols] * {
      -webkit-app-region: no-drag;
    }
    /* Radio widget drag + no-drag */
    .r-drag { -webkit-app-region: drag; }
    .r-drag button, .r-drag a, .r-drag input, .r-nodrag {
      -webkit-app-region: no-drag;
    }
  `;
  const inject = () => {
    if (!document.head) {
      document.addEventListener('DOMContentLoaded', inject, { once: true });
      return;
    }
    const style = document.createElement('style');
    style.setAttribute('data-nexus-companion', 'frame');
    style.textContent = css;
    document.head.appendChild(style);
  };
  inject();
}
injectCompanionStyles();

contextBridge.exposeInMainWorld('electronAPI', {
  companion: {
    platform: process.platform,
    version: '0.4.0',
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

  // Window controls.
  togglePin()      { return ipcRenderer.invoke('nexus:togglePin'); },
  setMode(mode)    { return ipcRenderer.invoke('nexus:setMode', mode); },
  cycleMode()      { return ipcRenderer.invoke('nexus:cycleMode'); },
  setRadioExpanded(exp) { return ipcRenderer.invoke('nexus:setRadioExpanded', exp); },
  minimize()       { return ipcRenderer.invoke('nexus:minimize'); },
  maxToggle()      { return ipcRenderer.invoke('nexus:maxToggle'); },
  close()          { return ipcRenderer.invoke('nexus:close'); },

  // Initial window state (pinned/compact) sent by main after the page loads.
  onWindowState(handler) {
    const listener = (_e, state) => handler(state);
    ipcRenderer.on('nexus:window-state', listener);
    return () => ipcRenderer.removeListener('nexus:window-state', listener);
  },
});
