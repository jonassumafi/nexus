// Renderer-side bridge for the shared Electron cleanup routine.
//
// On mount:
//   • arm the main-process quit hook so cleanupBeforeQuit will wait
//     for this window before destroying it;
//   • listen for the nexus:app:before-quit broadcast;
//   • when it fires, dispatch a plain window CustomEvent
//     'nexus:before-quit' so any component (socket owner, radio
//     connection hook, etc.) can clean itself up synchronously, wait a
//     short grace period for socket frames + UDP close to flush, then
//     ack readyToQuit so the shell proceeds.
//
// Non-Electron environments (web, dev): no-op.
//
// Usage:
//   useAppQuitHook();     // once, from a top-level component
//
//   useEffect(() => {
//     const onQuit = () => { socket.disconnect(); };
//     window.addEventListener('nexus:before-quit', onQuit);
//     return () => window.removeEventListener('nexus:before-quit', onQuit);
//   }, [socket]);
//
// Fallback: if the component never mounts (e.g. a very early crash),
// the main-process cleanup still proceeds after its 1.2-second ack
// timeout. Nothing stays stuck.

import { useEffect } from 'react';

const GRACE_MS = 200; // give the socket + UDP close frames a moment to flush

export default function useAppQuitHook() {
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.app?.armQuitHook || !api?.app?.onBeforeQuit) return;

    let unsubBeforeQuit = null;
    let armed = false;
    (async () => {
      try { await api.app.armQuitHook(); armed = true; } catch {}
    })();

    unsubBeforeQuit = api.app.onBeforeQuit(() => {
      try { window.dispatchEvent(new CustomEvent('nexus:before-quit')); } catch {}
      // Best-effort voice close — safe to call even if no session is open.
      try { api.udp?.close?.(); } catch {}
      setTimeout(() => {
        try { api.app.readyToQuit?.(); } catch {}
      }, GRACE_MS);
    });

    return () => {
      try { unsubBeforeQuit?.(); } catch {}
      if (armed) { try { api.app.disarmQuitHook?.(); } catch {} }
    };
  }, []);
}
