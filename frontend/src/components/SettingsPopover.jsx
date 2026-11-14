// Gear popover — radio-rig assignment entry points for both tuners,
// plus floating-window controls (opacity) and app-level graphics
// prefs (hardware acceleration). Skins live under the dedicated
// palette button next to the gear.

import { useEffect, useState } from 'react';
import { AnchoredPopover } from './Banner';
import {
  readWindowOpacity,
  writeWindowOpacity,
  resetWindowOpacity,
  onWindowOpacityChange,
  WINDOW_OPACITY_MIN,
  WINDOW_OPACITY_MAX,
  WINDOW_OPACITY_DEFAULT,
} from '../utils/windowOpacity';

export default function SettingsPopover({ anchorRef, onClose, onOpenRadioPicker, onOpenCommandRadioPicker }) {
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;

  // Window opacity (shared with the Global Chat's own slider).
  const [opacity, setOpacity] = useState(() => readWindowOpacity());
  useEffect(() => onWindowOpacityChange((v) => setOpacity(v)), []);
  const handleOpacity = (v) => {
    const next = writeWindowOpacity(v);
    setOpacity(next);
  };
  const handleOpacityReset = () => {
    const next = resetWindowOpacity();
    setOpacity(next);
  };

  // Interface zoom — webContents.setZoomFactor applied to the main
  // window. Range 75–150 %, default 100. Shortcuts Ctrl+=/Ctrl+-/Ctrl+0
  // also hit the same pref.
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await electron?.zoom?.get?.();
        if (!cancelled && typeof v === 'number') setZoom(v);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [electron]);
  const handleZoom = async (pct) => {
    const v = Math.max(0.75, Math.min(1.5, Number(pct) / 100));
    setZoom(v);
    try { await electron?.zoom?.set?.(v); } catch {}
  };
  const resetZoom = () => handleZoom(100);

  // Hardware acceleration — read from the Electron prefs file so
  // we can offer a Restart-now button when the user flips it.
  const [hwAccel, setHwAccel] = useState(null); // null = unknown yet
  const [hwDirty, setHwDirty] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await electron?.prefs?.get?.('hardwareAcceleration');
        if (cancelled) return;
        // Default ON when missing.
        setHwAccel(current === false ? false : true);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [electron]);
  const toggleHwAccel = async () => {
    const next = !hwAccel;
    setHwAccel(next);
    setHwDirty(true);
    try { await electron?.prefs?.set?.('hardwareAcceleration', next); } catch {}
  };
  const restartNow = () => {
    try { electron?.app?.relaunch?.(); } catch {}
  };

  const opacityPct = Math.round(opacity * 100);
  const atDefault  = Math.abs(opacity - WINDOW_OPACITY_DEFAULT) < 0.005;

  return (
    <AnchoredPopover anchorRef={anchorRef} width={300} onClose={onClose} label="Settings">
      <h4>Settings</h4>
      <div className="nxp-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          className="nxp-btn"
          style={{ width: '100%' }}
          onClick={() => { onClose?.(); onOpenRadioPicker?.(); }}
        >Crew radio rig…</button>
        {onOpenCommandRadioPicker && (
          <button
            className="nxp-btn"
            style={{ width: '100%' }}
            onClick={() => { onClose?.(); onOpenCommandRadioPicker?.(); }}
          >Command radio rig…</button>
        )}

        <div style={{ borderTop: '1px solid var(--rim0, #1A3A50)', margin: '4px 0 0' }} />

        {/* Window opacity — controls Global Chat (both popover and
            popout). Shared storage: both this slider and the chat
            header's slider read/write the same value. */}
        <div>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            fontSize: 11, color: 'var(--fg2)', letterSpacing: '0.04em',
            marginBottom: 4,
          }}>
            <span>Window opacity</span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--fg0)', fontWeight: 600,
              }}>{opacityPct}%</span>
              {!atDefault && (
                <button
                  onClick={handleOpacityReset}
                  title="Reset to 100%"
                  style={{
                    background: 'none', border: 0, padding: 0,
                    color: 'var(--acc, #66AADD)', cursor: 'pointer',
                    font: '600 10px Inter, system-ui, sans-serif',
                    letterSpacing: '0.06em', textDecoration: 'underline',
                  }}
                >Reset</button>
              )}
            </span>
          </div>
          <input
            type="range"
            min={Math.round(WINDOW_OPACITY_MIN * 100)}
            max={Math.round(WINDOW_OPACITY_MAX * 100)}
            step={1}
            value={opacityPct}
            onChange={(e) => handleOpacity(Number(e.target.value) / 100)}
            style={{ width: '100%', accentColor: 'var(--acc, #66AADD)' }}
          />
        </div>

        <div style={{ borderTop: '1px solid var(--rim0, #1A3A50)', margin: '4px 0 0' }} />

        {/* Interface zoom — scales the Full dashboard via
            webContents.setZoomFactor. 75–150 %, default 100 %.
            Ctrl+=, Ctrl+-, Ctrl+0 are also wired on the shell.
            Radio-only keeps its own approved footprint. */}
        <div>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            fontSize: 11, color: 'var(--fg2)', letterSpacing: '0.04em',
            marginBottom: 4,
          }}>
            <span>Interface zoom</span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--fg0)', fontWeight: 600,
              }}>{Math.round(zoom * 100)}%</span>
              {Math.abs(zoom - 1) > 0.005 && (
                <button
                  onClick={resetZoom}
                  title="Reset to 100%"
                  style={{
                    background: 'none', border: 0, padding: 0,
                    color: 'var(--acc, #66AADD)', cursor: 'pointer',
                    font: '600 10px Inter, system-ui, sans-serif',
                    letterSpacing: '0.06em', textDecoration: 'underline',
                  }}
                >Reset</button>
              )}
            </span>
          </div>
          <input
            type="range"
            min={75}
            max={150}
            step={5}
            value={Math.round(zoom * 100)}
            onChange={(e) => handleZoom(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--acc, #66AADD)' }}
          />
          <div style={{ fontSize: 10, color: 'var(--fg3)', marginTop: 2 }}>
            Shortcuts: Ctrl + = / Ctrl + - / Ctrl + 0
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--rim0, #1A3A50)', margin: '4px 0 0' }} />

        {/* Hardware acceleration. Pre-ready preference: Electron reads
            this before app.whenReady() and calls
            app.disableHardwareAcceleration() when off. Needs a restart
            to take effect — the Restart-now button appears after any
            change. */}
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--fg1)', fontWeight: 600 }}>
                Hardware acceleration
              </span>
              <span style={{ fontSize: 10, color: 'var(--fg3)', lineHeight: 1.35 }}>
                Fixes visual glitches on some computers. Restart required.
              </span>
            </div>
            <button
              onClick={toggleHwAccel}
              disabled={hwAccel === null}
              style={{
                background: hwAccel === false
                  ? 'var(--bg2, #0A1828)'
                  : 'color-mix(in srgb, var(--acc, #66AADD) 22%, var(--bg2, #0A1828))',
                border: `1px solid ${hwAccel === false ? 'var(--rim1, #2A5A7A)' : 'var(--acc, #66AADD)'}`,
                color: hwAccel === false ? 'var(--fg2)' : 'var(--fg0)',
                font: '700 10px Inter, system-ui, sans-serif',
                letterSpacing: '0.1em', padding: '5px 10px',
                borderRadius: 3, cursor: 'pointer',
                flex: 'none',
              }}
            >{hwAccel === false ? 'OFF' : 'ON'}</button>
          </div>
          {hwDirty && (
            <button
              onClick={restartNow}
              style={{
                marginTop: 6, width: '100%',
                background: 'linear-gradient(180deg, var(--bg3, #12263A), var(--bg2, #0A1828))',
                border: '1px solid var(--acc, #66AADD)',
                color: 'var(--fg0)',
                font: '700 11px Inter, system-ui, sans-serif',
                letterSpacing: '0.06em', padding: '6px 10px',
                borderRadius: 3, cursor: 'pointer',
              }}
            >Restart now</button>
          )}
        </div>
      </div>
    </AnchoredPopover>
  );
}
