// Dismissible dashboard banner that tells Windows players to run Nexus
// as administrator if their PTT key doesn't register while Star Citizen
// has focus. This is a Windows UIPI limitation: a non-elevated process
// cannot receive keyboard events while an elevated process (SC with
// EasyAntiCheat) is foreground. The low-level key hook (uiohook-napi)
// is installed correctly; Windows just refuses to deliver events to
// a lower-integrity process.
//
// The right permanent fix for the player is to enable "Run as
// administrator" on the Nexus shortcut. This banner tells them that.
//
// Only shown on Windows, only on the Full dashboard. Dismissed state
// persists in localStorage so the hint doesn't nag on every launch.

import { useEffect, useState } from 'react';

const LS_KEY = 'nexus_admin_hint_dismissed';

export default function AdminHintBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : null;
      const platform = api?.companion?.platform;
      if (platform !== 'win32') return;
      if (localStorage.getItem(LS_KEY) === '1') return;
      setVisible(true);
    } catch {}
  }, []);

  if (!visible) return null;

  return (
    <div
      role="note"
      style={{
        margin: '8px 10px 0',
        padding: '8px 10px',
        borderRadius: 4,
        border: '1px solid color-mix(in srgb, var(--amber) 55%, transparent)',
        background: 'color-mix(in srgb, var(--amber) 10%, var(--bg1))',
        color: 'var(--fg1)',
        font: '500 11px Inter, system-ui, sans-serif',
        display: 'flex', alignItems: 'flex-start', gap: 8,
        lineHeight: 1.45,
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: 'var(--amber)',
        marginTop: 5, flex: 'none',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ color: 'var(--fg0)', letterSpacing: '0.02em' }}>
          Push-to-talk not working in Star Citizen?
        </b>
        <div style={{ marginTop: 2, color: 'var(--fg2)' }}>
          Right-click your Nexus shortcut → Properties → Compatibility →
          check <b style={{ color: 'var(--fg0)' }}>“Run this program as an administrator”</b>, then
          relaunch. Elevated games block keystrokes from non-elevated apps.
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          try { localStorage.setItem(LS_KEY, '1'); } catch {}
          setVisible(false);
        }}
        title="Dismiss — I know about this"
        style={{
          flex: 'none',
          background: 'none', border: 0, padding: '2px 6px',
          color: 'var(--fg3)', cursor: 'pointer',
          font: '700 11px Inter, system-ui, sans-serif',
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}
      >
        Got it
      </button>
    </div>
  );
}
