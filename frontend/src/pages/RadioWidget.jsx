// Radio-only mode — compact horizontal strip (v0.7.2).
//
// Single-row control strip + tiny 2-column peer grid underneath. All the
// essentials in a narrow horizontal footprint so it can sit as an
// unobtrusive overlay next to the Star Citizen window.
//
// Layout:
//   • TitleBar
//   • Row 1 (horizontal): mode nav · freq · transmit · mute · PTT key · pin
//   • Row 2: 2-column grid of peers on this frequency (highlight on transmit)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from '../context/AuthContext.jsx';
import { useRadioConnection } from '../hooks/useRadioConnection';
import useMyRadio from '../hooks/useMyRadio';
import { randomVoiceProfile } from '../utils/spacesuitFilter';
import api from '../services/api';
import TitleBar from '../components/TitleBar';
import { playTune, playMute, playUnmute } from '../utils/audioFx';
import FreqTuneInput from '../components/FreqTuneInput';

const PROFILE_FIELDS = [
  'highpass', 'lowpass', 'resonance_freq', 'resonance_q',
  'distortion', 'static_level', 'pitch_shift', 'bit_crush',
];

export default function RadioWidget() {
  const { user } = useAuthContext();
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;

  const [voiceProfile, setVoiceProfile]     = useState(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [pttKey, setPttKey]                 = useState(() => localStorage.getItem('nexus_ptt_key') || 'v');
  const [isMuted, setIsMuted]               = useState(false);
  const [micDeviceId, setMicDeviceId]       = useState(() => localStorage.getItem('nexus_mic_device_id') || null);
  const [outputDeviceId, setOutputDeviceId] = useState(() => localStorage.getItem('nexus_output_device_id') || null);
  const [micSensitivity, setMicSensitivity] = useState(() => {
    const stored = Number(localStorage.getItem('nexus_mic_sensitivity'));
    return Number.isFinite(stored) && stored > 0 ? stored : 100;
  });
  const [settingsOpen, setSettingsOpen]     = useState(false);
  const [inputDevices, setInputDevices]     = useState([]);
  const [outputDevices, setOutputDevices]   = useState([]);
  const [freqInput, setFreqInput]           = useState('');
  const [pinned, setPinned]                 = useState(false);
  const [remapListening, setRemapListening] = useState(false);
  const isFirstKeydownRef = useRef(false);
  const [opacity, setOpacity]               = useState(1);
  const [opacityOpen, setOpacityOpen]       = useState(false);

  // Load current window opacity on mount so the slider reflects persisted state.
  useEffect(() => {
    (async () => {
      try {
        const v = await electron?.getOpacity?.();
        if (typeof v === 'number') setOpacity(v);
      } catch {}
    })();
  }, [electron]);

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
    setMicSensitivity: setHookSensitivity,
    setSrsRadioSpec,
    setSrsRadioBand,
  } = useRadioConnection({
    voiceProfile, voiceProfileVersion: profileVersion,
    pttKey, micDeviceId, outputDeviceId,
  });

  // Sync sensitivity + device selections into the hook / localStorage.
  useEffect(() => {
    try { localStorage.setItem('nexus_mic_sensitivity', String(micSensitivity)); } catch {}
    setHookSensitivity?.(micSensitivity);
  }, [micSensitivity, setHookSensitivity]);
  useEffect(() => {
    if (micDeviceId == null) { try { localStorage.removeItem('nexus_mic_device_id'); } catch {} return; }
    try { localStorage.setItem('nexus_mic_device_id', micDeviceId); } catch {}
  }, [micDeviceId]);
  useEffect(() => {
    if (outputDeviceId == null) { try { localStorage.removeItem('nexus_output_device_id'); } catch {} return; }
    try { localStorage.setItem('nexus_output_device_id', outputDeviceId); } catch {}
  }, [outputDeviceId]);

  // Enumerate audio devices when the settings panel opens.
  useEffect(() => {
    if (!settingsOpen) return;
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const enumerate = () => {
      navigator.mediaDevices.enumerateDevices().then((devs) => {
        setInputDevices(devs.filter(d => d.kind === 'audioinput'));
        setOutputDevices(devs.filter(d => d.kind === 'audiooutput'));
      }).catch(() => {});
    };
    enumerate();
    navigator.mediaDevices.addEventListener?.('devicechange', enumerate);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', enumerate);
  }, [settingsOpen]);

  const { radio: myRadio } = useMyRadio();
  useEffect(() => { setSrsRadioSpec(myRadio?.spec || null); }, [myRadio, setSrsRadioSpec]);
  useEffect(() => { setSrsRadioBand(myRadio?.band || 'VHF'); }, [myRadio, setSrsRadioBand]);

  useEffect(() => { setHookMuted(isMuted); }, [isMuted, setHookMuted]);
  useEffect(() => { setFreqInput(tunedFrequency || ''); }, [tunedFrequency]);

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

  const autoTunedRef = useRef(false);
  useEffect(() => {
    if (autoTunedRef.current) return;
    if (!user?.current_mission_assignment?.mission_id) return;
    autoTunedRef.current = true;
    api.get(`/missions/${user.current_mission_assignment.mission_id}`).then(({ data }) => {
      if (data?.frequency && !tunedFrequency) joinFrequency(data.frequency, data._id);
    }).catch(() => {});
  }, [user, tunedFrequency, joinFrequency]);

  useEffect(() => {
    if (micPermission === 'prompt' || micPermission === 'denied') requestMicPermission?.();
  }, [micPermission, requestMicPermission]);

  // PTT remap — two-phase window keydown listener (same logic as the
  // Radio-panel settings view). Persists to localStorage, syncs to the
  // server, and the useRadioConnection effect pushes it to Electron main
  // so the global hook starts listening for the new key.
  useEffect(() => {
    if (!remapListening) return;
    const commit = (newKey) => {
      setPttKey(newKey);
      try { localStorage.setItem('nexus_ptt_key', newKey); } catch {}
      setRemapListening(false);
      api.put('/users/voice-profile', { ptt_key: newKey }).catch(() => {});
    };
    const keyHandler = (e) => {
      e.preventDefault();
      if (isFirstKeydownRef.current) {
        isFirstKeydownRef.current = false;
        return;
      }
      commit(e.key);
    };
    const mouseHandler = (e) => {
      if (e.button < 3) return;
      e.preventDefault();
      commit(`Mouse${e.button + 1}`);
    };
    const noCtx = (e) => e.preventDefault();
    window.addEventListener('keydown', keyHandler);
    window.addEventListener('mousedown', mouseHandler);
    window.addEventListener('contextmenu', noCtx);
    return () => {
      window.removeEventListener('keydown', keyHandler);
      window.removeEventListener('mousedown', mouseHandler);
      window.removeEventListener('contextmenu', noCtx);
    };
  }, [remapListening]);

  const startRemap = () => {
    isFirstKeydownRef.current = true;
    setRemapListening(true);
  };

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
    if (!isMuted) startPTT?.();
  }, [isMuted, startPTT]);
  const onPTTUp   = useCallback(() => { stopPTT?.(); }, [stopPTT]);
  const toggleMute = useCallback(() => {
    setIsMuted(m => { (m ? playUnmute : playMute)(); return !m; });
  }, []);

  const pttLabel = (pttKey || 'V').toUpperCase();
  const pttIsMouse = /^MOUSE\d+$/i.test(pttKey || '');
  const pttIcon = pttIsMouse ? '🖱' : '⌨';

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

      {/* ── Primary row — all controls in a single horizontal strip ─────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 8px',
        borderBottom: '1px solid var(--rim0)',
        background: 'linear-gradient(180deg, var(--bg2), var(--bg1))',
        flexShrink: 0,
      }}>
        <button className="btn" title="Full dashboard"
          onClick={() => electron?.setMode?.('full')}
          style={{ width: 28, height: 26, padding: 0, fontSize: 11, flexShrink: 0 }}>⊞</button>
        <button className="btn" title="Companion"
          onClick={() => electron?.setMode?.('companion')}
          style={{ width: 28, height: 26, padding: 0, fontSize: 11, flexShrink: 0 }}>▬</button>

        <div style={{ width: 120 }}>
          <FreqTuneInput
            value={freqInput}
            onChange={setFreqInput}
            onCommit={applyFreq}
            onCancel={() => setFreqInput(tunedFrequency || '')}
            transmitting={isPTTActive}
            lcdFontSize={14}
            playTune={playTune}
          />
        </div>

        <button
          className={`btn${isPTTActive ? ' tx on' : ''}`}
          onMouseDown={onPTTDown}
          onMouseUp={onPTTUp}
          onMouseLeave={onPTTUp}
          disabled={isMuted || !tunedFrequency}
          style={{
            // flex-grow + height matched to the other row buttons so the
            // TX button sits inline with ⊞ ▬ mute, remap, pin — same height,
            // not visually compressed.
            flex: 1, fontSize: 10, height: 26, padding: '0 8px',
            userSelect: 'none', letterSpacing: '0.06em',
          }}
        >
          {isMuted ? '● Muted' :
           !tunedFrequency ? 'Not tuned' :
           isPTTActive ? '● TX' : `● TX (${pttLabel})`}
        </button>

        <button
          className={`btn${isMuted ? ' warn' : ''}`}
          onClick={toggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
          style={{
            width: 28, height: 26, padding: 0, flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <HeadphonesIcon muted={isMuted} />
        </button>

        <button
          className={`btn${remapListening ? ' amb' : ''}`.trim()}
          onClick={remapListening ? undefined : startRemap}
          disabled={remapListening}
          title={remapListening ? 'Press any key to bind' : `PTT key: ${pttLabel} — click to remap`}
          style={{
            fontSize: 10, padding: '0 8px', height: 26,
            minWidth: 54, letterSpacing: '0.06em',
            // Force readable text on top of the amber '.amb' background,
            // which otherwise applies dark text that disappears.
            ...(remapListening ? { color: '#ffffff', fontWeight: 700 } : {}),
          }}
        >
          {remapListening ? 'Press…' : `${pttIcon} ${pttLabel}`}
        </button>

        {/* Opacity control — dims the window to see through to Star Citizen */}
        <div style={{ position: 'relative' }}>
          <button
            className="btn"
            title={`Opacity: ${Math.round(opacity * 100)}%`}
            onClick={() => setOpacityOpen(o => !o)}
            style={{
              width: 28, height: 26, padding: 0, flexShrink: 0,
              fontSize: 11, letterSpacing: 0,
            }}
          >◐</button>
          {opacityOpen && (
            <div
              onMouseLeave={() => setOpacityOpen(false)}
              style={{
                position: 'absolute', right: 0, top: '110%', zIndex: 10,
                padding: '8px 10px',
                background: 'var(--bg2, #0b1824)',
                border: '1px solid var(--rim1, #2A5A7A)',
                borderRadius: 5,
                boxShadow: '0 6px 16px rgba(0,0,0,.5)',
                minWidth: 160,
              }}
            >
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 6, fontSize: 10, color: 'var(--fg2)',
                letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600,
              }}>
                <span>Opacity</span>
                <span style={{ color: 'var(--cyan)', fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(opacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={30} max={100} step={5}
                value={Math.round(opacity * 100)}
                onChange={async e => {
                  const v = Number(e.target.value) / 100;
                  setOpacity(v);
                  try { await electron?.setOpacity?.(v); } catch {}
                }}
                style={{ width: '100%', accentColor: 'var(--cyan, #00EEFF)' }}
              />
            </div>
          )}
        </div>

        <button
          className="btn"
          title="Settings"
          onClick={() => setSettingsOpen(o => !o)}
          style={{ width: 28, height: 26, padding: 0, fontSize: 12, flexShrink: 0 }}
        >⚙</button>

        <button
          className={`btn${pinned ? ' nt on' : ''}`}
          title={pinned ? 'Unpin' : 'Pin on top'}
          onClick={async () => { if (!electron) return; const next = await electron.togglePin(); setPinned(next); }}
          style={{ width: 28, height: 26, padding: 0, fontSize: 11, flexShrink: 0 }}
        >⌖</button>
      </div>

      {/* ── Settings panel — expands below the top row when ⚙ is clicked ── */}
      {settingsOpen && (
        <div style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--rim0)',
          background: 'var(--bg1, #0b1824)',
          display: 'flex', flexDirection: 'column', gap: 8,
          flexShrink: 0,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'var(--fg2)', fontWeight: 700,
          }}>
            <span>Settings</span>
            <button
              onClick={() => setSettingsOpen(false)}
              style={{
                background: 'none', border: 'none', padding: 0,
                color: 'var(--fg3)', cursor: 'pointer', fontSize: 12,
              }}>✕</button>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--fg2)',
              textTransform: 'uppercase', fontWeight: 600 }}>Input device</span>
            <select
              className="inp"
              value={micDeviceId ?? '__default__'}
              onChange={e => setMicDeviceId(e.target.value === '__default__' ? null : e.target.value)}
              style={{ fontSize: 11, padding: '3px 6px' }}
            >
              <option value="__default__">System default</option>
              {inputDevices.map((d, i) => (
                <option key={d.deviceId || `in-${i}`} value={d.deviceId}>
                  {d.label || `Input ${i + 1}`}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--fg2)',
              textTransform: 'uppercase', fontWeight: 600 }}>Output device</span>
            <select
              className="inp"
              value={outputDeviceId ?? '__default__'}
              onChange={e => setOutputDeviceId(e.target.value === '__default__' ? null : e.target.value)}
              style={{ fontSize: 11, padding: '3px 6px' }}
            >
              <option value="__default__">System default</option>
              {outputDevices.map((d, i) => (
                <option key={d.deviceId || `out-${i}`} value={d.deviceId}>
                  {d.label || `Output ${i + 1}`}
                </option>
              ))}
            </select>
          </label>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--fg2)',
                textTransform: 'uppercase', fontWeight: 600 }}>Mic volume</span>
              <span style={{ fontSize: 10, color: 'var(--fg0)', fontVariantNumeric: 'tabular-nums' }}>
                {micSensitivity}%
              </span>
            </div>
            <input
              type="range"
              min={0} max={150} step={5}
              value={micSensitivity}
              onChange={e => setMicSensitivity(Number(e.target.value))}
              style={{
                width: '100%', height: 10, cursor: 'pointer',
                accentColor: 'var(--cyan, #00EEFF)',
                background: 'var(--bg0, #020C14)',
                border: '1px solid var(--rim1, #2A5A7A)',
                borderRadius: 4,
                padding: 0,
              }}
            />
          </div>

          <div style={{
            fontSize: 9, color: 'var(--fg3)', letterSpacing: '0.08em', textAlign: 'right',
          }}>
            PTT key: {pttLabel} · open the full dashboard for more
          </div>
        </div>
      )}

      {/* ── Peers — tiny 2-column grid, highlight on transmit.
            Collapsed to a 1-line hint when there's nothing to show, so
            the window can shrink to just the top row + a status strip. */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        padding: '2px 8px 4px',
      }}>
        {!tunedFrequency ? (
          <div style={{
            fontSize: 10, color: 'var(--fg3)', textAlign: 'center',
            padding: '2px 0', letterSpacing: '0.1em',
          }}>Tune a frequency.</div>
        ) : (!peers || peers.length === 0) ? (
          <div style={{
            fontSize: 10, color: 'var(--fg3)', textAlign: 'center',
            padding: '2px 0', letterSpacing: '0.1em',
          }}>No other operators.</div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '3px 6px',
          }}>
            {peers.map(p => {
              const speaking = transmittingPeerIds?.includes?.(p.socketId);
              return (
                <div
                  key={p.socketId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '2px 6px',
                    background: speaking ? 'rgba(68,255,136,.14)' : 'transparent',
                    border: `1px solid ${speaking ? 'rgba(68,255,136,.55)' : 'var(--rim0)'}`,
                    borderRadius: 3,
                    minWidth: 0,
                  }}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: speaking ? 'var(--lime)' : 'var(--rim1)',
                    boxShadow: speaking ? '0 0 5px var(--lime)' : 'none',
                    flexShrink: 0,
                  }} />
                  <span style={{
                    fontSize: 11,
                    color: speaking ? 'var(--lime)' : 'var(--fg1)',
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    fontWeight: speaking ? 600 : 400,
                  }}>
                    {p.citizenName || 'Operator'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function HeadphonesIcon({ muted }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h3v6H5a1 1 0 0 1-1-1v-5z" />
      <path d="M20 14h-3v6h2a1 1 0 0 0 1-1v-5z" />
      {muted && (
        <line x1="3" y1="3" x2="21" y2="21" stroke="#FF5544" strokeWidth="2.2" />
      )}
    </svg>
  );
}
