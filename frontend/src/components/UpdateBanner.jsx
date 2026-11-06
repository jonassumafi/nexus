// Compact corner card that shows auto-update status from Electron's
// electron-updater. Hidden by default; appears when a new version is
// found. Progress bar while downloading; "Install now" button when ready.
//
// Lives on top of the dashboard; dismissable without blocking the UI.

import { useEffect, useState } from 'react';

const DISMISS_LS_KEY = 'nexus_update_dismissed_version';

export default function UpdateBanner() {
  const [state, setState] = useState('idle'); // idle | checking | downloading | ready | error | none
  const [version, setVersion] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [dismissedVersion, setDismissedVersion] = useState(() => {
    try { return localStorage.getItem(DISMISS_LS_KEY) || null; } catch { return null; }
  });

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.update : null;
    if (!api) return;

    const offs = [];
    offs.push(api.on('checking',  () => setState(s => s === 'ready' ? s : 'checking')));
    offs.push(api.on('none',      () => setState('none')));
    offs.push(api.on('available', (info) => {
      setVersion(info?.version || null);
      setState('downloading');
      setProgress(0);
    }));
    offs.push(api.on('progress', (p) => {
      setState('downloading');
      setProgress(p?.percent || 0);
    }));
    offs.push(api.on('ready', (info) => {
      setVersion(info?.version || null);
      setState('ready');
    }));
    offs.push(api.on('error', (e) => {
      setError(e?.message || 'Update error');
      setState('error');
    }));

    return () => { for (const off of offs) try { off?.(); } catch {} };
  }, []);

  // Only ever show for the version we actually found. If the user clicked
  // "Later" on this version, hide until the next version arrives.
  if (state === 'idle' || state === 'none') return null;
  if (state === 'checking') return null;              // too noisy
  if (dismissedVersion && dismissedVersion === version && state !== 'ready') {
    // Downloading quietly in the background after an earlier dismiss. We
    // still show the "Install now" prompt once ready.
    return null;
  }
  if (state === 'error' && dismissedVersion === version) return null;

  const dismiss = () => {
    if (version) {
      setDismissedVersion(version);
      try { localStorage.setItem(DISMISS_LS_KEY, version); } catch {}
    }
  };
  const installNow = () => {
    try { window.electronAPI?.update?.installNow(); } catch {}
  };

  const base = {
    position: 'fixed', right: 16, bottom: 16, zIndex: 9999,
    maxWidth: 340, minWidth: 240,
    padding: 10,
    background: 'linear-gradient(180deg, var(--bg2), var(--bg1))',
    border: '1px solid var(--rim1)',
    borderRadius: 6,
    boxShadow: '0 10px 30px rgba(0,0,0,.5)',
    fontFamily: 'var(--font)',
    color: 'var(--fg0)',
    fontSize: 11,
    letterSpacing: '0.03em',
    display: 'flex', flexDirection: 'column', gap: 6,
  };
  const title = {
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: 'var(--cyan)', fontWeight: 700, marginBottom: 2,
  };

  if (state === 'error') {
    return (
      <div style={base} role="status">
        <span style={title}>Update error</span>
        <span style={{ color: 'var(--fg2)' }}>{error}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" onClick={dismiss} style={{ fontSize: 10, padding: '3px 10px' }}>Dismiss</button>
        </div>
      </div>
    );
  }

  if (state === 'downloading') {
    const pct = Math.max(0, Math.min(100, Math.round(progress)));
    return (
      <div style={base} role="status">
        <span style={title}>Nexus update downloading</span>
        <span style={{ color: 'var(--fg2)' }}>
          {version ? `v${version} · ${pct}%` : `${pct}%`}
        </span>
        <div style={{
          height: 6, background: 'var(--bg0)', border: '1px solid var(--rim0)',
          borderRadius: 3, overflow: 'hidden',
        }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: 'var(--cyan)', transition: 'width .2s ease',
          }} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" onClick={dismiss} style={{ fontSize: 10, padding: '3px 10px' }}>Hide</button>
        </div>
      </div>
    );
  }

  if (state === 'ready') {
    return (
      <div style={base} role="status">
        <span style={title}>Nexus update ready</span>
        <span style={{ color: 'var(--fg0)' }}>
          v{version} is downloaded. Install and restart?
        </span>
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <button
            className="btn go"
            onClick={installNow}
            style={{ fontSize: 11, padding: '4px 12px', fontWeight: 700 }}
          >Install now</button>
          <button className="btn" onClick={dismiss} style={{ fontSize: 10, padding: '4px 10px' }}>Later</button>
        </div>
      </div>
    );
  }

  return null;
}
