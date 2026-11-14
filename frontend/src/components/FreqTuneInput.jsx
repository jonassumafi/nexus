// FreqTuneInput — tunable LCD-styled frequency field with an inset
// "TUNE" button on the right edge. Enter / blur still apply, but the
// button gives an explicit click target so the user doesn't have to
// click outside the box to finalize.
//
// v0.9.28 — Signal Lock tune animation. When the `value` prop changes
// (parent commits a new tuned frequency to the radio engine), the
// digits scramble for ~1 s and resolve left-to-right into the new
// value. A thin bar sweeps underneath, turning lime at the end and
// fading. The animation is purely cosmetic — the radio engine already
// has the new freq; nothing waits on this.
//
// Shared by every view that renders a radio tile (currently Full and
// Radio-only; Companion was removed in v0.9.27).
//
// Props:
//   value          current frequency string (empty allowed while editing)
//   onChange       (newText) — called on each keystroke
//   onCommit       () — called when the user hits Enter, blurs, or clicks TUNE
//   onCancel       () — optional, called when the user hits Escape
//   transmitting   boolean, red-tints the LCD while PTT is active
//   lcdFontSize    override — compact modes want a smaller readout
//   playTune       optional tune-click sound hook

import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
};

export default function FreqTuneInput({
  value,
  onChange,
  onCommit,
  onCancel,
  transmitting = false,
  lcdFontSize = 16,
  playTune,
}) {
  const inputRef = useRef(null);

  // ─── Signal Lock animation state ─────────────────────────────────────
  // Triggered whenever the parent's `value` prop changes to a new
  // non-empty string AFTER mount. On trigger, the input is hidden and
  // an overlay renders the scrambled → resolved digits. After ~1 s the
  // overlay is torn down and the input takes over again showing the
  // (unchanged) committed value.
  const [animTo, setAnimTo]       = useState(null);   // final freq string during anim
  const [display, setDisplay]     = useState('');     // what the overlay shows this frame
  const [lockPhase, setLockPhase] = useState('idle'); // 'idle' | 'sweep' | 'lock' | 'done'
  const rafRef      = useRef(null);
  const timersRef   = useRef([]);
  const prevValRef  = useRef(value);
  const firstRunRef = useRef(true);

  const cancelAnim = () => {
    if (rafRef.current) { try { cancelAnimationFrame(rafRef.current); } catch {} rafRef.current = null; }
    timersRef.current.forEach(t => { try { clearTimeout(t); } catch {} });
    timersRef.current = [];
  };

  useEffect(() => {
    const prev = prevValRef.current;
    prevValRef.current = value;
    // Skip the mount-time call (no animation on initial render).
    if (firstRunRef.current) { firstRunRef.current = false; return; }
    if (!value) { cancelAnim(); setAnimTo(null); setLockPhase('idle'); return; }
    if (prev === value) return;
    if (prefersReducedMotion()) return;

    // Kick off the scramble-to-lock run.
    cancelAnim();
    const target = String(value);
    setAnimTo(target);
    setLockPhase('sweep');

    const t0 = performance.now();
    const DURATION = 1000;
    const step = (now) => {
      const e = now - t0;
      let out = '';
      for (let i = 0; i < target.length; i++) {
        const c = target[i];
        if (c === '.') { out += '.'; continue; }
        if (e > 250 + i * 120) out += c;
        else out += Math.floor(Math.random() * 10).toString();
      }
      setDisplay(out);
      if (e < DURATION) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
        setLockPhase('lock');
        timersRef.current.push(setTimeout(() => {
          setLockPhase('done');
          setAnimTo(null);
        }, 180));
      }
    };
    rafRef.current = requestAnimationFrame(step);

    return cancelAnim;
  }, [value]);

  // Teardown on unmount.
  useEffect(() => () => cancelAnim(), []);

  const animating = animTo != null;

  return (
    <>
      <style>{SIGNAL_LOCK_CSS}</style>
      <div style={{
        position: 'relative',
        flex: 1,
        display: 'flex',
        alignItems: 'center',
      }}>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          className={`lcd${transmitting ? ' tx' : ''}`}
          value={value}
          onChange={e => { if (playTune) playTune(); onChange?.(e.target.value); }}
          onKeyDown={e => {
            if (e.key === 'Enter')  { e.currentTarget.blur(); }
            if (e.key === 'Escape') { onCancel?.(); e.currentTarget.blur(); }
          }}
          onBlur={() => onCommit?.()}
          placeholder="---.-"
          title="Type a frequency and press TUNE (or Enter)"
          style={{
            width: '100%',
            fontSize: lcdFontSize,
            padding: `3px 60px 3px 10px`, // right pad reserves space for TUNE button
            textAlign: 'center',
            cursor: 'text',
            userSelect: 'auto',
            WebkitUserSelect: 'auto',
            WebkitAppRegion: 'no-drag',
            visibility: animating ? 'hidden' : 'visible',
          }}
        />

        {/* Signal Lock overlay — scramble/resolve digits + sweep bar */}
        {animating && (
          <div
            className="fti-sigwrap"
            aria-hidden="true"
            style={{ fontSize: lcdFontSize }}
          >
            <div className="fti-digits">
              {display.split('').map((c, i) => (
                <span
                  key={i}
                  className={
                    c === '.' ? 'fti-dot'
                      : (animTo && animTo[i] === c
                          ? 'fti-digit fti-lit'
                          : 'fti-digit fti-scr')
                  }
                >{c}</span>
              ))}
            </div>
            <div className={`fti-lockbar fti-lockbar--${lockPhase}`} />
          </div>
        )}

        <button
          type="button"
          // onMouseDown instead of onClick so this fires BEFORE the input's
          // onBlur, otherwise the blur-triggered commit races the click and
          // can swallow the button press.
          onMouseDown={e => {
            e.preventDefault();                 // keep focus on the input
            onCommit?.();
            inputRef.current?.blur();
          }}
          title="Finalize tuning"
          style={{
            position: 'absolute',
            right: 4,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 'calc(100% - 8px)',
            padding: '0 10px',
            borderRadius: 3,
            border: '1px solid rgba(102,170,221,.35)',
            background: 'linear-gradient(180deg, rgba(14,42,68,.9), rgba(10,26,43,.9))',
            color: 'var(--cyan)',
            fontSize: Math.max(9, Math.round(lcdFontSize * 0.58)),
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: 'pointer',
            WebkitAppRegion: 'no-drag',
            textShadow: '0 0 6px color-mix(in srgb, var(--cyan) 55%, transparent)',
            zIndex: 2,
          }}
        >
          TUNE
        </button>
      </div>
    </>
  );
}

const SIGNAL_LOCK_CSS = `
.fti-sigwrap {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 3px 60px 3px 10px;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  color: var(--acc2, var(--cyan, #00EEFF));
  z-index: 1;
}
.fti-digits { display: inline-flex; align-items: baseline; gap: 0; }
.fti-digit, .fti-dot {
  display: inline-block;
  text-align: center;
  font-weight: 700;
  line-height: 1.15em;
}
.fti-digit { width: 0.62em; }
.fti-dot   { width: 0.3em; }
.fti-lit { opacity: 1; }
.fti-scr { opacity: 0.45; }

.fti-lockbar {
  position: absolute; left: 10px; right: 60px; bottom: 2px;
  height: 2px; width: 0;
  background: var(--acc2, var(--cyan, #00EEFF));
  box-shadow: 0 0 6px var(--acc2, var(--cyan, #00EEFF));
  opacity: 0;
}
.fti-lockbar--sweep {
  animation: fti-sweep 1s cubic-bezier(.4, 0, .2, 1) forwards;
}
.fti-lockbar--lock {
  width: calc(100% - 70px);
  background: var(--lime, #44FF88);
  box-shadow: 0 0 8px var(--lime, #44FF88);
  opacity: 1;
  animation: fti-lockfade 220ms ease-out forwards;
}
@keyframes fti-sweep {
  0%   { width: 0;                     opacity: 1; background: var(--acc2, var(--cyan, #00EEFF)); }
  70%  { width: calc(100% - 70px);     opacity: 1; background: var(--acc2, var(--cyan, #00EEFF)); }
  85%  { width: calc(100% - 70px);     opacity: 1; background: var(--lime, #44FF88); box-shadow: 0 0 8px var(--lime, #44FF88); }
  100% { width: calc(100% - 70px);     opacity: 1; background: var(--lime, #44FF88); }
}
@keyframes fti-lockfade {
  from { opacity: 1; }
  to   { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .fti-sigwrap, .fti-lockbar { display: none !important; animation: none !important; }
}
`;
