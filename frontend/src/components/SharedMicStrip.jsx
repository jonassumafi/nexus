// Shared mic strip — a single row with live level meter and volume
// slider. Feeds both Crew and Command radios (one mic, two tuners).
// Replaces the per-tuner MIC TRACK / MIC VOLUME blocks that used to
// live inside each radio card.

import { useEffect, useState } from 'react';
import OpacityIcon from './OpacityIcon';

export default function SharedMicStrip({
  getLevel,
  sensitivity = 100,
  setSensitivity,
  rxVolume = 100,       // 0..150, percent of baked playback level
  setRxVolume,
  isActive = true,
  // Compact mode: single-row strip with gear-to-expand sliders. Used
  // by the Companion and Radio-only windows where vertical space is
  // tight. The full dashboard still uses the stacked layout.
  compact = false,
  peersCount = null,    // number → shows a 👥 N chip; null → hidden
  isMuted = false,
  onToggleMute,
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

  // Local open-state for the compact mode's gear-expanded sliders.
  const [open, setOpen] = useState(false);

  if (compact) {
    return (
      <div style={{
        border: '1px solid var(--rim0)', borderRadius: 6,
        background: 'var(--bg2)', padding: '5px 7px',
        display: 'flex', flexDirection: 'column', gap: 5,
        boxShadow: '0 1px 0 var(--hl) inset',
      }}>
        {/* Row 1 — LED + mic label + inline meter + peers + mute + gear */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: isMuted ? 'var(--red)' : (isActive ? 'var(--lime)' : 'var(--rim1)'),
            boxShadow: !isMuted && isActive ? '0 0 6px var(--lime)' : (isMuted ? '0 0 6px var(--red)' : 'none'),
            flex: 'none',
          }} />
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--fg2)', flex: 'none',
          }}>Mic</span>
          <span style={{
            fontSize: 10, fontWeight: 600, color: isMuted ? 'var(--red)' : (isActive ? 'var(--lime)' : 'var(--fg3)'),
            flex: 'none', letterSpacing: '0.02em',
          }}>{isMuted ? 'Muted' : (isActive ? 'Active' : 'Idle')}</span>
          <div style={{
            flex: 1, height: 5, borderRadius: 3,
            background: 'var(--bg0)', border: '1px solid var(--edge, var(--rim0))',
            overflow: 'hidden', minWidth: 30,
          }}>
            <div style={{ height: '100%', width: `${isMuted ? 0 : level}%`, background: fillColor, transition: 'width .05s' }} />
          </div>
          {Number.isFinite(peersCount) && (
            <span
              title={`${peersCount} on frequency`}
              aria-label={`${peersCount} operators on frequency`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '1px 6px', borderRadius: 3, flex: 'none',
                border: '1px solid var(--rim1)', background: 'var(--bg0)',
                font: '700 10px Inter', color: peersCount > 0 ? 'var(--lime)' : 'var(--fg3)',
                letterSpacing: '0.04em',
              }}
            >
              <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="6" cy="6.5" r="2.4" />
                <circle cx="11" cy="7.2" r="1.8" />
                <path d="M1.8 13.4c.4-2.2 2-3.4 4.2-3.4s3.8 1.2 4.2 3.4" />
                <path d="M10.5 13.4c.3-1.6 1.4-2.7 2.9-2.8" />
              </svg>
              {peersCount}
            </span>
          )}
          {onToggleMute && (
            <button
              onClick={onToggleMute}
              aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              style={{
                width: 22, height: 22, flex: 'none', borderRadius: 3,
                border: '1px solid var(--rim1)',
                background: isMuted
                  ? 'linear-gradient(180deg, #a8321f, #5e150b)'
                  : 'linear-gradient(180deg, var(--bg3), var(--bg2))',
                color: isMuted ? '#fff' : 'var(--fg2)',
                cursor: 'pointer', display: 'grid', placeItems: 'center',
                padding: 0,
              }}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="6" y="2" width="4" height="7" rx="2" />
                <path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5v2" />
                {isMuted && <path d="M2 2l12 12" />}
              </svg>
            </button>
          )}
          <button
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-label="Mic settings"
            title="Mic volumes"
            style={{
              width: 22, height: 22, flex: 'none', borderRadius: 3,
              border: `1px solid ${open ? 'var(--amber)' : 'var(--rim1)'}`,
              background: 'linear-gradient(180deg, var(--bg3), var(--bg2))',
              color: 'var(--amber)', cursor: 'pointer',
              display: 'grid', placeItems: 'center', padding: 0,
            }}
          >
            <OpacityIcon size={12} />
          </button>
        </div>

        {/* Row 2 (collapsed by default) — sliders */}
        {open && (
          <div style={{
            display: 'grid', gap: 4, padding: '6px 7px',
            background: 'color-mix(in srgb, var(--bg0) 60%, #000)',
            border: '1px solid var(--rim0)', borderRadius: 4,
          }}>
            <label style={{ display: 'grid', gridTemplateColumns: '58px 1fr 38px', gap: 6, alignItems: 'center',
              font: '600 10px Inter', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg2)' }}>
              Outgoing
              <input type="range" min={0} max={150} step={5} value={sensitivity}
                onChange={e => setSensitivity?.(Number(e.target.value))}
                style={{ accentColor: 'var(--cyan)', width: '100%' }}
                aria-label="Outgoing volume" />
              <b style={{ textAlign: 'right', color: 'var(--fg0)', fontVariantNumeric: 'tabular-nums' }}>{sensitivity}%</b>
            </label>
            {setRxVolume && Number.isFinite(rxVolume) && (
              <label style={{ display: 'grid', gridTemplateColumns: '58px 1fr 38px', gap: 6, alignItems: 'center',
                font: '600 10px Inter', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg2)' }}>
                Incoming
                <input type="range" min={0} max={150} step={5} value={rxVolume}
                  onChange={e => setRxVolume?.(Number(e.target.value))}
                  style={{ accentColor: 'var(--cyan)', width: '100%' }}
                  aria-label="Incoming volume" />
                <b style={{ textAlign: 'right', color: 'var(--fg0)', fontVariantNumeric: 'tabular-nums' }}>{rxVolume}%</b>
              </label>
            )}
          </div>
        )}
      </div>
    );
  }

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
