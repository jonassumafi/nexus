// Radio-only window mode — the compact overlay players keep visible on
// top of Star Citizen. The entire radio UI lives in <RadioOverlay/>; this
// page just supplies the frame (TitleBar with mode-switcher + pin/opacity
// controls in the extras slot) and mounts the overlay beneath it.

import { useEffect, useState } from 'react';
import TitleBar from '../components/TitleBar';
import RadioTwinTiles from '../components/RadioTwinTiles';
import OpacityIcon from '../components/OpacityIcon';
import UpdatePill from '../components/UpdatePill';
import useUpdateFlow from '../hooks/useUpdateFlow';

export default function RadioWidget() {
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;
  const [pinned,  setPinned]  = useState(false);
  const [opacity, setOpacity] = useState(1);
  const [opacityOpen, setOpacityOpen] = useState(false);
  const [updatePillGreen, setUpdatePillGreen] = useState(false);
  const updateFlow = useUpdateFlow();

  // Hydrate pin + opacity from Electron main-process truth.
  useEffect(() => {
    (async () => {
      try {
        const v = await electron?.getOpacity?.();
        if (typeof v === 'number') setOpacity(v);
      } catch {}
    })();
  }, [electron]);

  useEffect(() => {
    if (!electron?.onWindowState) return;
    return electron.onWindowState((s) => {
      if (s && typeof s.pinned === 'boolean') setPinned(s.pinned);
    });
  }, [electron]);

  // Mode switcher + pin/opacity live in the titlebar's extras slot
  // alongside the version chip so they don't eat space in the radio rows.
  const extras = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, WebkitAppRegion: 'no-drag' }}>
      <ExtraBtn title="Full dashboard" onClick={() => electron?.setMode?.('full')}>⊞</ExtraBtn>
      <ExtraBtn title="Companion"      onClick={() => electron?.setMode?.('companion')}>▬</ExtraBtn>
      <div style={{ position: 'relative' }}>
        <ExtraBtn title={`Opacity: ${Math.round(opacity * 100)}%`} onClick={() => setOpacityOpen(o => !o)} tint="amber"><OpacityIcon /></ExtraBtn>
        {opacityOpen && (
          <div
            onMouseLeave={() => setOpacityOpen(false)}
            style={{
              position: 'absolute', right: 0, top: '110%', zIndex: 10,
              padding: '8px 10px', background: 'var(--bg2, #0b1824)',
              border: '1px solid var(--rim1, #2A5A7A)', borderRadius: 5,
              boxShadow: '0 6px 16px rgba(0,0,0,.5)', minWidth: 160,
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              marginBottom: 6, fontSize: 10, color: 'var(--fg2)',
              letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600,
            }}>
              <span>Opacity</span>
              <span style={{ color: 'var(--cyan)', fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(opacity * 100)}%
              </span>
            </div>
            <input
              type="range" min={30} max={100} step={5}
              value={Math.round(opacity * 100)}
              onChange={async e => {
                const v = Number(e.target.value) / 100;
                setOpacity(v);
                try { await electron?.setOpacity?.(v); } catch {}
              }}
              style={{ width: '100%', accentColor: 'var(--cyan, #00EEFF)' }}
            />
          </div>
        )}
      </div>
      <ExtraBtn
        title={pinned ? 'Unpin' : 'Pin on top'}
        onClick={async () => { if (!electron) return; const next = await electron.togglePin(); setPinned(next); }}
        active={pinned}
      >⌖</ExtraBtn>
    </div>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg1, #0a1918)',
      color: 'var(--fg1, #e3faf6)',
      fontFamily: 'var(--font)',
      overflow: 'hidden',
    }}>
      {/* Body background becomes a drag region so the whole radio-only
          window can be moved by grabbing any empty area — not just the
          30px title bar. Interactive elements inside RadioOverlay
          (buttons, inputs, selects, the frequency display) explicitly
          override back to no-drag below so they still take clicks. */}
      <style>{`
        .rw-drag { -webkit-app-region: drag; }
        .rw-drag button,
        .rw-drag input,
        .rw-drag select,
        .rw-drag textarea,
        .rw-drag a,
        .rw-drag [role="button"],
        .rw-drag [contenteditable="true"],
        .rw-drag .rm-ov-disp,
        .rw-drag .rm-ov-bar { -webkit-app-region: no-drag; }
      `}</style>
      <TitleBar
        title="NEXUS"
        subtitle="Radio"
        extras={extras}
        compact
        brandTrailing={<UpdatePill flow={updateFlow} onGreenChange={setUpdatePillGreen} />}
        hideVersion={updatePillGreen}
      />
      <div className="rw-drag" style={{ flex: 1, minHeight: 0 }}>
        <RadioTwinTiles />
      </div>
    </div>
  );
}

function ExtraBtn({ children, title, onClick, active = false, tint }) {
  // tint="amber" paints the icon in --amber for opacity controls — matches
  // the global-chat opacity button so every "adjust translucency" affordance
  // in the app shares the same color language.
  const tintColor = tint === 'amber'
    ? 'var(--amber)'
    : active ? 'var(--cyan)' : 'var(--fg1)';
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 24, height: 22, padding: 0,
        border: '1px solid transparent',
        background: active ? 'color-mix(in srgb, var(--cyan) 22%, transparent)' : 'transparent',
        color: tintColor,
        borderRadius: 4, cursor: 'pointer',
        fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        WebkitAppRegion: 'no-drag',
      }}
    >{children}</button>
  );
}
