// TitleBar — the single stylized frameless title bar used across every
// Electron window mode (full / companion / radio-only).
//
// Hard rules learned from v0.6.0's failed hover-reveal chrome:
//   • Only the empty "spacer" region of the bar is a drag region.
//   • Every button, link, and interactive child is marked no-drag.
//   • The bar occupies its own layout slot; it never floats over app
//     content, so no padding offset is needed to keep buttons clickable.
//   • Height is a fixed 30px — matches the standard Windows title bar
//     height so the layout feels native even though it's custom.
//
// Props:
//   title    — the brand text (defaults to NEXUS)
//   subtitle — optional small subtitle (e.g. mode name)
//   extras   — optional React node rendered in the middle (e.g. mode switcher)
//   onlyClose — if true, hides min/max (used by the very small radio mode)

import { useEffect, useState } from 'react';
import NexusMark from './NexusMark';

const DRAG   = { WebkitAppRegion: 'drag' };
const NODRAG = { WebkitAppRegion: 'no-drag' };

export default function TitleBar({
  title = 'NEXUS',
  subtitle,
  extras,
  onlyClose = false,
  // Narrow windows (Companion, Radio-only) can't afford 44px window
  // controls — they eat 132px of a 324px row. `compact` drops them to
  // 32px so the brand + version pill stay visible.
  compact = false,
}) {
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;
  const [maximized, setMaximized] = useState(false);
  const version = electron?.companion?.version;
  // UDP-only sibling build marker — surfaces either via the bake-time env
  // flag (pure-UDP bundle), the preload-exposed boolean (UDP Electron
  // shell), or the ?udp=1 query param appended by main.js urlFor().
  const udpOnly = (() => {
    try {
      if (import.meta.env.VITE_NEXUS_UDP_ONLY === '1') return true;
      if (electron?.companion?.udpOnly) return true;
      if (typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('udp') === '1') return true;
    } catch {}
    return false;
  })();

  // We don't get a dedicated "maximize-changed" event through our IPC —
  // just toggle optimistically on click. Not critical visually.
  const onMinimize  = () => electron?.minimize?.();
  const onMaxToggle = () => { setMaximized(m => !m); electron?.maxToggle?.(); };
  const onClose     = () => electron?.close?.();

  // Hide the bar entirely in a regular browser tab — only renders inside Electron.
  if (!electron) return null;

  return (
    <div
      style={{
        ...DRAG,
        flexShrink: 0,
        height: 30,
        display: 'flex',
        alignItems: 'center',
        padding: '0 0 0 10px',
        background: 'linear-gradient(180deg, var(--bg2) 0%, var(--bg1) 100%)',
        borderBottom: '1px solid var(--rim0)',
        boxShadow: 'inset 0 1px 0 var(--hl)',
        color: 'var(--fg1, #99BBDD)',
        fontFamily: 'var(--font)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Brand mark — part of the drag region. New prompt mark + wordmark
          per logo_e_spec. 16 px small-cut matches the 30 px bar height. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <NexusMark size={16} />
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.22em',
          color: 'var(--fg1)',
        }}>
          {title}
        </span>
        {subtitle && (
          <span style={{
            fontSize: 10,
            letterSpacing: '0.14em',
            color: 'var(--fg3)',
            textTransform: 'uppercase',
          }}>
            {subtitle}
          </span>
        )}
        {version && (
          <span
            title={`Nexus Companion v${version} — compare with your friend's number when debugging`}
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: 'var(--cyan, #7ef0dc)',
              fontVariantNumeric: 'tabular-nums',
              marginLeft: 4,
              padding: '1px 5px',
              border: '1px solid color-mix(in srgb, var(--cyan, #7ef0dc) 35%, transparent)',
              borderRadius: 3,
              background: 'color-mix(in srgb, var(--cyan, #7ef0dc) 10%, transparent)',
            }}
          >
            v{version}
          </span>
        )}
        {udpOnly && (
          <span
            title="UDP-only sibling build — voice transport is locked to UDP"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: 'var(--cyan, #7ef0dc)',
              marginLeft: 2,
              padding: '1px 5px',
              border: '1px solid color-mix(in srgb, var(--cyan, #7ef0dc) 55%, transparent)',
              borderRadius: 3,
              background: 'color-mix(in srgb, var(--cyan, #7ef0dc) 18%, transparent)',
            }}
          >
            UDP
          </span>
        )}
      </div>

      {/* Middle slot (extras) — individual children decide their own
          drag state via inline style. The wrapper itself stays no-drag
          so wide empty space in extras doesn't become draggable. */}
      {extras && (
        <div style={{ ...NODRAG, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 14 }}>
          {extras}
        </div>
      )}

      {/* Flex spacer — the only part of the bar whose empty area is
          draggable other than the brand label. */}
      <div style={{ flex: 1 }} />

      {/* Window controls — explicitly no-drag so clicks land. */}
      <div style={{ ...NODRAG, display: 'flex', height: '100%' }}>
        {!onlyClose && (
          <>
            <WinBtn label="−"  title="Minimize" compact={compact} onClick={onMinimize} />
            <WinBtn label={maximized ? '❐' : '▢'} title="Maximize / restore" compact={compact} onClick={onMaxToggle} />
          </>
        )}
        <WinBtn label="✕" title="Close" compact={compact} onClick={onClose} danger />
      </div>
    </div>
  );
}

function WinBtn({ label, title, onClick, danger, compact }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      aria-label={title}
      style={{
        ...NODRAG,
        width: compact ? 32 : 44,
        height: '100%',
        padding: 0,
        border: 0,
        background: hover
          ? (danger ? 'color-mix(in srgb, var(--red) 75%, transparent)' : 'color-mix(in srgb, var(--blue) 18%, transparent)')
          : 'transparent',
        color: hover && danger ? '#fff' : (danger ? 'color-mix(in srgb, var(--red) 55%, #fff)' : 'var(--fg1)'),
        fontSize: label === '✕' ? 13 : 14,
        fontWeight: 500,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background .12s, color .12s',
        fontFamily: 'var(--font)',
      }}
    >
      {label}
    </button>
  );
}
