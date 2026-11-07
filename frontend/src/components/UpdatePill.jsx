// Small title-bar pill used only in the Radio-only view, because a
// centered card would hide the radio while the player is in-game. The
// pill walks through the same five states as the card.
//
// Props:
//   flow            — returned by useUpdateFlow
//   onGreenChange   — optional callback(boolean) called when the pill
//                     enters/leaves the "Install and restart" state.
//                     TitleBar uses this to hide the version number so
//                     everything fits in the 260 px window.

import { useEffect } from 'react';

const DL_ICON = (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path d="M6 2v6M3.5 6l2.5 2.5L8.5 6M2.5 10.5h7" />
  </svg>
);

const CHK_ICON = (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.5 6.3l2.4 2.4 4.6-5" />
  </svg>
);

export default function UpdatePill({ flow, onGreenChange }) {
  const { surface, state, pct } = flow;
  const active = surface === 'update' && ['available', 'downloading', 'ready', 'installing', 'failed'].includes(state);
  const isGreen = active && state === 'ready';

  useEffect(() => {
    onGreenChange?.(isGreen);
  }, [isGreen, onGreenChange]);

  if (!active) return null;

  return (
    <>
      <style>{CSS}</style>
      {state === 'available' && (
        <button
          className="nx-rp nx-rp--round"
          title="Update available. Click to download"
          onClick={flow.onDownload}
        >
          {DL_ICON}
        </button>
      )}
      {state === 'downloading' && (
        <span className="nx-rp nx-rp--fill" style={{ ['--p']: `${pct}%` }}>
          {DL_ICON}{pct}%
        </span>
      )}
      {state === 'ready' && (
        <button className="nx-rp nx-rp--f" onClick={flow.onInstall}>
          {CHK_ICON}Install and restart
        </button>
      )}
      {state === 'installing' && (
        <span className="nx-rp nx-rp--ind">Installing</span>
      )}
      {state === 'failed' && (
        <button className="nx-rp nx-rp--er" onClick={flow.onRetry}>
          Retry
        </button>
      )}
    </>
  );
}

const CSS = `
.nx-rp {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px;
  height: 22px; min-width: 22px;
  padding: 0 9px;
  border-radius: 11px;
  border: 1px solid var(--acc2, #00EEFF);
  color: var(--acc2, #00EEFF);
  font: 700 10px Inter, system-ui, sans-serif;
  letter-spacing: .05em; text-transform: uppercase;
  white-space: nowrap;
  flex: none;
  overflow: hidden;
  background: color-mix(in srgb, var(--acc2, #00EEFF) 10%, transparent);
  -webkit-app-region: no-drag;
  animation: nx-rp-in .25s cubic-bezier(.2,.8,.2,1);
  cursor: default;
}
button.nx-rp { cursor: pointer; }
button.nx-rp:hover { background: color-mix(in srgb, var(--acc2, #00EEFF) 24%, transparent); }
.nx-rp svg {
  width: 11px; height: 11px; flex: none;
  fill: none; stroke: currentColor; stroke-width: 2.2;
  stroke-linecap: round; stroke-linejoin: round;
}
.nx-rp--round { width: 22px; padding: 0; }
.nx-rp--fill {
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--acc2, #00EEFF) 42%, transparent) var(--p),
    color-mix(in srgb, var(--acc2, #00EEFF) 8%, transparent) var(--p));
}
.nx-rp--f {
  background: var(--lime, #44dd88);
  border-color: var(--lime, #44dd88);
  color: var(--bg0, #020C14);
}
button.nx-rp--f:hover { background: color-mix(in srgb, var(--lime, #44dd88) 85%, #fff); }
.nx-rp--er {
  border-color: var(--red, #ff5544);
  color: var(--red, #ff5544);
  background: color-mix(in srgb, var(--red, #ff5544) 10%, transparent);
}
.nx-rp--ind::after {
  content: ""; position: absolute; left: 0; bottom: 0;
  height: 2px; width: 30%;
  background: var(--acc2, #00EEFF);
  animation: nx-rp-sl 1.1s ease-in-out infinite;
}
@keyframes nx-rp-in { from { opacity: 0; transform: translateY(-4px); } }
@keyframes nx-rp-sl { 0% { margin-left: -30%; } 100% { margin-left: 100%; } }
@media (prefers-reduced-motion: reduce) { .nx-rp { animation: none; } .nx-rp--ind::after { animation: none; } }
`;
