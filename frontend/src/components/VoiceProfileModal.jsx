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
import { buildSpacesuitChain, randomVoiceProfile } from '../utils/spacesuitFilter';
import { buildSrsChain } from '../utils/srsChain';
import useMyRadio from '../hooks/useMyRadio';

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
  const [previewing, setPreviewing] = useState(false);
  const panelRef = useRef(null);
  const { radio: myRadio } = useMyRadio();

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

  // Preview — plays a brief pink-noise burst through the full outbound
  // chain (voice profile → SRS tx) so the operator hears exactly what
  // peers will hear, without needing a live transmission.
  const onPreview = async () => {
    if (previewing || !voiceProfile) return;
    setPreviewing(true);
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }

      // Short pink-noise voice stand-in. 1.2 s, decays over its length.
      const dur = 1.2;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const d = buf.getChannelData(0);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886*b0 + w*0.0555179;
        b1 = 0.99332*b1 + w*0.0750759;
        b2 = 0.96900*b2 + w*0.1538520;
        b3 = 0.86650*b3 + w*0.3104856;
        b4 = 0.55000*b4 + w*0.5329522;
        b5 = -0.7616*b5 - w*0.0168980;
        const pink = (b0+b1+b2+b3+b4+b5+b6+w*0.5362) * 0.09;
        b6 = w * 0.115926;
        // AM-modulate so it sounds like speech cadence, not pure hiss
        const t = i / ctx.sampleRate;
        const env = Math.max(0, Math.sin(t * 8) * 0.6 + 0.4);
        d[i] = pink * env;
      }

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const chain = await buildSpacesuitChain(ctx, src, voiceProfile);
      let tail = chain.output;
      if (myRadio?.spec?.txEffect) {
        try {
          const srs = buildSrsChain(ctx, myRadio.spec.txEffect);
          chain.output.connect(srs.input);
          tail = srs.output;
        } catch {}
      }
      const makeup = ctx.createGain();
      makeup.gain.value = 0.6;
      tail.connect(makeup); makeup.connect(ctx.destination);
      src.start();
      src.onended = () => {
        try { chain.dispose?.(); } catch {}
        try { ctx.close(); } catch {}
        setPreviewing(false);
      };
      // Safety net — close ctx after dur + a hair in case onended doesn't fire
      setTimeout(() => { try { ctx.close(); } catch {}; setPreviewing(false); }, (dur + 0.3) * 1000);
    } catch (err) {
      console.error('[voice preview] failed:', err);
      setPreviewing(false);
    }
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
          {/* Assigned radio rig — read-only for players, admin can
              re-roll via the admin panel. Shown above the voice-profile
              sliders so the player sees what hardware they're on. */}
          <RadioRigChip />
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
            onClick={onPreview}
            disabled={previewing || !voiceProfile}
            title="Hear what your voice sounds like through your rig"
            style={{ flex: 1, fontSize: 11, padding: '6px 10px' }}
          >
            {previewing ? '▶ Playing…' : '▶ Preview'}
          </button>
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

// Read-only rig display. Shows the player what SRS radio preset they
// were assigned. Admin re-rolls happen via /api/radio/user/:id/radio
// — a self-serve re-roll flow (if we add one later) can wire a button
// into this chip's affordance area.
function RadioRigChip() {
  const { radio, loading } = useMyRadio();
  const [requesting, setRequesting] = useState(false);
  const [reqState, setReqState] = useState({ type: 'idle', msg: '' });

  const requestReroll = async () => {
    if (requesting) return;
    setRequesting(true);
    setReqState({ type: 'idle', msg: '' });
    try {
      await api.post('/radio/request-reroll', { reason: '' });
      setReqState({ type: 'ok', msg: 'Request sent to admin.' });
    } catch (err) {
      const msg = err?.response?.data?.error === 'already requested recently'
        ? 'Already requested recently — hang tight.'
        : (err?.response?.data?.error || 'Request failed.');
      setReqState({ type: 'err', msg });
    }
    setRequesting(false);
  };

  if (loading) {
    return (
      <div style={{
        padding: '8px 10px', marginBottom: 12,
        border: '1px solid var(--rim0)', borderRadius: 4,
        background: 'var(--bg0)', fontSize: 10, color: 'var(--fg3)',
      }}>
        Loading rig…
      </div>
    );
  }
  if (!radio) return null;
  return (
    <div style={{
      padding: '8px 10px', marginBottom: 12,
      border: '1px solid var(--rim0)', borderRadius: 4,
      background: 'linear-gradient(180deg, var(--card-hi), var(--card-lo))',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 6,
        marginBottom: 2,
      }}>
        <span style={{
          fontSize: 9, color: 'var(--fg3)',
          letterSpacing: '0.14em', textTransform: 'uppercase',
        }}>
          Assigned rig
        </span>
        <span style={{
          fontSize: 9, color: 'var(--cyan)',
          letterSpacing: '0.1em', textTransform: 'uppercase',
          marginLeft: 'auto',
        }}>
          {radio.family_label} · {radio.band}
        </span>
      </div>
      <div style={{
        fontSize: 13, fontWeight: 700, color: 'var(--fg0)',
        letterSpacing: '0.04em',
      }}>
        {radio.label}
      </div>
      {radio.blurb && (
        <div style={{
          fontSize: 10, color: 'var(--fg2)', lineHeight: 1.5,
          marginTop: 2,
        }}>
          {radio.blurb}
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginTop: 6,
      }}>
        <button
          type="button"
          onClick={requestReroll}
          disabled={requesting || reqState.type === 'ok'}
          title="Ask the admin to roll a different rig for you"
          style={{
            fontSize: 10, padding: '3px 10px',
            background: 'transparent',
            border: '1px solid var(--rim1)',
            borderRadius: 3,
            color: 'var(--fg2)',
            cursor: 'pointer',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {requesting ? 'Sending…' : reqState.type === 'ok' ? 'Requested' : 'Request re-roll'}
        </button>
        {reqState.msg && (
          <span style={{
            fontSize: 9,
            color: reqState.type === 'ok' ? 'var(--lime)' : 'var(--red)',
          }}>
            {reqState.msg}
          </span>
        )}
      </div>
    </div>
  );
}
