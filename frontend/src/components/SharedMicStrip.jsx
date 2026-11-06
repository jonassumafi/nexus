// Shared mic strip — a single row with live level meter and volume
// slider. Feeds both Crew and Command radios (one mic, two tuners).
// Replaces the per-tuner MIC TRACK / MIC VOLUME blocks that used to
// live inside each radio card.

import { useEffect, useState } from 'react';

export default function SharedMicStrip({
  getLevel,
  sensitivity = 100,
  setSensitivity,
  rxVolume = 100,       // 0..150, percent of baked playback level
  setRxVolume,
  isActive = true,
}) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const v = getLevel ? getLevel() : 0;
      setLevel(Number.isFinite(v) ? v : 0);
    }, 50);
    return () => clearInterval(id);
  }, [getLevel]);

  const fillColor = level > 70 ? '#FF4455' : level > 30 ? '#44FF88' : '#2A5A7A';

  return (
    <div style={{
      border: '1px solid var(--rim0)',
      borderRadius: 8,
      background: 'var(--bg2)',
      padding: '7px 9px',
      display: 'flex', flexDirection: 'column', gap: 6,
      boxShadow: '0 1px 0 var(--hl) inset',
    }}>
      {/* Row 1 — "Mic" header + active chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 9, height: 9, borderRadius: '50%',
          background: isActive ? 'var(--lime)' : 'var(--rim1)',
          boxShadow: isActive
            ? '0 0 8px color-mix(in srgb, var(--lime) 65%, transparent)'
            : 'none',
          flex: 'none',
        }} />
        <span style={{
          fontSize: 10, fontWeight: 700,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'var(--fg2)',
        }}>Mic</span>
        <span style={{
          color: isActive ? 'var(--lime)' : 'var(--fg3)',
          fontWeight: 600, fontSize: 11,
        }}>{isActive ? 'Active' : 'Idle'}</span>
      </div>

      {/* Row 2 — track meter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 600,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--fg2)', width: 62, flex: 'none',
        }}>Track</span>
        <div style={{
          flex: 1, height: 8, borderRadius: 4,
          background: 'var(--bg0)', border: '1px solid var(--edge, var(--rim0))',
          overflow: 'hidden', minWidth: 40,
        }}>
          <div style={{
            height: '100%', width: `${level}%`, background: fillColor,
            transition: 'width 0.05s',
          }} />
        </div>
        <span style={{
          width: 34, textAlign: 'right', color: 'var(--fg0)',
          fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 'none',
          fontSize: 11,
        }}>{Math.round(level)}%</span>
      </div>

      {/* Row 3 — volume slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 600,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--fg2)', width: 62, flex: 'none',
        }}>Outgoing</span>
        <input
          type="range"
          min={0} max={150} step={5}
          value={sensitivity}
          onChange={e => setSensitivity?.(Number(e.target.value))}
          style={{
            flex: 1, minWidth: 40,
            accentColor: 'var(--cyan, #7ef0dc)',
            cursor: 'pointer',
          }}
          aria-label="Outgoing volume"
        />
        <span style={{
          width: 34, textAlign: 'right', color: 'var(--fg0)',
          fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 'none',
          fontSize: 11,
        }}>{sensitivity}%</span>
      </div>

      {/* Row 4 — receive volume (incoming peer voice loudness) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 600,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--fg2)', width: 62, flex: 'none',
        }}>Incoming</span>
        <input
          type="range"
          min={0} max={150} step={5}
          value={rxVolume}
          onChange={e => setRxVolume?.(Number(e.target.value))}
          style={{
            flex: 1, minWidth: 40,
            accentColor: 'var(--cyan, #7ef0dc)',
            cursor: 'pointer',
          }}
          aria-label="Incoming volume"
          title="Loudness of other operators' voices (incoming only)"
        />
        <span style={{
          width: 34, textAlign: 'right', color: 'var(--fg0)',
          fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 'none',
          fontSize: 11,
        }}>{rxVolume}%</span>
      </div>

    </div>
  );
}
