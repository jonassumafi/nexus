// FreqTuneInput — tunable LCD-styled frequency field with an inset
// "TUNE" button on the right edge. Enter / blur still apply, but the
// button gives an explicit click target so the user doesn't have to
// click outside the box to finalize.
//
// Shared by Companion, RadioWidget, and the main Dashboard radio
// panel so all three views behave identically.
//
// Props:
//   value          current frequency string (empty allowed while editing)
//   onChange       (newText) — called on each keystroke
//   onCommit       () — called when the user hits Enter, blurs, or clicks TUNE
//   onCancel       () — optional, called when the user hits Escape
//   transmitting   boolean, red-tints the LCD while PTT is active
//   lcdFontSize    override — compact modes want a smaller readout
//   playTune       optional tune-click sound hook

import { useRef } from 'react';

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

  return (
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
        }}
      />
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
        }}
      >
        TUNE
      </button>
    </div>
  );
}
