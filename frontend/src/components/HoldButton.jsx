// Press-and-hold confirmation primitive. Two exports:
//
//   useHold({ holdMs, onComplete, hintText, disabled })
//     Returns { bindProps, progress, holding, showHint } for use on any
//     existing button-like element — lets small icon buttons (Banner
//     power button, radio power toggles) keep their own visuals while
//     still showing a filling ring/bar. bindProps covers mouse, touch
//     and keyboard (Enter/Space).
//
//   HoldButton
//     Default-styled text button with a bar that fills behind the label.
//     Use for primary Disconnect surfaces where a full-width red button
//     is wanted (dashboard, radio-only gear).
//
// Progress is always visible even with prefers-reduced-motion — it's
// information, not decoration.

import { useEffect, useRef, useState } from 'react';

const DEFAULT_HOLD_MS = 6000;

export function useHold({
  holdMs = DEFAULT_HOLD_MS,
  onComplete,
  hintText,
  disabled = false,
} = {}) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding]   = useState(false);
  const [showHint, setShowHint] = useState(false);
  const rafRef        = useRef(null);
  const startRef      = useRef(0);
  const completedRef  = useRef(false);
  const hintTimerRef  = useRef(null);
  const resetTimerRef = useRef(null);

  const clearRaf = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  };

  const tick = () => {
    const p = Math.min(1, (performance.now() - startRef.current) / holdMs);
    setProgress(p);
    if (p >= 1) {
      completedRef.current = true;
      clearRaf();
      setHolding(false);
      try { onComplete?.(); } catch {}
      resetTimerRef.current = setTimeout(() => setProgress(0), 500);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const start = () => {
    if (disabled) return;
    if (rafRef.current || completedRef.current) return;
    setShowHint(false);
    clearTimeout(hintTimerRef.current);
    clearTimeout(resetTimerRef.current);
    startRef.current = performance.now();
    setHolding(true);
    rafRef.current = requestAnimationFrame(tick);
  };

  const release = () => {
    if (completedRef.current) {
      completedRef.current = false;
      return;
    }
    if (!rafRef.current && !holding) return;
    clearRaf();
    setHolding(false);
    setProgress(0);
    if (hintText) {
      setShowHint(true);
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => setShowHint(false), 1800);
    }
  };

  useEffect(() => () => {
    clearRaf();
    clearTimeout(hintTimerRef.current);
    clearTimeout(resetTimerRef.current);
  }, []);

  const bindProps = {
    onMouseDown:   start,
    onMouseUp:     release,
    onMouseLeave:  release,
    onTouchStart:  (e) => { e.preventDefault(); start(); },
    onTouchEnd:    release,
    onTouchCancel: release,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!holding) start(); }
    },
    onKeyUp: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); release(); }
    },
    onBlur: release,
  };

  return { bindProps, progress, holding, showHint };
}

export default function HoldButton({
  holdMs = DEFAULT_HOLD_MS,
  onComplete,
  hintText,
  variant = 'default',
  disabled = false,
  children,
  className,
  style,
  ariaLabel,
  title,
}) {
  const { bindProps, progress, holding, showHint } = useHold({
    holdMs, onComplete, hintText, disabled,
  });

  const danger      = variant === 'danger';
  const borderColor = danger ? 'rgba(255, 85, 68, .55)' : 'var(--rim1, #2A5A7A)';
  const fillColor   = danger
    ? 'color-mix(in srgb, var(--red, #FF5544) 32%, transparent)'
    : 'color-mix(in srgb, var(--acc, #66AADD) 28%, transparent)';
  const textColor   = danger ? 'var(--red, #FF5544)' : 'var(--fg0)';

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      {...bindProps}
      className={className}
      style={{
        position: 'relative',
        overflow: 'hidden',
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: `1px solid ${borderColor}`,
        background: 'var(--bg2, #0A1828)',
        color: textColor,
        padding: '8px 14px',
        borderRadius: 4,
        font: '700 11px Inter, system-ui, sans-serif',
        letterSpacing: '0.1em',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${progress * 100}%`,
          background: fillColor,
          transition: holding ? 'none' : 'width .25s ease',
          pointerEvents: 'none',
        }}
      />
      <span style={{ position: 'relative', zIndex: 1 }}>{children}</span>
      {showHint && hintText && (
        <span
          role="status"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: -20,
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            fontSize: 10,
            color: danger ? 'var(--red, #FF5544)' : 'var(--fg2)',
            letterSpacing: '0.1em',
            pointerEvents: 'none',
          }}
        >{hintText}</span>
      )}
    </button>
  );
}

// Radial progress ring overlay for icon-sized hold buttons. Centers on
// the parent via translate(-50%,-50%) so it works regardless of parent
// layout (grid, flex, inline-block, etc.) and regardless of whether
// the parent has a border or padding. Pick a size that leaves visible
// clearance around the icon — the circle should circumscribe the
// icon, not sit on top of it. Icon ≈14 px → size ≥ 30; icon ≈16 px →
// size ≥ 34.
export function HoldRing({ progress, variant = 'danger', size = 32, strokeWidth = 2 }) {
  const stroke = variant === 'danger' ? 'var(--red, #FF5544)' : 'var(--acc, #66AADD)';
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * progress;
  return (
    <svg
      aria-hidden="true"
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{
        position: 'absolute',
        top: '50%', left: '50%',
        width: size, height: size,
        transform: 'translate(-50%, -50%) rotate(-90deg)',
        pointerEvents: 'none',
      }}
    >
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={stroke} strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        style={{ transition: 'stroke-dasharray 60ms linear' }}
      />
    </svg>
  );
}
