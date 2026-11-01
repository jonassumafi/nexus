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

const DRAG   = { WebkitAppRegion: 'drag' };
const NODRAG = { WebkitAppRegion: 'no-drag' };

export default function TitleBar({
  title = 'NEXUS',
  subtitle,
  extras,
  onlyClose = false,
}) {
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;
  const [maximized, setMaximized] = useState(false);

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
      {/* Brand mark — part of the drag region */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.22em',
          color: 'var(--blue)',
          textShadow: '0 0 8px color-mix(in srgb, var(--blue) 45%, transparent)',
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
            <WinBtn label="−"  title="Minimize"             onClick={onMinimize} />
            <WinBtn label={maximized ? '❐' : '▢'} title="Maximize / restore" onClick={onMaxToggle} />
          </>
        )}
        <WinBtn label="✕" title="Close" onClick={onClose} danger />
      </div>
    </div>
  );
}

function WinBtn({ label, title, onClick, danger }) {
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
        width: 44,
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
