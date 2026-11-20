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
// and plays a soft swell exactly once when the user commits a new,
// different frequency via Enter, TUNE, or blur. The swell does NOT
// fire on keystrokes, on the initial value load, on reconnect, or on
// window show. The digits themselves are never transformed, colored
// or faded by this feature.
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

  // Tune-confirmation swell. Fires inside fireCommit() — only when
  // the user explicitly presses Enter, TUNE, or blurs the field and
  // the typed value differs from what was last committed.
  const [waveTrigger, setWaveTrigger] = useState(0);
  const lastCommittedRef = useRef(value);
  // Flag set on every keystroke onChange. The useEffect below uses it
  // to tell "user typed, value prop changed because of my onChange"
  // from "parent updated value programmatically (reconnect, engine
  // sync, external navigate)." The former must NOT reset our
  // last-committed baseline; the latter must.
  const typingRef = useRef(false);

  useEffect(() => {
    if (!typingRef.current) {
      // Programmatic update — e.g. engine pushed a new tuned freq, the
      // app just restored a saved frequency, or the parent reset the
      // field. Treat as the new baseline for future commit comparisons.
      lastCommittedRef.current = value;
    }
    typingRef.current = false;
  }, [value]);

  const fireCommit = () => {
    // Read live from the input ref — value prop may not have landed
    // yet if the parent batches updates.
    const typed = inputRef.current ? inputRef.current.value : value;
    if (typed && typed !== lastCommittedRef.current) {
      lastCommittedRef.current = typed;
      setWaveTrigger(t => t + 1);
    }
    onCommit?.();
  };

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
      {/* Scoped placeholder scaling — stock placeholders inherit the
          full LCD font size (18–22 px), which overflows into the TUNE
          button once you add explanatory text. Scale it to 55 % of the
          input font so the "50–350" hint fits cleanly on every tile
          size. */}
      <style>{`.fti-lcd::placeholder { font-size: 0.72em; letter-spacing: 0.06em; opacity: 0.6; }`}</style>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        className={`lcd fti-lcd${transmitting ? ' tx' : ''}`}
        value={value}
        onChange={e => {
          typingRef.current = true;
          if (playTune) playTune();
          onChange?.(e.target.value);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter')  { e.currentTarget.blur(); }
          if (e.key === 'Escape') { onCancel?.(); e.currentTarget.blur(); }
        }}
        onBlur={fireCommit}
        placeholder="50 – 350"
        title="Type a frequency between 50.0 and 350.0, then press TUNE or Enter"
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
          fireCommit();
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
