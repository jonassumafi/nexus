// Ultra-compact radio-only widget route, loaded by the Electron companion
// when in 'radio' mode. Two states:
//
//   Collapsed (320×44):
//     [ freq LCD ] [ V ] [ who is speaking ] ................ [ ⚙ ] [ ✕ ]
//
//   Expanded (320×420, triggered by gear → setRadioExpanded(true)):
//     The 44px strip stays pinned at the top; below it a settings drawer
//     shows mute toggle, peer list with speaking indicators, voice-profile
//     sliders, preview button, save, and PTT remap.
//
// All data lives in `useRadioConnection` (shared with the dashboard radio
// panel), so this view and the dashboard view see the same frequency,
// peers, and transmitting state in real time. Window chrome (frame,
// shadow, drag region) is handled by preload.js — this component just
// draws the UI inside #root.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext.jsx';
import { useRadioConnection } from '../hooks/useRadioConnection';
import { randomVoiceProfile } from '../utils/spacesuitFilter';
import api from '../services/api';

const PROFILE_FIELDS = [
  'highpass', 'lowpass', 'resonance_freq', 'resonance_q',
  'distortion', 'static_level', 'pitch_shift', 'bit_crush',
];

export default function RadioWidget() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;

  // Voice profile + PTT key state (mirror of what Dashboard owns).
  const [voiceProfile, setVoiceProfile]     = useState(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [pttKey, setPttKey] = useState(() => localStorage.getItem('nexus_ptt_key') || 'v');
  const [micSensitivity, setMicSensitivity] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [micDeviceId, setMicDeviceId]       = useState(() => localStorage.getItem('nexus_mic_device_id') || null);
  const [outputDeviceId, setOutputDeviceId] = useState(() => localStorage.getItem('nexus_output_device_id') || null);

  // Settings drawer open/closed. Drives both the local UI and the
  // Electron window resize so the OS window grows to show the drawer.
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = () => {
    setExpanded(e => {
      const next = !e;
      try { electron?.setRadioExpanded?.(next); } catch {}
      return next;
    });
  };

  const {
    tunedFrequency,
    peers,
    transmittingPeerIds,
    isPTTActive,
    micPermission,
    requestMicPermission,
    joinFrequency,
    getInputLevel,
    startPTT,
    stopPTT,
    setMicSensitivity: setHookMicSensitivity,
    setMuted: setHookMuted,
  } = useRadioConnection({
    voiceProfile,
    voiceProfileVersion: profileVersion,
    pttKey,
    micDeviceId,
    outputDeviceId,
  });

  useEffect(() => { setHookMuted(isMuted); }, [isMuted, setHookMuted]);
  useEffect(() => { setHookMicSensitivity(micSensitivity); }, [micSensitivity, setHookMicSensitivity]);

  // Load the user's voice profile on mount.
  useEffect(() => {
    let cancelled = false;
    api.get('/users/voice-profile').then(({ data }) => {
      if (cancelled) return;
      if (data?.ptt_key) {
        setPttKey(data.ptt_key);
        try { localStorage.setItem('nexus_ptt_key', data.ptt_key); } catch {}
      }
      if (data?.needs_generation) {
        setVoiceProfile(randomVoiceProfile());
      } else {
        const cleaned = {};
        for (const f of PROFILE_FIELDS) {
          cleaned[f] = data?.[f] != null ? Number(data[f]) : null;
        }
        const core = ['highpass', 'lowpass', 'resonance_freq', 'resonance_q', 'distortion', 'static_level'];
        const allSet = core.every(f => cleaned[f] != null);
        if (allSet) {
          if (cleaned.pitch_shift == null) cleaned.pitch_shift = 0;
          if (cleaned.bit_crush == null)   cleaned.bit_crush = 16;
          setVoiceProfile(cleaned);
        } else {
          setVoiceProfile(randomVoiceProfile());
        }
      }
    }).catch(() => { if (!cancelled) setVoiceProfile(randomVoiceProfile()); });
    return () => { cancelled = true; };
  }, []);

  // Auto-tune to the user's current mission frequency if they're on one.
  // Only fires once per mount; if the user retunes manually (from the
  // dashboard) the hook stays with the new frequency.
  const autoTunedRef = useRef(false);
  useEffect(() => {
    if (autoTunedRef.current) return;
    if (!user?.current_mission_assignment?.mission_id) return;
    autoTunedRef.current = true;
    api.get(`/missions/${user.current_mission_assignment.mission_id}`)
      .then(({ data }) => {
        if (data?.frequency && !tunedFrequency) {
          joinFrequency(data.frequency, data._id);
        }
      })
      .catch(() => {});
  }, [user, tunedFrequency, joinFrequency]);

  // Determine who is currently speaking (for the center-strip readout).
  const speakingPeer = useMemo(() => {
    if (isPTTActive) return { label: 'You', self: true };
    const t = Array.from(transmittingPeerIds || []);
    if (t.length === 0) return null;
    const peer = (peers || []).find(p => t.includes(p.socketId));
    return peer ? { label: peer.citizenName || 'Operator', self: false } : null;
  }, [isPTTActive, transmittingPeerIds, peers]);

  // Shared voice-profile update helper — bumps version so the audio
  // pipeline rebuilds its filter chain with the new values.
  const updateProfile = useCallback((field, value) => {
    setVoiceProfile(p => ({ ...(p || {}), [field]: value }));
    setProfileVersion(v => v + 1);
  }, []);

  const onToPTT = useCallback(() => {
    if (isMuted) return;
    startPTT?.();
  }, [isMuted, startPTT]);
  const offToPTT = useCallback(() => { stopPTT?.(); }, [stopPTT]);

  // ── Collapsed strip (always visible) ────────────────────────────────────
  const strip = (
    <div
      className="r-drag"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 44,
        padding: '0 10px',
        background: 'linear-gradient(180deg, #0A1B2B, #061018)',
        borderBottom: expanded ? '1px solid var(--rim0)' : 'none',
      }}
    >
      <div
        className={`lcd r-nodrag${isPTTActive ? ' tx' : ''}`}
        style={{
          fontSize: 15, padding: '3px 8px', minWidth: 72, textAlign: 'center',
          cursor: 'default',
        }}
      >
        {tunedFrequency || '---.-'}
      </div>
      <kbd className="r-nodrag" title="Push-to-talk key">{(pttKey || 'V').toUpperCase()}</kbd>
      <div style={{
        flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600,
        letterSpacing: '0.04em',
        color: speakingPeer ? (speakingPeer.self ? 'var(--cyan)' : 'var(--lime)') : 'var(--fg3)',
        display: 'flex', alignItems: 'center', gap: 6,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {speakingPeer && <span className="live-dot" style={{
          background: speakingPeer.self ? 'var(--cyan)' : 'var(--lime)',
          boxShadow: `0 0 6px ${speakingPeer.self ? 'var(--cyan)' : 'var(--lime)'}`,
        }} />}
        {speakingPeer ? `${speakingPeer.label} speaking` : (
          tunedFrequency ? `${peers?.length || 0} on freq` : 'Not tuned'
        )}
      </div>
      <button
        className="btn r-nodrag"
        onClick={toggleExpanded}
        title={expanded ? 'Close settings' : 'Open settings'}
        style={{ width: 28, height: 28, padding: 0, fontSize: 14 }}
      >
        {expanded ? '×' : '⚙'}
      </button>
      <button
        className="btn warn r-nodrag"
        onClick={() => electron?.close?.()}
        title="Close widget"
        style={{ width: 28, height: 28, padding: 0, fontSize: 12 }}
      >
        ✕
      </button>
    </div>
  );

  // ── Settings drawer (visible only when expanded) ────────────────────────
  const drawer = expanded && (
    <div style={{
      flex: 1, minHeight: 0, overflowY: 'auto',
      padding: 10, display: 'flex', flexDirection: 'column', gap: 10,
      fontSize: 12,
    }}>
      {/* Mute + mic volume + mode button row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          className={`btn${isMuted ? ' warn' : ''}`}
          onClick={() => setIsMuted(m => !m)}
          style={{ fontSize: 11, padding: '5px 10px' }}
        >
          {isMuted ? '🔇 Muted' : '🎙 Live'}
        </button>
        <input
          type="range"
          min={0} max={150} step={5}
          value={micSensitivity}
          onChange={e => setMicSensitivity(Number(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--rim2)' }}
          title={`Mic volume: ${micSensitivity}%`}
        />
        <span style={{
          fontSize: 10, fontWeight: 600, color: 'var(--fg2)',
          fontVariantNumeric: 'tabular-nums', minWidth: 32, textAlign: 'right',
        }}>{micSensitivity}%</span>
      </div>

      {/* Peer list */}
      <div>
        <div className="h3" style={{ margin: '0 0 4px' }}>On frequency</div>
        {!peers || peers.length === 0 ? (
          <div className="empty" style={{ padding: '6px 0', fontSize: 11 }}>
            {tunedFrequency ? 'No other operators' : 'Tune to a frequency from the dashboard'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {peers.map(p => {
              const speaking = transmittingPeerIds?.includes?.(p.socketId);
              const initials = (p.citizenName || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
              return (
                <div key={p.socketId} className={`peer${speaking ? ' speak' : ''}`}>
                  <div className="av">{initials}</div>
                  <span className="nm0">{p.citizenName || 'Operator'}</span>
                  <div className="eq"><i /><i /><i /></div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Voice profile sliders — compact subset */}
      {voiceProfile && (
        <div>
          <div className="h3" style={{ margin: '0 0 4px' }}>Voice profile</div>
          <CompactSlider label="Highpass"   value={voiceProfile.highpass}      min={200}  max={500}  step={10}
                         onChange={v => updateProfile('highpass', v)} />
          <CompactSlider label="Lowpass"    value={voiceProfile.lowpass}       min={2500} max={4000} step={50}
                         onChange={v => updateProfile('lowpass', v)} />
          <CompactSlider label="Distortion" value={voiceProfile.distortion}    min={5}    max={30}   step={1}
                         onChange={v => updateProfile('distortion', v)} />
          <CompactSlider label="Static"     value={voiceProfile.static_level}  min={0.003} max={0.012} step={0.001}
                         onChange={v => updateProfile('static_level', v)} />
        </div>
      )}

      {/* Switch to full dashboard */}
      <button
        className="btn"
        onClick={() => {
          if (electron?.setMode) {
            electron.setMode('full');
          } else {
            navigate('/dashboard');
          }
        }}
        style={{ fontSize: 11, padding: '6px 10px', marginTop: 'auto' }}
      >
        ⊞ Open full dashboard
      </button>
    </div>
  );

  // Request mic permission once if the browser hasn't granted it.
  useEffect(() => {
    if (micPermission === 'prompt' || micPermission === 'denied') {
      requestMicPermission?.();
    }
  }, [micPermission, requestMicPermission]);

  // The widget occupies 100% of #root. Preload CSS sets #root to inset:0
  // under the narrow-window media query, so this fills the window flush.
  return (
    <div
      onMouseDown={e => {
        // Click-and-hold anywhere in the body of the strip (not on buttons)
        // behaves as the OS drag region — but we also allow space-to-PTT
        // via mousedown on the LCD region.
        if (e.target.closest('.lcd')) onToPTT();
      }}
      onMouseUp={() => offToPTT()}
      style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font)', color: 'var(--fg1)',
        background: 'var(--bg0)',
      }}
    >
      {strip}
      {drawer}
    </div>
  );
}

// Compact slider — label on left, value on right, slider below.
function CompactSlider({ label, value, min, max, step, onChange }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, fontWeight: 600, color: 'var(--fg3)',
        letterSpacing: '0.06em', textTransform: 'uppercase',
        marginBottom: 2,
      }}>
        <span>{label}</span>
        <span style={{ color: 'var(--fg1)', fontVariantNumeric: 'tabular-nums' }}>
          {typeof value === 'number' ? (step < 1 ? value.toFixed(3) : Math.round(value)) : '—'}
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
