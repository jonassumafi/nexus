// FreqTuneInput — tunable LCD-styled frequency field with an inset
// "TUNE" button on the right edge. Enter / blur still apply, but the
// button gives an explicit click target so the user doesn't have to
// click outside the box to finalize.
//
// Shared by every view that renders a full-size radio tile (Crew and
// Command on the Full dashboard). The Radio-only strip uses its own
// chip renderer in RadioTwinTiles.jsx.
//
// Visual overlay: TuneDotWave sits inside the glass behind the digits
// and plays a soft swell when the user commits a new different
// frequency. The digits themselves are never transformed, colored or
// faded by this feature.
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
import TuneDotWave from './TuneDotWave';

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

  // Tune-confirmation swell trigger. Only fires on value changes that
  // follow a real user interaction with this input — guards against
  // the initial value prop load (app start, reconnect, window show).
  const [waveTrigger, setWaveTrigger] = useState(0);
  const interactedRef = useRef(false);
  const prevValRef    = useRef(value);
  const firstRunRef   = useRef(true);
  const markInteracted = () => { interactedRef.current = true; };

  useEffect(() => {
    const prev = prevValRef.current;
    prevValRef.current = value;
    if (firstRunRef.current) { firstRunRef.current = false; return; }
    if (!interactedRef.current) return;   // not yet touched by this user
    if (!value) return;                   // skip transitions into empty
    if (prev === value) return;           // only on real differences
    setWaveTrigger(t => t + 1);
  }, [value]);

  return (
    <div
      style={{
        // position:relative so TuneDotWave's inset:0 lands here.
        // overflow:hidden clips both the SVG corners and any digits
        // to the rounded glass edge.
        position: 'relative',
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        overflow: 'hidden',
        borderRadius: 4,
        // The glass look (background + inset shadow) now lives on the
        // wrapper so the overlay can sit inside behind the digits.
        background: 'var(--lcd-glass)',
        boxShadow: '0 2px 6px #000 inset',
      }}
    >
      <TuneDotWave trigger={waveTrigger} />
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        className={`lcd${transmitting ? ' tx' : ''}`}
        value={value}
        onFocus={markInteracted}
        onChange={e => {
          markInteracted();
          if (playTune) playTune();
          onChange?.(e.target.value);
        }}
        onKeyDown={e => {
          markInteracted();
          if (e.key === 'Enter')  { e.currentTarget.blur(); }
          if (e.key === 'Escape') { onCancel?.(); e.currentTarget.blur(); }
        }}
        onBlur={() => onCommit?.()}
        placeholder="---.-"
        title="Type a frequency and press TUNE (or Enter)"
        style={{
          // Digits layer sits above the dot overlay.
          position: 'relative',
          zIndex: 1,
          width: '100%',
          fontSize: lcdFontSize,
          padding: `3px 60px 3px 10px`, // right pad reserves space for TUNE button
          textAlign: 'center',
          cursor: 'text',
          userSelect: 'auto',
          WebkitUserSelect: 'auto',
          WebkitAppRegion: 'no-drag',
          // Glass styling moved to the wrapper; input is transparent
          // over the overlay.
          background: 'transparent',
          border: 0,
          boxShadow: 'none',
          outline: 'none',
        }}
      />

      <button
        type="button"
        // onMouseDown instead of onClick so this fires BEFORE the input's
        // onBlur, otherwise the blur-triggered commit races the click and
        // can swallow the button press.
        onMouseDown={e => {
          e.preventDefault();                 // keep focus on the input
          markInteracted();
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
  );
}
