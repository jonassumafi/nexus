// Radio-only mode — dedicated compact microphone view (360×360).
//
// Rebuilt from scratch in v0.6.3. The previous implementation tried to
// cram the entire companion into a 320×44 strip which showed a clipped
// unusable fragment of the app. This replacement is purpose-built for
// the "radio-only" use case: during Star Citizen play, pin a tiny
// panel in a corner that shows just the mic controls + who is on the
// frequency.
//
// Layout, top → bottom:
//   • TitleBar (frameless custom chrome, min / max / close)
//   • Mode row (⊞ Full · ▬ Companion · ⌖ Pin)
//   • Frequency input (tunable) + headphones mute button
//   • Big Transmit button (push-to-talk, bound to the configured key)
//   • Peer list — operator names with speaking indicator

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from '../context/AuthContext.jsx';
import { useRadioConnection } from '../hooks/useRadioConnection';
import useMyRadio from '../hooks/useMyRadio';
import { randomVoiceProfile } from '../utils/spacesuitFilter';
import api from '../services/api';
import TitleBar from '../components/TitleBar';
import { playTune, playTransmit, playMute, playUnmute } from '../utils/audioFx';
import FreqTuneInput from '../components/FreqTuneInput';
import VoiceProfileModal from '../components/VoiceProfileModal';

const PROFILE_FIELDS = [
  'highpass', 'lowpass', 'resonance_freq', 'resonance_q',
  'distortion', 'static_level', 'pitch_shift', 'bit_crush',
];

export default function RadioWidget() {
  const { user } = useAuthContext();
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;

  const [voiceProfile, setVoiceProfile]     = useState(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [pttKey, setPttKey]                 = useState(() => localStorage.getItem('nexus_ptt_key') || 'v');
  const [isMuted, setIsMuted]               = useState(false);
  const [micDeviceId]    = useState(() => localStorage.getItem('nexus_mic_device_id') || null);
  const [outputDeviceId] = useState(() => localStorage.getItem('nexus_output_device_id') || null);
  const [freqInput, setFreqInput]           = useState('');
  const [pinned, setPinned]                 = useState(false);

  useEffect(() => {
    if (!electron?.onWindowState) return;
    return electron.onWindowState((s) => {
      if (s && typeof s.pinned === 'boolean') setPinned(s.pinned);
    });
  }, [electron]);

  const {
    tunedFrequency, peers, transmittingPeerIds, isPTTActive,
    micPermission, requestMicPermission,
    joinFrequency, startPTT, stopPTT,
    setMuted: setHookMuted,
    setSrsRadioSpec,
  } = useRadioConnection({
    voiceProfile, voiceProfileVersion: profileVersion,
    pttKey, micDeviceId, outputDeviceId,
  });

  const { radio: myRadio } = useMyRadio();
  useEffect(() => { setSrsRadioSpec(myRadio?.spec || null); }, [myRadio, setSrsRadioSpec]);

  useEffect(() => { setHookMuted(isMuted); }, [isMuted, setHookMuted]);
  useEffect(() => { setFreqInput(tunedFrequency || ''); }, [tunedFrequency]);

  // Voice profile load.
  useEffect(() => {
    let cancelled = false;
    api.get('/users/voice-profile').then(({ data }) => {
      if (cancelled) return;
      if (data?.ptt_key) {
        setPttKey(data.ptt_key);
        try { localStorage.setItem('nexus_ptt_key', data.ptt_key); } catch {}
      }
      if (data?.needs_generation) setVoiceProfile(randomVoiceProfile());
      else {
        const cleaned = {};
        for (const f of PROFILE_FIELDS) cleaned[f] = data?.[f] != null ? Number(data[f]) : null;
        const core = ['highpass', 'lowpass', 'resonance_freq', 'resonance_q', 'distortion', 'static_level'];
        if (core.every(f => cleaned[f] != null)) {
          if (cleaned.pitch_shift == null) cleaned.pitch_shift = 0;
          if (cleaned.bit_crush == null)   cleaned.bit_crush = 16;
          setVoiceProfile(cleaned);
        } else setVoiceProfile(randomVoiceProfile());
      }
    }).catch(() => { if (!cancelled) setVoiceProfile(randomVoiceProfile()); });
    return () => { cancelled = true; };
  }, []);

  // Auto-tune to active mission on first mount.
  const autoTunedRef = useRef(false);
  useEffect(() => {
    if (autoTunedRef.current) return;
    if (!user?.current_mission_assignment?.mission_id) return;
    autoTunedRef.current = true;
    api.get(`/missions/${user.current_mission_assignment.mission_id}`).then(({ data }) => {
      if (data?.frequency && !tunedFrequency) joinFrequency(data.frequency, data._id);
    }).catch(() => {});
  }, [user, tunedFrequency, joinFrequency]);

  // Mic permission bootstrap.
  useEffect(() => {
    if (micPermission === 'prompt' || micPermission === 'denied') requestMicPermission?.();
  }, [micPermission, requestMicPermission]);

  const applyFreq = useCallback(() => {
    const raw = (freqInput || '').trim();
    if (!raw) { setFreqInput(tunedFrequency || ''); return; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { setFreqInput(tunedFrequency || ''); return; }
    const normalized = n.toFixed(1);
    if (normalized === tunedFrequency) return;
    try { joinFrequency(normalized, null); } catch {}
  }, [freqInput, tunedFrequency, joinFrequency]);

  const speakingPeer = useMemo(() => {
    if (isPTTActive) return { label: 'You', self: true };
    const t = Array.from(transmittingPeerIds || []);
    if (t.length === 0) return null;
    const p = (peers || []).find(x => t.includes(x.socketId));
    return p ? { label: p.citizenName || 'Operator', self: false } : null;
  }, [isPTTActive, transmittingPeerIds, peers]);

  const onPTTDown = useCallback(() => {
    // Transmit cue fires inside the hook so every mode plays it.
    if (!isMuted) startPTT?.();
  }, [isMuted, startPTT]);
  const onPTTUp   = useCallback(() => { stopPTT?.(); }, [stopPTT]);
  const toggleMute = useCallback(() => {
    setIsMuted(m => { (m ? playUnmute : playMute)(); return !m; });
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg0, #020C14)',
      color: 'var(--fg1, #99BBDD)',
      fontFamily: 'var(--font)',
      overflow: 'hidden',
    }}>
      <TitleBar title="NEXUS" subtitle="Radio" />

      {/* Mode / pin row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '6px 10px',
        borderBottom: '1px solid var(--rim0)',
        background: 'linear-gradient(180deg, var(--bg2), var(--bg1))',
        flexShrink: 0,
      }}>
        <button className="btn" title="Full dashboard"
          onClick={() => electron?.setMode?.('full')}
          style={{ fontSize: 10, padding: '4px 8px' }}>⊞ Full</button>
        <button className="btn" title="Companion"
          onClick={() => electron?.setMode?.('companion')}
          style={{ fontSize: 10, padding: '4px 8px' }}>▬ Companion</button>
        <button className="btn" title="Edit voice profile"
          onClick={() => setShowVoiceModal(true)}
          style={{ fontSize: 10, padding: '4px 8px' }}>🎚 Edit Voice</button>
        <div style={{ flex: 1 }} />
        <button
          className={`btn${pinned ? ' nt on' : ''}`}
          title={pinned ? 'Unpin' : 'Pin on top'}
          onClick={async () => { if (!electron) return; const next = await electron.togglePin(); setPinned(next); }}
          style={{ fontSize: 10, padding: '4px 8px' }}
        >
          ⌖ {pinned ? 'Pinned' : 'Pin'}
        </button>
      </div>

      {/* Frequency + mute */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px 4px',
        flexShrink: 0,
      }}>
        <FreqTuneInput
          value={freqInput}
          onChange={setFreqInput}
          onCommit={applyFreq}
          onCancel={() => setFreqInput(tunedFrequency || '')}
          transmitting={isPTTActive}
          lcdFontSize={18}
          playTune={playTune}
        />
        <button
          className={`btn${isMuted ? ' warn' : ''}`}
          onClick={toggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          aria-pressed={isMuted}
          style={{
            width: 34, height: 32, padding: 0, flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <HeadphonesIcon muted={isMuted} />
        </button>
      </div>

      {/* Transmit */}
      <div style={{ padding: '2px 10px 6px', flexShrink: 0 }}>
        <button
          className={`btn${isPTTActive ? ' tx on' : ''}`}
          onMouseDown={onPTTDown}
          onMouseUp={onPTTUp}
          onMouseLeave={onPTTUp}
          disabled={isMuted || !tunedFrequency}
          style={{
            width: '100%', fontSize: 11,
            padding: '8px 0', userSelect: 'none',
            letterSpacing: '0.08em',
          }}
        >
          {isMuted ? '● Mic muted' :
           !tunedFrequency ? 'Not tuned' :
           isPTTActive ? '● Transmitting' : `● Transmit (${(pttKey || 'V').toUpperCase()})`}
        </button>
      </div>

      {/* Peer list — on frequency */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        padding: '0 10px 8px',
      }}>
        <div style={{
          fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'var(--fg3)', margin: '2px 0 6px',
        }}>
          On frequency {tunedFrequency ? `· ${peers?.length || 0}` : ''}
        </div>
        {!tunedFrequency ? (
          <div style={{ padding: '8px 0', fontSize: 11, color: 'var(--fg3)' }}>
            Tune a frequency to see other operators.
          </div>
        ) : (!peers || peers.length === 0) ? (
          <div style={{ padding: '8px 0', fontSize: 11, color: 'var(--fg3)' }}>
            No other operators on this frequency.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {peers.map(p => {
              const speaking = transmittingPeerIds?.includes?.(p.socketId);
              const initials = (p.citizenName || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
              return (
                <div
                  key={p.socketId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 8px',
                    background: speaking ? 'rgba(68,255,136,.1)' : 'var(--bg1)',
                    border: `1px solid ${speaking ? 'rgba(68,255,136,.4)' : 'var(--rim0)'}`,
                    borderRadius: 4,
                  }}
                >
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--blue) 55%, var(--bg3)), color-mix(in srgb, var(--blue) 18%, var(--bg0)) 75%)',
                    border: '1px solid var(--rim1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 700, color: 'var(--fg0)',
                    flexShrink: 0,
                  }}>
                    {initials}
                  </div>
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 12,
                    color: speaking ? 'var(--lime)' : 'var(--fg1)',
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  }}>
                    {p.citizenName || 'Operator'}
                  </span>
                  {speaking && (
                    <span className="live-dot" style={{
                      background: 'var(--lime)',
                      boxShadow: '0 0 6px var(--lime)',
                    }} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer — who is speaking */}
      <div style={{
        padding: '7px 12px',
        borderTop: '1px solid var(--rim0)',
        background: 'linear-gradient(180deg, var(--bg1), var(--bg0))',
        fontSize: 10,
        color: speakingPeer
          ? (speakingPeer.self ? 'var(--cyan)' : 'var(--lime)')
          : 'var(--fg3)',
        textAlign: 'center',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>
        {speakingPeer ? `${speakingPeer.label} speaking` :
          tunedFrequency ? 'Standby' : 'Not tuned'}
      </div>
      <VoiceProfileModal
        open={showVoiceModal}
        onClose={() => setShowVoiceModal(false)}
        voiceProfile={voiceProfile}
        setVoiceProfile={setVoiceProfile}
        bumpVersion={() => setProfileVersion(v => v + 1)}
        pttKey={pttKey}
        setPttKey={setPttKey}
      />
    </div>
  );
}

// Headphones icon — identical shape to Companion mode's icon so the
// mute control is visually consistent across modes.
function HeadphonesIcon({ muted }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h3v6H5a1 1 0 0 1-1-1v-5z" />
      <path d="M20 14h-3v6h2a1 1 0 0 0 1-1v-5z" />
      {muted && (
        <line x1="3" y1="3" x2="21" y2="21"
              stroke="#FF5544" strokeWidth="2.2" />
      )}
    </svg>
  );
}
