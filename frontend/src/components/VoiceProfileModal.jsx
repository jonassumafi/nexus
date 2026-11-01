// Compact voice-profile editor. Opens as an overlay from the Companion
// chassis strip and the Radio-only mode row, giving the player access
// to the same voice-shaping controls that live inside the main
// dashboard's Radio Settings — without needing to leave compact mode.
//
// Fields match the DSP chain in utils/spacesuitFilter.js. "Randomize"
// draws a fresh profile; "Save" persists to /users/voice-profile so the
// server-side profile is updated for future sessions.
//
// Props:
//   open             — bool
//   onClose          — () => void
//   voiceProfile     — current profile object (may be null while loading)
//   setVoiceProfile  — setter for local profile state
//   bumpVersion      — () => void, called after any slider change so
//                      useRadioConnection re-tunes the live DSP chain
//   pttKey           — current PTT key letter
//   setPttKey        — setter

import { useRef, useState } from 'react';
import api from '../services/api';
import { randomVoiceProfile } from '../utils/spacesuitFilter';

const FIELDS = [
  { field: 'highpass',       label: 'Highpass',   min: 150,   max: 600,   step: 10,   fmt: v => `${v} Hz` },
  { field: 'lowpass',        label: 'Lowpass',    min: 2000,  max: 4500,  step: 50,   fmt: v => `${v} Hz` },
  { field: 'resonance_freq', label: 'Resonance',  min: 800,   max: 2400,  step: 10,   fmt: v => `${v} Hz` },
  { field: 'resonance_q',    label: 'Q',          min: 0.5,   max: 6,     step: 0.1,  fmt: v => v?.toFixed(1) },
  { field: 'distortion',     label: 'Distortion', min: 0,     max: 40,    step: 1,    fmt: v => `${v}` },
  { field: 'static_level',   label: 'Static',     min: 0,     max: 0.015, step: 0.001, fmt: v => (v*1000)?.toFixed(1) },
  { field: 'pitch_shift',    label: 'Pitch',      min: -6,    max: 6,     step: 1,    fmt: v => `${v > 0 ? '+' : ''}${v}` },
  { field: 'bit_crush',      label: 'Bit crush',  min: 6,     max: 16,    step: 1,    fmt: v => `${v} bit` },
];

export default function VoiceProfileModal({
  open, onClose,
  voiceProfile, setVoiceProfile, bumpVersion,
  pttKey, setPttKey,
}) {
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const panelRef = useRef(null);

  if (!open) return null;

  const updateField = (field, value) => {
    setVoiceProfile(p => ({ ...(p || {}), [field]: value }));
    bumpVersion?.();
  };

  const onRandomize = () => {
    const next = randomVoiceProfile();
    setVoiceProfile(next);
    bumpVersion?.();
  };

  const onSave = async () => {
    if (!voiceProfile) return;
    setSaving(true);
    try {
      await api.put('/users/voice-profile', { ...voiceProfile, ptt_key: pttKey });
      setSavedAt(Date.now());
    } catch {}
    setSaving(false);
  };

  return (
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        background: 'rgba(0,0,0,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 10,
      }}
    >
      <div
        ref={panelRef}
        style={{
          width: '100%', maxWidth: 320,
          maxHeight: '92%',
          background: 'linear-gradient(180deg, var(--bz1,#172636), var(--bz2,#0f1b27))',
          border: '1px solid var(--edge, var(--rim0, #1A3A50))',
          borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,.7), inset 0 1px 0 rgba(190,224,255,.18)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'var(--font)',
          color: 'var(--fg1)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid var(--rim0)',
          background: 'linear-gradient(180deg, #0A1B2B, #061018)',
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
            color: 'var(--blue)',
          }}>
            VOICE PROFILE
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="btn"
            onClick={onClose}
            title="Close"
            style={{ width: 24, height: 22, padding: 0, fontSize: 12 }}
          >
            ✕
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '10px 12px' }}>
          {!voiceProfile ? (
            <div style={{ fontSize: 11, color: 'var(--fg3)', padding: '12px 0' }}>Loading profile…</div>
          ) : (
            <>
              {FIELDS.map(({ field, label, min, max, step, fmt }) => (
                <SliderRow
                  key={field}
                  label={label}
                  value={voiceProfile[field] ?? min}
                  min={min} max={max} step={step}
                  format={fmt}
                  onChange={v => updateField(field, v)}
                />
              ))}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                marginTop: 8,
              }}>
                <span style={{
                  fontSize: 10, color: 'var(--fg3)',
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                }}>
                  PTT key
                </span>
                <input
                  value={(pttKey || 'v').toUpperCase()}
                  onChange={e => {
                    const k = (e.target.value.slice(-1) || 'v').toLowerCase();
                    setPttKey(k);
                    try { localStorage.setItem('nexus_ptt_key', k); } catch {}
                    try { window.electronAPI?.setPttKey?.(k); } catch {}
                  }}
                  maxLength={1}
                  title="Push-to-talk key (type a single letter)"
                  style={{
                    width: 36, textAlign: 'center',
                    fontSize: 13, fontWeight: 700,
                    padding: '4px 6px',
                    background: 'var(--bg0)',
                    border: '1px solid var(--rim0)',
                    borderRadius: 4,
                    color: 'var(--fg0)',
                    textTransform: 'uppercase',
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div style={{
          display: 'flex', gap: 6,
          padding: '8px 12px',
          borderTop: '1px solid var(--rim0)',
          background: 'linear-gradient(180deg, #061018, #020C14)',
        }}>
          <button
            className="btn"
            onClick={onRandomize}
            style={{ flex: 1, fontSize: 11, padding: '6px 10px' }}
          >
            Randomize
          </button>
          <button
            className="btn go"
            onClick={onSave}
            disabled={saving}
            style={{ flex: 1, fontSize: 11, padding: '6px 10px' }}
          >
            {saving ? 'Saving…' : savedAt && Date.now() - savedAt < 2000 ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, format, onChange }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, color: 'var(--fg3)',
        letterSpacing: '0.08em', textTransform: 'uppercase',
        marginBottom: 2,
      }}>
        <span>{label}</span>
        <span style={{ color: 'var(--fg1)', fontVariantNumeric: 'tabular-nums' }}>
          {typeof value === 'number' ? format(value) : '—'}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value ?? min}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--rim2)', height: 4 }}
      />
    </div>
  );
}
