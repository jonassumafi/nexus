import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { useRadioConnection } from '../hooks/useRadioConnection';
import {
  VOICE_PROFILE_RANGES,
  randomVoiceProfile,
  buildSpacesuitChain,
} from '../utils/spacesuitFilter';

const PROFILE_FIELDS = [
  'highpass', 'lowpass', 'resonance_freq', 'resonance_q',
  'distortion', 'static_level', 'pitch_shift', 'bit_crush',
];

const FIELD_LABELS = {
  highpass:       'HIGHPASS CUTOFF',
  lowpass:        'LOWPASS CUTOFF',
  resonance_freq: 'RESONANCE FREQ',
  resonance_q:    'RESONANCE Q',
  distortion:     'DISTORTION',
  static_level:   'STATIC LEVEL',
  pitch_shift:    'PITCH SHIFT',
  bit_crush:      'BIT CRUSH',
};

const FIELD_UNITS = {
  highpass:       'Hz',
  lowpass:        'Hz',
  resonance_freq: 'Hz',
  resonance_q:    '',
  distortion:     '',
  static_level:   '',
  pitch_shift:    '',
  bit_crush:      '',
};

const FIELD_DISPLAY = {
  pitch_shift: (v) => (v >= 0 ? '+' : '') + Number(v).toFixed(1) + 'st',
  bit_crush:   (v) => Math.round(v) + ' bit',
};

const FONT = "'JetBrains Mono', 'Courier New', Courier, monospace";

const PANEL_BG       = '#06121C';
const HEADER_BG      = '#0A1A28';
const FREQ_BG        = '#08141F';
const SOFT_DIVIDER   = '#1A3D55';
const PANEL_BORDER   = '#2A6A9A';

export default function RadioPanel({ missionFrequency = null, missionId = null }) {
  const [voiceProfile, setVoiceProfile] = useState(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [radioState, setRadioState] = useState('standby');
  const [manualFreq, setManualFreq] = useState('');
  const [pttKey, setPttKey] = useState(() => localStorage.getItem('nexus_ptt_key') || 'v');

  const {
    tunedFrequency,
    peers,
    transmittingPeerIds,
    isPTTActive,
    joinFrequency,
    leaveFrequency,
    getInputLevel,
    setMicSensitivity,
    setMuted,
  } = useRadioConnection({ voiceProfile, voiceProfileVersion: profileVersion, pttKey });

  const [isMuted, setIsMuted] = useState(false);
  const [micSensitivity, setMicSensitivityState] = useState(100);

  useEffect(() => { setMuted(isMuted); }, [isMuted, setMuted]);
  useEffect(() => { setMicSensitivity(micSensitivity); }, [micSensitivity, setMicSensitivity]);

  // Load voice profile from server
  useEffect(() => {
    let cancelled = false;
    api.get('/users/voice-profile').then(({ data }) => {
      if (cancelled) return;
      // PTT key: server value wins, else keep whatever localStorage-derived
      // value the useState initializer already set. Also mirror the server
      // value down to localStorage so the initializer hits the same value
      // next mount even before the fetch completes.
      if (data?.ptt_key != null && data.ptt_key !== '') {
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
        const coreFields = ['highpass', 'lowpass', 'resonance_freq', 'resonance_q', 'distortion', 'static_level'];
        const allSet = coreFields.every(f => cleaned[f] != null);
        if (allSet) {
          if (cleaned.pitch_shift == null) cleaned.pitch_shift = 0;
          if (cleaned.bit_crush == null)   cleaned.bit_crush = 16;
          setVoiceProfile(cleaned);
        } else {
          setVoiceProfile(randomVoiceProfile());
        }
      }
    }).catch(() => {
      if (!cancelled) setVoiceProfile(randomVoiceProfile());
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (tunedFrequency && radioState === 'standby') setRadioState('tuned');
    // If the underlying connection drops mid-retune (or after tuned), drop
    // back to standby so the panel doesn't render a stale editor.
    if (!tunedFrequency && (radioState === 'tuned' || radioState === 'retuning')) {
      setRadioState('standby');
    }
  }, [tunedFrequency, radioState]);

  const onTuneManual = useCallback(() => {
    const f = manualFreq.trim();
    if (!f) return;
    joinFrequency(f, missionId);
    setManualFreq('');
  }, [manualFreq, joinFrequency, missionId]);

  const onTuneMission = useCallback(() => {
    if (!missionFrequency) return;
    joinFrequency(String(missionFrequency), missionId);
  }, [missionFrequency, missionId, joinFrequency]);

  const onDisconnect = useCallback(() => leaveFrequency(), [leaveFrequency]);

  // Retune: stay connected while the operator edits inline. leaveFrequency()
  // is only called on confirm (via joinFrequency's internal room-switch).
  const onRetune       = useCallback(() => setRadioState('retuning'), []);
  const onCancelRetune = useCallback(() => setRadioState('tuned'), []);
  const onConfirmRetune = useCallback(async (newFreq) => {
    // joinFrequency internally emits radio:leave for the current room before
    // joining the new one — awaiting the join before switching UI state
    // avoids the tuned-with-old-freq flash.
    await joinFrequency(newFreq, missionId);
    setRadioState('tuned');
  }, [joinFrequency, missionId]);

  return (
    <div style={{
      margin: '8px 8px 8px 0',
      background: PANEL_BG,
      border: `1px solid ${PANEL_BORDER}`,
      boxShadow: 'inset 0 0 0 1px #0D2030',
      fontFamily: FONT,
      flexShrink: 0,
    }}>
      {radioState === 'settings' ? (
        <SettingsView
          voiceProfile={voiceProfile}
          setVoiceProfile={setVoiceProfile}
          bumpProfileVersion={() => setProfileVersion(v => v + 1)}
          onClose={() => setRadioState(tunedFrequency ? 'tuned' : 'standby')}
          getInputLevel={getInputLevel}
          pttKey={pttKey}
          setPttKey={setPttKey}
        />
      ) : (
        <>
          <PanelHeader
            title="NEXUS COMM SYSTEM"
            isTuned={!!tunedFrequency}
            onOpenSettings={() => setRadioState('settings')}
          />
          {tunedFrequency ? (
            <TunedView
              frequency={tunedFrequency}
              peers={peers}
              transmittingPeerIds={transmittingPeerIds}
              isPTTActive={isPTTActive}
              isMuted={isMuted}
              onToggleMute={() => setIsMuted(m => !m)}
              micSensitivity={micSensitivity}
              onSensitivityChange={setMicSensitivityState}
              onDisconnect={onDisconnect}
              onRetune={onRetune}
              getInputLevel={getInputLevel}
              pttKey={pttKey}
              isRetuning={radioState === 'retuning'}
              onConfirmRetune={onConfirmRetune}
              onCancelRetune={onCancelRetune}
            />
          ) : (
            <StandbyView
              missionFrequency={missionFrequency}
              manualFreq={manualFreq}
              setManualFreq={setManualFreq}
              onTuneManual={onTuneManual}
              onTuneMission={onTuneMission}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function PanelHeader({ title, isTuned, onOpenSettings, closeIcon = false, onClose }) {
  const [gearHover, setGearHover] = useState(false);
  return (
    <div style={{
      padding: '10px 16px',
      borderBottom: `1px solid ${PANEL_BORDER}`,
      background: HEADER_BG,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <span style={{
        fontSize: 13,
        color: '#99CCFF',
        letterSpacing: '0.14em',
        fontWeight: 'bold',
      }}>
        {title}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {isTuned && (
          <span style={{
            fontSize: 11,
            color: '#33DDAA',
            fontWeight: 'bold',
            letterSpacing: '0.12em',
          }}>
            ● LIVE
          </span>
        )}
        <button
          onClick={closeIcon ? onClose : onOpenSettings}
          onMouseEnter={() => setGearHover(true)}
          onMouseLeave={() => setGearHover(false)}
          style={{
            fontSize: 24,
            color: gearHover ? '#CCE8FF' : '#66AADD',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            padding: 0,
            lineHeight: 1,
            fontFamily: FONT,
          }}
          aria-label={closeIcon ? 'Close settings' : 'Voice profile settings'}
        >
          {closeIcon ? '✕' : '⚙'}
        </button>
      </div>
    </div>
  );
}

// ─── Standby ────────────────────────────────────────────────────────────────

function StandbyView({ missionFrequency, manualFreq, setManualFreq, onTuneManual, onTuneMission }) {
  return (
    <div style={{ padding: '20px 16px', textAlign: 'center' }}>
      <div style={{
        fontSize: 13,
        color: '#66AADD',
        letterSpacing: '0.1em',
        marginBottom: 14,
        fontWeight: 'bold',
      }}>
        NO FREQUENCY TUNED
      </div>

      {missionFrequency && (
        <>
          <div style={{
            fontSize: 12,
            color: '#FFBB33',
            letterSpacing: '0.08em',
            marginBottom: 8,
            fontWeight: 'bold',
          }}>
            MISSION FREQUENCY AVAILABLE: {missionFrequency} MHz
          </div>
          <button
            onClick={onTuneMission}
            style={{
              border: '2px solid #FFBB33',
              color: '#FFBB33',
              background: PANEL_BG,
              fontSize: 12,
              padding: '8px 16px',
              letterSpacing: '0.1em',
              fontWeight: 'bold',
              cursor: 'pointer',
              marginBottom: 16,
              fontFamily: FONT,
            }}
          >
            TUNE TO MISSION
          </button>
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
        <input
          value={manualFreq}
          onChange={e => setManualFreq(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onTuneManual(); }}
          placeholder="127.4"
          style={{
            width: 100,
            background: PANEL_BG,
            border: '1px solid #4488BB',
            color: '#00EEFF',
            fontFamily: FONT,
            fontSize: 16,
            padding: 8,
            textAlign: 'center',
            fontWeight: 'bold',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <button
          onClick={onTuneManual}
          style={{
            border: '2px solid #66AADD',
            color: '#66AADD',
            background: PANEL_BG,
            fontSize: 12,
            padding: '8px 16px',
            letterSpacing: '0.1em',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontFamily: FONT,
          }}
        >
          TUNE
        </button>
      </div>
    </div>
  );
}

// ─── Tuned ──────────────────────────────────────────────────────────────────

function TunedView({
  frequency, peers, transmittingPeerIds, isPTTActive,
  isMuted, onToggleMute, micSensitivity, onSensitivityChange,
  onDisconnect, onRetune, getInputLevel, pttKey,
  isRetuning, onConfirmRetune, onCancelRetune,
}) {
  const transmittingSet = useMemo(() => new Set(transmittingPeerIds), [transmittingPeerIds]);

  return (
    <>
      {/* Frequency display OR inline retune editor */}
      {isRetuning ? (
        <RetuningEditor
          currentFrequency={frequency}
          onConfirm={onConfirmRetune}
          onCancel={onCancelRetune}
        />
      ) : (
        <div style={{
          padding: 16,
          textAlign: 'center',
          borderBottom: `1px solid ${SOFT_DIVIDER}`,
          background: FREQ_BG,
        }}>
          <div style={{
            fontSize: 32,
            color: '#00EEFF',
            letterSpacing: '0.18em',
            fontWeight: 'bold',
            textShadow: '0 0 12px rgba(0,238,255,0.5)',
          }}>
            {frequency}
          </div>
          <div style={{
            fontSize: 12,
            color: '#66AADD',
            marginTop: 4,
            letterSpacing: '0.12em',
          }}>
            MHz — TUNED
          </div>
        </div>
      )}

      {/* RETUNE / DISCONNECT icons */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 28,
        padding: '10px 16px',
        borderBottom: `1px solid ${SOFT_DIVIDER}`,
      }}>
        <div
          onClick={onRetune}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}
        >
          <span style={{ fontSize: 18, color: '#66AADD' }}>⇄</span>
          <span style={{ fontSize: 9, color: '#66AADD', letterSpacing: '0.1em', fontWeight: 'bold' }}>RETUNE</span>
        </div>
        <div
          onClick={onDisconnect}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}
        >
          <span style={{ fontSize: 18, color: '#FF5544' }}>⏏</span>
          <span style={{ fontSize: 9, color: '#FF5544', letterSpacing: '0.1em', fontWeight: 'bold' }}>DISCONNECT</span>
        </div>
      </div>

      {/* ON FREQUENCY peer list */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${SOFT_DIVIDER}`,
        maxHeight: 140,
        overflowY: 'auto',
      }}>
        <div style={{
          fontSize: 11,
          color: '#99CCFF',
          letterSpacing: '0.12em',
          marginBottom: 8,
          fontWeight: 'bold',
        }}>
          ON FREQUENCY
        </div>
        {peers.length === 0 ? (
          <div style={{ fontSize: 13, color: '#66AADD', letterSpacing: '0.08em' }}>
            — NO OTHER OPERATORS —
          </div>
        ) : (
          peers.map(p => (
            <PeerRow key={p.socketId} peer={p} transmitting={transmittingSet.has(p.socketId)} />
          ))
        )}
      </div>

      {/* Inline MIC status row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        borderBottom: `1px solid ${SOFT_DIVIDER}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: isMuted ? '#FF5544' : '#33DDAA',
          }} />
          <span style={{ fontSize: 11, color: '#99CCFF', fontWeight: 'bold' }}>MIC</span>
          <span style={{
            fontSize: 11,
            color: isMuted ? '#FF5544' : '#33DDAA',
            fontWeight: 'bold',
          }}>
            {isMuted ? 'MUTED' : 'ACTIVE'}
          </span>
        </div>
        <button
          onClick={onToggleMute}
          style={{
            fontSize: 16,
            background: isMuted ? '#FF5544' : 'none',
            border: 'none',
            color: isMuted ? '#fff' : '#66AADD',
            padding: isMuted ? '4px 8px' : 0,
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>

      <MicLevelMeter getLevel={getInputLevel} active />

      {/* MIC VOLUME slider */}
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${SOFT_DIVIDER}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: '#99CCFF', fontWeight: 'bold', letterSpacing: '0.1em' }}>
            MIC VOLUME
          </span>
          <span style={{ fontSize: 12, color: '#00EEFF', fontWeight: 'bold' }}>
            {micSensitivity}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={150}
          step={5}
          value={micSensitivity}
          onChange={e => onSensitivityChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: '#66AADD', height: 6, cursor: 'pointer' }}
        />
      </div>

      {/* PTT button */}
      <div style={{ padding: '14px 16px' }}>
        <button style={{
          width: '100%',
          fontSize: 14,
          padding: '12px 0',
          textAlign: 'center',
          border: `2px solid ${isMuted ? '#1A3D55' : isPTTActive ? '#FF4455' : '#33DDAA'}`,
          color: isMuted ? '#1A3D55' : isPTTActive ? '#FF4455' : '#33DDAA',
          background: isMuted ? '#000' : isPTTActive ? 'rgba(255,68,85,0.12)' : PANEL_BG,
          letterSpacing: '0.12em',
          fontWeight: 'bold',
          cursor: isMuted ? 'not-allowed' : 'pointer',
          fontFamily: FONT,
          userSelect: 'none',
          opacity: isMuted ? 0.4 : 1,
        }}>
          {isMuted
            ? '[ MIC MUTED — UNMUTE TO TRANSMIT ]'
            : isPTTActive
              ? '● TRANSMITTING'
              : `● TRANSMIT (${(pttKey || 'V').toUpperCase()})`
          }
        </button>
      </div>
      <div style={{
        fontSize: 10,
        color: '#66AADD',
        textAlign: 'center',
        padding: '0 16px 14px',
        letterSpacing: '0.08em',
      }}>
        PRESS AND HOLD
      </div>
    </>
  );
}

// Inline frequency editor swapped into the freq display slot while the panel
// is in 'retuning' state. The radio connection stays live throughout — the
// old room is left inside joinFrequency() the moment the operator confirms.
function RetuningEditor({ currentFrequency, onConfirm, onCancel }) {
  const [val, setVal] = useState(currentFrequency ? String(currentFrequency) : '');
  const [err, setErr] = useState('');
  const [focused, setFocused] = useState(false);
  const [hoverConfirm, setHoverConfirm] = useState(false);
  const [hoverCancel, setHoverCancel]   = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    try { el.select(); } catch {}
  }, []);

  const submit = () => {
    const s = (val || '').trim();
    if (!/^\d{3}\.\d$/.test(s)) {
      setErr('INVALID FREQUENCY — USE FORMAT XXX.X');
      return;
    }
    const n = parseFloat(s);
    if (n < 118.0 || n > 136.9) {
      setErr('INVALID FREQUENCY — USE FORMAT XXX.X');
      return;
    }
    setErr('');
    onConfirm(s);
  };

  return (
    <div style={{
      padding: '14px 16px',
      borderBottom: `1px solid ${SOFT_DIVIDER}`,
      background: FREQ_BG,
    }}>
      <div style={{
        fontSize: 10,
        color: '#4488BB',
        letterSpacing: '0.1em',
        marginBottom: 8,
        textAlign: 'center',
      }}>
        ENTER NEW FREQUENCY
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        justifyContent: 'center',
        marginBottom: 10,
      }}>
        <input
          ref={inputRef}
          type="text"
          value={val}
          maxLength={5}
          placeholder="000.0"
          onChange={e => { setVal(e.target.value); if (err) setErr(''); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: 130,
            background: '#000',
            border: `2px solid ${focused ? '#CCE8FF' : '#00EEFF'}`,
            color: '#00EEFF',
            fontFamily: FONT,
            fontSize: 28,
            fontWeight: 'bold',
            textAlign: 'center',
            padding: '6px 8px',
            letterSpacing: '0.1em',
            outline: 'none',
          }}
        />
        <span style={{
          fontSize: 12, color: '#66AADD', letterSpacing: '0.08em',
        }}>MHz</span>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button
          onClick={submit}
          onMouseEnter={() => setHoverConfirm(true)}
          onMouseLeave={() => setHoverConfirm(false)}
          style={{
            fontSize: 11,
            color: hoverConfirm ? '#000' : '#33DDAA',
            border: '1px solid #33DDAA',
            background: hoverConfirm ? '#33DDAA' : '#000',
            padding: '6px 16px',
            letterSpacing: '0.1em',
            fontWeight: 'bold',
            fontFamily: FONT,
            cursor: 'pointer',
          }}
        >[ ✓ TUNE ]</button>
        <button
          onClick={onCancel}
          onMouseEnter={() => setHoverCancel(true)}
          onMouseLeave={() => setHoverCancel(false)}
          style={{
            fontSize: 11,
            color: hoverCancel ? '#000' : '#66AADD',
            border: '1px solid #4488BB',
            background: hoverCancel ? '#4488BB' : '#000',
            padding: '6px 16px',
            letterSpacing: '0.1em',
            fontFamily: FONT,
            cursor: 'pointer',
          }}
        >[ CANCEL ]</button>
      </div>
      {err && (
        <div style={{
          fontSize: 10,
          color: '#FF5544',
          textAlign: 'center',
          marginTop: 8,
          letterSpacing: '0.06em',
        }}>
          {err}
        </div>
      )}
    </div>
  );
}

function PeerRow({ peer, transmitting }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <div style={{
        width: 9, height: 9, borderRadius: '50%',
        background: transmitting ? '#FF4455' : '#2A6A9A',
        boxShadow: transmitting ? '0 0 6px rgba(255,68,85,0.6)' : 'none',
        flexShrink: 0,
      }} />
      <span style={{
        fontSize: 13,
        color: transmitting ? '#CCE8FF' : '#99CCFF',
        fontWeight: transmitting ? 'bold' : 'normal',
      }}>
        {peer.citizenName || 'UNKNOWN'}
      </span>
      {transmitting && <SignalBars />}
    </div>
  );
}

function SignalBars() {
  const [heights, setHeights] = useState([5, 10, 7]);
  useEffect(() => {
    const id = setInterval(() => {
      setHeights([3 + Math.random() * 9, 3 + Math.random() * 9, 3 + Math.random() * 9].map(Math.round));
    }, 110);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ display: 'flex', gap: 2, marginLeft: 'auto', alignItems: 'flex-end' }}>
      {heights.map((h, i) => (
        <div key={i} style={{ width: 3, height: h, background: '#FF4455' }} />
      ))}
    </div>
  );
}

// ─── Mic level meter ────────────────────────────────────────────────────────

function MicLevelMeter({ getLevel, active }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active) { setLevel(0); return; }
    const id = setInterval(() => {
      const v = getLevel ? getLevel() : 0;
      setLevel(Number.isFinite(v) ? v : 0);
    }, 50);
    return () => clearInterval(id);
  }, [getLevel, active]);
  const fillColor = level > 70 ? '#FF4455' : level > 30 ? '#33DDAA' : '#66AADD';
  return (
    <div style={{ padding: '10px 16px', borderBottom: `1px solid ${SOFT_DIVIDER}` }}>
      <div style={{
        fontSize: 11, color: '#99CCFF', letterSpacing: '0.1em', marginBottom: 6, fontWeight: 'bold',
      }}>
        MIC LEVEL
      </div>
      <div style={{
        width: '100%', height: 8, background: PANEL_BG,
        border: `1px solid ${PANEL_BORDER}`, overflow: 'hidden',
      }}>
        <div style={{ height: '100%', width: `${level}%`, background: fillColor, transition: 'width 0.05s' }} />
      </div>
    </div>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────

function SettingsView({ voiceProfile, setVoiceProfile, bumpProfileVersion, onClose, getInputLevel, pttKey, setPttKey }) {
  const [savedAt, setSavedAt]   = useState(0);
  const [saving, setSaving]     = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [remapListening, setRemapListening] = useState(false);
  const isFirstKeydownRef = useRef(false);

  const previewCtxRef       = useRef(null);
  const previewMicRef       = useRef(null);
  const previewSourceRef    = useRef(null);
  const previewChainRef     = useRef(null);
  const previewAnalyserRef  = useRef(null);
  const previewConnectedRef = useRef(false);

  const voiceProfileRef = useRef(voiceProfile);
  useEffect(() => { voiceProfileRef.current = voiceProfile; }, [voiceProfile]);

  const updateField = (field, val) => {
    setVoiceProfile(p => ({ ...(p || {}), [field]: val }));
  };

  // Build preview chain on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        if (cancelled) {
          try { stream.getTracks().forEach(t => t.stop()); } catch {}
          return;
        }
        previewMicRef.current = stream;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        previewCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        previewSourceRef.current = source;
        const chain = await buildSpacesuitChain(ctx, source, voiceProfileRef.current || {});
        if (cancelled) { try { chain.dispose(); } catch {} return; }
        previewChainRef.current = chain;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        previewAnalyserRef.current = analyser;
      } catch (err) {
        console.error('[Radio] preview setup failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      try { previewChainRef.current?.dispose(); } catch {}
      try { previewSourceRef.current?.disconnect(); } catch {}
      try { previewAnalyserRef.current?.disconnect(); } catch {}
      try { previewMicRef.current?.getTracks().forEach(t => t.stop()); } catch {}
      try { previewCtxRef.current?.close(); } catch {}
      previewChainRef.current = null;
      previewSourceRef.current = null;
      previewAnalyserRef.current = null;
      previewMicRef.current = null;
      previewCtxRef.current = null;
      previewConnectedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (previewChainRef.current && voiceProfile) {
      previewChainRef.current.setProfile(voiceProfile);
    }
  }, [voiceProfile]);

  // PTT remap keydown listener — two-phase. Persists the new key to
  // localStorage AND the server (partial voice_profile update) immediately,
  // since the key binding is a control preference the operator should never
  // have to re-set after a browser change.
  useEffect(() => {
    if (!remapListening) return;
    const handler = (e) => {
      e.preventDefault();
      if (isFirstKeydownRef.current) {
        isFirstKeydownRef.current = false;
        return;
      }
      const newKey = e.key;
      setPttKey(newKey);
      try { localStorage.setItem('nexus_ptt_key', newKey); } catch {}
      setRemapListening(false);
      // Best-effort server sync; swallow errors — localStorage already persisted it.
      api.put('/users/voice-profile', { ptt_key: newKey }).catch(() => {});
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [remapListening, setPttKey]);

  const startRemap = () => {
    isFirstKeydownRef.current = true;
    setRemapListening(true);
  };

  const startPreview = useCallback(async () => {
    const ctx = previewCtxRef.current;
    const chain = previewChainRef.current;
    if (!ctx || !chain) return;
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
    if (!previewConnectedRef.current) {
      try { chain.output.connect(ctx.destination); } catch {}
      previewConnectedRef.current = true;
    }
    setPreviewing(true);
  }, []);

  const stopPreview = useCallback(() => {
    const ctx = previewCtxRef.current;
    const chain = previewChainRef.current;
    if (ctx && chain && previewConnectedRef.current) {
      try { chain.output.disconnect(ctx.destination); } catch {}
      previewConnectedRef.current = false;
    }
    setPreviewing(false);
  }, []);

  const getSettingsLevel = useCallback(() => {
    const hookLvl = getInputLevel ? getInputLevel() : 0;
    const a = previewAnalyserRef.current;
    if (!a) return hookLvl;
    const data = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const previewLvl = Math.min(100, (sum / data.length / 255) * 150);
    return Math.max(hookLvl, previewLvl);
  }, [getInputLevel]);

  const onRandomize = () => setVoiceProfile(randomVoiceProfile());

  const onSave = async () => {
    if (!voiceProfile || saving) return;
    setSaving(true);
    try {
      const payload = {};
      for (const f of PROFILE_FIELDS) {
        if (voiceProfile[f] != null) payload[f] = Number(voiceProfile[f]);
      }
      // Include the current PTT key so a manual SAVE PROFILE resynchronizes
      // it even if the immediate-on-remap PUT failed silently.
      if (pttKey) payload.ptt_key = pttKey;
      await api.put('/users/voice-profile', payload);
      bumpProfileVersion();
      setSavedAt(Date.now());
    } catch (err) {
      console.error('[Radio] save profile failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (!savedAt) return;
    setShowSaved(true);
    const id = setTimeout(() => setShowSaved(false), 2000);
    return () => clearTimeout(id);
  }, [savedAt]);

  return (
    <>
      <PanelHeader
        title="VOICE PROFILE SETTINGS"
        closeIcon
        onClose={() => { stopPreview(); onClose(); }}
      />

      <div style={{ padding: 16, maxHeight: 520, overflowY: 'auto' }}>
        {PROFILE_FIELDS.map(field => (
          <SliderRow
            key={field}
            field={field}
            value={voiceProfile?.[field]}
            onChange={(v) => updateField(field, v)}
          />
        ))}

        <button
          onMouseDown={startPreview}
          onMouseUp={stopPreview}
          onMouseLeave={stopPreview}
          onTouchStart={startPreview}
          onTouchEnd={stopPreview}
          style={{
            width: '100%',
            border: '2px solid #4488BB',
            color: '#99CCFF',
            background: previewing ? 'rgba(68,136,187,0.15)' : PANEL_BG,
            fontSize: 12,
            padding: '8px 0',
            letterSpacing: '0.1em',
            fontWeight: 'bold',
            cursor: 'pointer',
            margin: '12px 0',
            fontFamily: FONT,
            userSelect: 'none',
          }}
        >
          {previewing ? '◉ MONITORING' : '▶ PREVIEW VOICE'}
        </button>

        <MicLevelMeterInline getLevel={getSettingsLevel} />

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={onRandomize}
            style={{
              flex: 1, fontSize: 11, padding: '8px 0', textAlign: 'center',
              border: '2px solid #66AADD', color: '#66AADD', background: PANEL_BG,
              letterSpacing: '0.08em', fontWeight: 'bold', cursor: 'pointer', fontFamily: FONT,
            }}
          >
            RANDOMIZE
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              flex: 1, fontSize: 11, padding: '8px 0', textAlign: 'center',
              border: '2px solid #33DDAA', color: '#33DDAA', background: PANEL_BG,
              letterSpacing: '0.08em', fontWeight: 'bold',
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.6 : 1, fontFamily: FONT,
            }}
          >
            {saving ? 'SAVING...' : 'SAVE PROFILE'}
          </button>
        </div>

        {showSaved && (
          <div style={{
            textAlign: 'center', fontSize: 11, color: '#33DDAA',
            letterSpacing: '0.12em', marginTop: 10, fontWeight: 'bold',
          }}>
            ✓ SAVED
          </div>
        )}

        {/* PTT KEY BINDING */}
        <div style={{ marginTop: 20, borderTop: `1px solid ${SOFT_DIVIDER}`, paddingTop: 16 }}>
          <div style={{
            fontSize: 12, color: '#99CCFF', fontWeight: 'bold',
            marginBottom: 8, letterSpacing: '0.1em',
          }}>
            PTT KEY BINDING
          </div>
          <div style={{
            fontSize: 12, color: '#00EEFF', fontWeight: 'bold',
            marginBottom: 6, letterSpacing: '0.08em',
          }}>
            CURRENT KEY: {(pttKey || 'v').toUpperCase()}
          </div>
          <button
            onClick={remapListening ? undefined : startRemap}
            style={{
              border: `1px solid ${remapListening ? '#FFBB33' : '#4488BB'}`,
              color: remapListening ? '#FFBB33' : '#4488BB',
              fontSize: 11,
              padding: '5px 14px',
              cursor: remapListening ? 'default' : 'pointer',
              background: 'none',
              letterSpacing: '0.08em',
              fontFamily: FONT,
            }}
          >
            {remapListening ? 'PRESS ANY KEY...' : '[ REMAP KEY ]'}
          </button>
        </div>
      </div>
    </>
  );
}

function MicLevelMeterInline({ getLevel }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      const v = getLevel ? getLevel() : 0;
      setLevel(Number.isFinite(v) ? v : 0);
    }, 50);
    return () => clearInterval(id);
  }, [getLevel]);
  const fillColor = level > 70 ? '#FF4455' : level > 30 ? '#33DDAA' : '#66AADD';
  return (
    <div>
      <div style={{
        fontSize: 11, color: '#99CCFF', letterSpacing: '0.1em', marginBottom: 6, fontWeight: 'bold',
      }}>
        MIC LEVEL
      </div>
      <div style={{
        width: '100%', height: 8, background: PANEL_BG,
        border: `1px solid ${PANEL_BORDER}`, overflow: 'hidden',
      }}>
        <div style={{ height: '100%', width: `${level}%`, background: fillColor, transition: 'width 0.05s' }} />
      </div>
    </div>
  );
}

function SliderRow({ field, value, onChange }) {
  const range = VOICE_PROFILE_RANGES[field];
  const def = range.default ?? (range.min + range.max) / 2;
  const v = value != null ? Number(value) : def;
  const pct = Math.max(0, Math.min(100, ((v - range.min) / (range.max - range.min)) * 100));

  let formattedValue;
  if (FIELD_DISPLAY[field]) {
    formattedValue = FIELD_DISPLAY[field](v);
  } else {
    let display;
    if (range.step >= 1) display = String(Math.round(v));
    else if (range.step >= 0.1) display = v.toFixed(1);
    else display = v.toFixed(3);
    const unit = FIELD_UNITS[field] ? ` ${FIELD_UNITS[field]}` : '';
    formattedValue = display + unit;
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: '#99CCFF', letterSpacing: '0.1em', fontWeight: 'bold' }}>
          {FIELD_LABELS[field] || field.toUpperCase().replace(/_/g, ' ')}
        </span>
        <span style={{ fontSize: 12, color: '#00EEFF', fontWeight: 'bold' }}>
          {formattedValue}
        </span>
      </div>
      <div style={{
        position: 'relative', width: '100%', height: 6,
        background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`,
      }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#66AADD' }} />
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={v}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            position: 'absolute', top: -9, left: 0,
            width: '100%', height: 24, margin: 0, padding: 0,
            opacity: 0, cursor: 'pointer',
          }}
        />
      </div>
    </div>
  );
}
