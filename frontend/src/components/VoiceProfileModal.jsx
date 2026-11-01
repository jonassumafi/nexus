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

import { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { buildSpacesuitChain, randomVoiceProfile } from '../utils/spacesuitFilter';
import { buildSrsChain } from '../utils/srsChain';
import useMyRadio from '../hooks/useMyRadio';
import useSavePulse from '../hooks/useSavePulse';

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
  const savePulse = useSavePulse();
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
      savePulse.trigger();
    } catch {}
    setSaving(false);
  };

  // Preview — opens the mic, routes it through the full outbound chain
  // (voice profile → SRS tx), and plays the processed signal through
  // the user's speakers for 5 s so they hear exactly how they sound to
  // peers. Uses echoCancellation to minimize feedback via speakers;
  // headphones recommended for best preview quality.
  const PREVIEW_SECONDS = 5;
  const [previewRemaining, setPreviewRemaining] = useState(0);
  const onPreview = async () => {
    if (previewing || !voiceProfile) return;
    setPreviewing(true);
    setPreviewRemaining(PREVIEW_SECONDS);

    let ctx = null, mic = null, chain = null, srsOut = null, stopTimer = null, tickTimer = null;
    const cleanup = () => {
      try { if (tickTimer) clearInterval(tickTimer); } catch {}
      try { if (stopTimer) clearTimeout(stopTimer); } catch {}
      try { chain?.dispose?.(); } catch {}
      try { srsOut?.dispose?.(); } catch {}
      try { mic?.getTracks().forEach(t => t.stop()); } catch {}
      try { ctx?.close(); } catch {}
      setPreviewing(false);
      setPreviewRemaining(0);
    };

    try {
      // Mic grab — same constraints the hook uses so sound character
      // matches the real transmit path.
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });

      const Ctx = window.AudioContext || window.webkitAudioContext;
      ctx = new Ctx();
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }

      const source = ctx.createMediaStreamSource(mic);
      chain = await buildSpacesuitChain(ctx, source, voiceProfile);
      let tail = chain.output;
      if (myRadio?.spec?.txEffect) {
        try {
          srsOut = buildSrsChain(ctx, myRadio.spec.txEffect);
          chain.output.connect(srsOut.input);
          tail = srsOut.output;
        } catch {}
      }

      // Modest makeup gain so the preview isn't painfully loud but
      // isn't a whisper either. Users wearing headphones will hear
      // themselves clearly; speaker users will get some low-level
      // feedback they can tolerate for 5 seconds.
      const makeup = ctx.createGain();
      makeup.gain.value = 0.75;
      tail.connect(makeup);
      makeup.connect(ctx.destination);

      // Countdown + auto-stop
      tickTimer = setInterval(() => {
        setPreviewRemaining(r => Math.max(0, r - 1));
      }, 1000);
      stopTimer = setTimeout(cleanup, PREVIEW_SECONDS * 1000);
    } catch (err) {
      console.error('[voice preview] mic failed:', err);
      cleanup();
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
            title="Speak into your mic to hear yourself through your rig (5 s). Headphones recommended."
            style={{ flex: 1, fontSize: 11, padding: '6px 10px' }}
          >
            {previewing ? `🎙 Speak… ${previewRemaining}s` : '🎙 Preview'}
          </button>
          <button
            className="btn"
            onClick={onRandomize}
            style={{ flex: 1, fontSize: 11, padding: '6px 10px' }}
          >
            Randomize
          </button>
          <button
            className={`btn go ${savePulse.className}`}
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
  const { radio, loading, refetch } = useMyRadio();
  const [catalog, setCatalog] = useState([]);
  const [busy, setBusy]       = useState(false);

  // Pull the full catalog so the player can pick ANY rig, not just
  // random-roll. Catalog is small (25 entries) and effectively static,
  // so one fetch per modal open is fine.
  useEffect(() => {
    api.get('/radio/models')
      .then(({ data }) => setCatalog(Array.isArray(data) ? data : []))
      .catch(() => setCatalog([]));
  }, []);

  const change = async (body) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.put('/radio/my-radio', body);
      refetch();
    } catch (err) {
      console.error('[radio self-change] failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const cycle = (dir) => {
    if (!catalog.length || !radio) return;
    const idx = catalog.findIndex(r => r.id === radio.id);
    const nextIdx = ((idx === -1 ? 0 : idx) + dir + catalog.length) % catalog.length;
    change({ radio_type: catalog[nextIdx].id });
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
      {/* Self-serve picker — prev / next cycle through all 25 presets,
          random re-rolls to a fresh one, dropdown jumps to any specific
          rig. All three write to PUT /api/radio/my-radio and refetch so
          the DSP chain rebuilds with the new preset on next tune. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        marginTop: 8,
      }}>
        <button
          type="button"
          onClick={() => cycle(-1)}
          disabled={busy || !catalog.length}
          title="Previous rig"
          style={pickerBtn}
        >
          ◀
        </button>
        <select
          value={radio.id}
          onChange={e => change({ radio_type: e.target.value })}
          disabled={busy || !catalog.length}
          title="Jump to a specific rig"
          style={{
            flex: 1, minWidth: 0,
            fontSize: 11, padding: '3px 6px',
            background: 'var(--inset)',
            border: '1px solid var(--rim0)',
            borderRadius: 3,
            color: 'var(--fg0)',
          }}
        >
          {catalog.map(r => (
            <option key={r.id} value={r.id}>
              {r.label} · {r.band} ({r.family_label})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => cycle(1)}
          disabled={busy || !catalog.length}
          title="Next rig"
          style={pickerBtn}
        >
          ▶
        </button>
        <button
          type="button"
          onClick={() => change({ reroll: true })}
          disabled={busy}
          title="Random rig"
          style={{ ...pickerBtn, color: 'var(--cyan)' }}
        >
          🎲
        </button>
      </div>
    </div>
  );
}

const pickerBtn = {
  fontSize: 11, padding: '3px 8px',
  background: 'transparent',
  border: '1px solid var(--rim1)',
  borderRadius: 3,
  color: 'var(--fg1)',
  cursor: 'pointer',
  minWidth: 26,
  textAlign: 'center',
};
