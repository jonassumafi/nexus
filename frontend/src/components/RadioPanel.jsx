import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
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

// Every child container is transparent so the texture behind shows through
// the whole panel. Dividers are semi-transparent black — the design calls for
// slightly lighter divisions further down (0.12 / 0.10) but a single value
// simplifies the JSX and matches the reference visually.
const PANEL_BG       = 'transparent';
const HEADER_BG      = 'transparent';
const FREQ_BG        = 'transparent';
const SOFT_DIVIDER   = 'rgba(0,0,0,0.12)';
const PANEL_BORDER   = 'rgba(0,0,0,0.15)';
// Semantic palette from the reference — dark navy for text/primary controls,
// muted navy for secondary text, warm dark green for MIC ACTIVE, dark red for
// DISCONNECT / MUTED / PTT active.
const INK_PRIMARY    = '#061018';
const INK_SECONDARY  = '#1A3A50';
const INK_MUTED      = '#2A5A7A';
const ICON_BLUE      = '#9DC4D8';
const ALARM_RED      = '#CC3322';
const OK_GREEN       = '#1A7A40';
const PILL_BG        = 'rgba(6,16,24,0.70)';

export default function RadioPanel({
  missionFrequency = null,
  missionId = null,
  // Lifted radio state — owned by Dashboard so it survives RadioPanel
  // unmount/remount (e.g. when the user toggles MY SHIPS mode).
  voiceProfile,
  setVoiceProfile,
  profileVersion,       // eslint-disable-line no-unused-vars
  setProfileVersion,
  pttKey,
  setPttKey,
  radioState,
  setRadioState,
  isMuted,
  setIsMuted,
  micSensitivity,
  setMicSensitivity,
  // Lifted WebRTC connection outputs — the hook itself now runs at Dashboard.
  tunedFrequency,
  peers,
  transmittingPeerIds,
  isPTTActive,
  joinFrequency,
  leaveFrequency,
  getInputLevel,
  startPTT,
  stopPTT,
  // Device selection + permission wiring.
  micDeviceId,
  setMicDeviceId,
  outputDeviceId,
  setOutputDeviceId,
  micPermission,
  requestMicPermission,
}) {
  const [manualFreq, setManualFreq] = useState('');


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
  const onRetune       = useCallback(() => setRadioState('retuning'), [setRadioState]);
  const onCancelRetune = useCallback(() => setRadioState('tuned'), [setRadioState]);
  const onConfirmRetune = useCallback(async (newFreq) => {
    // joinFrequency internally emits radio:leave for the current room before
    // joining the new one — awaiting the join before switching UI state
    // avoids the tuned-with-old-freq flash.
    await joinFrequency(newFreq, missionId);
    setRadioState('tuned');
  }, [joinFrequency, missionId, setRadioState]);

  return (
    <div style={{
      position: 'relative',
      zIndex: 9001,
      background: '#7AAAC8',
    }}>
    <div style={{
      margin: '8px 8px 8px 0',
      background: PANEL_BG,
      border: `1px solid ${PANEL_BORDER}`,
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
          micDeviceId={micDeviceId}
          setMicDeviceId={setMicDeviceId}
          outputDeviceId={outputDeviceId}
          setOutputDeviceId={setOutputDeviceId}
        />
      ) : (
        <>
          <PanelHeader
            isTuned={!!tunedFrequency}
            onOpenSettings={() => setRadioState('settings')}
          />
          <MicPermissionBanner
            micPermission={micPermission}
            requestMicPermission={requestMicPermission}
          />
          {tunedFrequency ? (
            <TunedView
              frequency={tunedFrequency}
              peers={peers}
              transmittingPeerIds={transmittingPeerIds}
              isPTTActive={isPTTActive}
              isMuted={isMuted}
              onToggleMute={() => {
                // Sound plays only on the false → true transition (muting).
                // Unmuting is silent. Reading `isMuted` from the closure is
                // safe because a re-render always follows a state flip, so
                // the next click sees the fresh value.
                if (!isMuted) {
                  const muteClick = new Audio('/sounds/mute_mic.mp3');
                  muteClick.play().catch(() => {});
                }
                setIsMuted(m => !m);
              }}
              micSensitivity={micSensitivity}
              onSensitivityChange={setMicSensitivity}
              onDisconnect={onDisconnect}
              onRetune={onRetune}
              getInputLevel={getInputLevel}
              pttKey={pttKey}
              isRetuning={radioState === 'retuning'}
              onConfirmRetune={onConfirmRetune}
              onCancelRetune={onCancelRetune}
              startPTT={startPTT}
              stopPTT={stopPTT}
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
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function PanelHeader({ isTuned, onOpenSettings, closeIcon = false, onClose }) {
  return (
    <div style={{
      padding: '10px 14px',
      borderBottom: `1px solid ${PANEL_BORDER}`,
      background: HEADER_BG,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      {/* Title block — "NEXUS COMM" over "SYSTEM", left-aligned column,
          SYSTEM centered under COMM per the reference. */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <span style={{
          fontSize: 12,
          color: INK_PRIMARY,
          fontWeight: 'bold',
          letterSpacing: '0.1em',
        }}>
          NEXUS COMM
        </span>
        <span style={{
          fontSize: 10,
          color: INK_SECONDARY,
          letterSpacing: '0.08em',
          alignSelf: 'center',
        }}>
          SYSTEM
        </span>
      </div>
      {/* Header-right — LIVE pill + gear pill on the SAME line. flexWrap:
          nowrap and flexShrink: 0 on each pill guarantee they never break. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
        {isTuned && (
          <span style={{
            position: 'relative',
            zIndex: 1,
            background: PILL_BG,
            borderRadius: 3,
            padding: '3px 8px',
            fontSize: 10,
            color: '#33DDAA',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>
            ● LIVE
          </span>
        )}
        <button
          onClick={closeIcon ? onClose : onOpenSettings}
          style={{
            position: 'relative',
            zIndex: 1,
            background: PILL_BG,
            borderRadius: 3,
            padding: '4px 8px',
            fontSize: 20,
            color: ICON_BLUE,
            cursor: 'pointer',
            border: 'none',
            lineHeight: 1,
            fontFamily: FONT,
            flexShrink: 0,
          }}
          aria-label={closeIcon ? 'Close settings' : 'Voice profile settings'}
        >
          {closeIcon ? '✕' : '⚙'}
        </button>
      </div>
    </div>
  );
}

// ─── Mic permission banner ─────────────────────────────────────────────────
// Renders a strip below the header whenever the browser hasn't granted mic
// access yet. Two states we care about:
//   `prompt`  — user hasn't answered the browser popup (or missed it entirely)
//   `denied`  — user or a site-level block refused mic access
// `granted` and `unknown` (Safari, no Permissions API) both render nothing —
// the panel stays clean.
function MicPermissionBanner({ micPermission, requestMicPermission }) {
  const [requesting, setRequesting] = useState(false);
  if (micPermission !== 'prompt' && micPermission !== 'denied') return null;

  const isDenied = micPermission === 'denied';
  return (
    <div style={{
      padding: '10px 14px',
      borderBottom: `1px solid ${SOFT_DIVIDER}`,
      background: 'rgba(204,51,34,0.15)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{
        fontSize: 10, color: INK_PRIMARY, fontWeight: 'bold',
        letterSpacing: '0.06em',
      }}>
        {isDenied
          ? '⛔ MIC ACCESS BLOCKED'
          : '⚠ MIC NOT YET AUTHORIZED'}
      </div>
      <div style={{ fontSize: 10, color: INK_SECONDARY, lineHeight: 1.4 }}>
        {isDenied
          ? 'Your browser is blocking mic access for this site. Click the lock/mic icon in the address bar to re-enable, then reload.'
          : 'The browser needs your permission to transmit. Click below to grant access.'}
      </div>
      {!isDenied && (
        <button
          onClick={async () => {
            if (requesting) return;
            setRequesting(true);
            try { await requestMicPermission?.(); }
            finally { setRequesting(false); }
          }}
          style={{
            position: 'relative', zIndex: 1,
            marginTop: 2,
            width: '100%',
            padding: '6px 0',
            fontSize: 11,
            fontWeight: 'bold',
            fontFamily: FONT,
            color: '#EEF4F8',
            background: INK_PRIMARY,
            border: 'none',
            cursor: requesting ? 'wait' : 'pointer',
            letterSpacing: '0.1em',
            opacity: requesting ? 0.7 : 1,
          }}
        >
          {requesting ? 'REQUESTING...' : 'GRANT MIC ACCESS'}
        </button>
      )}
    </div>
  );
}

// ─── Standby ────────────────────────────────────────────────────────────────

function StandbyView({ missionFrequency, manualFreq, setManualFreq, onTuneManual, onTuneMission }) {
  return (
    <div style={{ padding: '20px 16px', textAlign: 'center' }}>
      <div style={{
        fontSize: 12,
        color: INK_PRIMARY,
        letterSpacing: '0.1em',
        marginBottom: 16,
        fontWeight: 'bold',
      }}>
        NO FREQUENCY TUNED
      </div>

      {missionFrequency && (
        <>
          <div style={{
            fontSize: 11,
            color: '#5A3A00',
            marginBottom: 8,
            fontWeight: 'bold',
          }}>
            MISSION FREQUENCY: {missionFrequency} MHz
          </div>
          <button
            onClick={onTuneMission}
            style={{
              position: 'relative',
              zIndex: 1,
              width: '100%',
              border: '2px solid #5A3A00',
              color: '#5A3A00',
              background: 'rgba(90,58,0,0.12)',
              fontSize: 11,
              padding: '7px 0',
              letterSpacing: '0.08em',
              fontWeight: 'bold',
              cursor: 'pointer',
              marginBottom: 14,
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
            position: 'relative',
            zIndex: 1,
            width: 120,
            background: '#EEF4F8',
            border: `1px solid ${INK_MUTED}`,
            color: INK_PRIMARY,
            fontFamily: FONT,
            fontSize: 18,
            fontWeight: 'bold',
            padding: '6px 8px',
            textAlign: 'center',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <button
          onClick={onTuneManual}
          style={{
            position: 'relative',
            zIndex: 1,
            border: 'none',
            color: '#EEF4F8',
            background: INK_PRIMARY,
            fontSize: 12,
            padding: '6px 16px',
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
  startPTT, stopPTT,
}) {
  // Mouse and touch PTT handlers dispatch to the same hook functions as the
  // V key binding — no duplicate logic. isPTTActive is driven by startPTT /
  // stopPTT internally, so the button's active state is identical whether
  // the operator holds the key or the button.
  const onTransmitDown = useCallback(() => {
    if (isMuted) return;
    startPTT?.();
  }, [isMuted, startPTT]);
  const onTransmitUp = useCallback(() => {
    stopPTT?.();
  }, [stopPTT]);
  const onTouchStart = useCallback((e) => {
    e.preventDefault();
    if (isMuted) return;
    startPTT?.();
  }, [isMuted, startPTT]);
  const onTouchEnd = useCallback((e) => {
    e.preventDefault();
    stopPTT?.();
  }, [stopPTT]);
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
          borderBottom: `1px solid ${PANEL_BORDER}`,
          background: FREQ_BG,
        }}>
          <div style={{
            fontSize: 36,
            color: INK_PRIMARY,
            letterSpacing: '0.1em',
            fontWeight: 'bold',
          }}>
            {frequency}
          </div>
          <div style={{
            fontSize: 11,
            color: INK_SECONDARY,
            marginTop: 2,
          }}>
            MHz — TUNED
          </div>
        </div>
      )}

      {/* RETUNE / DISCONNECT action pills. Same pill background + border-
          radius as the header gear pill (per reference). 22px icons, 9px
          labels, per-role blue/red coloring. */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 16,
        padding: '12px 16px',
        borderBottom: `1px solid ${SOFT_DIVIDER}`,
      }}>
        <div
          onClick={onRetune}
          style={{
            position: 'relative', zIndex: 1,
            background: PILL_BG, borderRadius: 4,
            padding: '6px 18px', minWidth: 80,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 22, color: ICON_BLUE }}>⇄</span>
          <span style={{ fontSize: 9, color: ICON_BLUE, letterSpacing: '0.1em', fontWeight: 'bold' }}>RETUNE</span>
        </div>
        <div
          onClick={onDisconnect}
          style={{
            position: 'relative', zIndex: 1,
            background: PILL_BG, borderRadius: 4,
            padding: '6px 18px', minWidth: 80,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 22, color: ALARM_RED }}>⏏</span>
          <span style={{ fontSize: 9, color: ALARM_RED, letterSpacing: '0.1em', fontWeight: 'bold' }}>DISCONNECT</span>
        </div>
      </div>

      {/* ON FREQUENCY peer list */}
      <div style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${SOFT_DIVIDER}`,
        maxHeight: 140,
        overflowY: 'auto',
      }}>
        <div style={{
          fontSize: 10,
          color: INK_PRIMARY,
          letterSpacing: '0.1em',
          marginBottom: 4,
          fontWeight: 'bold',
        }}>
          ON FREQUENCY
        </div>
        {peers.length === 0 ? (
          <div style={{ fontSize: 10, color: INK_SECONDARY }}>
            — NO OTHER OPERATORS —
          </div>
        ) : (
          peers.map(p => (
            <PeerRow key={p.socketId} peer={p} transmitting={transmittingSet.has(p.socketId)} />
          ))
        )}
      </div>

      {/* MIC status row — dot/label/status all in one strip */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 14px',
        borderBottom: `1px solid ${SOFT_DIVIDER}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: isMuted ? ALARM_RED : OK_GREEN,
          }} />
          <span style={{ fontSize: 10, color: INK_PRIMARY, fontWeight: 'bold' }}>MIC</span>
          <span style={{
            fontSize: 10,
            color: isMuted ? ALARM_RED : OK_GREEN,
            fontWeight: 'bold',
          }}>
            {isMuted ? 'MUTED' : 'ACTIVE'}
          </span>
        </div>
        <button
          onClick={onToggleMute}
          style={{
            position: 'relative',
            zIndex: 1,
            fontSize: 18,
            background: isMuted ? 'rgba(204,51,34,0.8)' : 'none',
            border: 'none',
            padding: isMuted ? '2px 6px' : '2px 4px',
            cursor: 'pointer',
            lineHeight: 1,
            borderRadius: isMuted ? 3 : 0,
          }}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>

      <MicLevelMeter getLevel={getInputLevel} active />

      {/* MIC VOLUME slider */}
      <div style={{ padding: '8px 14px', borderBottom: `1px solid ${SOFT_DIVIDER}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: INK_PRIMARY, fontWeight: 'bold' }}>
            MIC VOLUME
          </span>
          <span style={{ fontSize: 10, color: INK_PRIMARY, fontWeight: 'bold' }}>
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
          style={{ position: 'relative', zIndex: 1, width: '100%', accentColor: INK_PRIMARY, height: 6, cursor: 'pointer' }}
        />
      </div>

      {/* PTT button — dark navy default, alarm-red when active */}
      <div style={{ padding: '12px 14px' }}>
        <button
          onMouseDown={onTransmitDown}
          onMouseUp={onTransmitUp}
          onMouseLeave={onTransmitUp}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          style={{
            position: 'relative',
            zIndex: 1,
            width: '100%',
            fontSize: 14,
            padding: '12px 0',
            textAlign: 'center',
            border: `2px solid ${isPTTActive ? ALARM_RED : INK_PRIMARY}`,
            color: isPTTActive ? ALARM_RED : ICON_BLUE,
            background: isPTTActive ? 'rgba(204,51,34,0.15)' : 'rgba(6,16,24,0.85)',
            letterSpacing: '0.12em',
            fontWeight: 'bold',
            cursor: isMuted ? 'not-allowed' : 'pointer',
            fontFamily: FONT,
            userSelect: 'none',
            opacity: isMuted ? 0.4 : 1,
          }}
        >
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
        color: INK_PRIMARY,
        fontWeight: 'bold',
        textAlign: 'center',
        padding: '0 14px 12px',
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
      borderBottom: `1px solid ${PANEL_BORDER}`,
      background: FREQ_BG,
    }}>
      <div style={{
        fontSize: 10,
        color: INK_SECONDARY,
        letterSpacing: '0.1em',
        marginBottom: 8,
        textAlign: 'center',
        fontWeight: 'bold',
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
            position: 'relative', zIndex: 1,
            width: 130,
            background: '#EEF4F8',
            border: `1px solid ${focused ? INK_PRIMARY : INK_MUTED}`,
            color: INK_PRIMARY,
            fontFamily: FONT,
            fontSize: 24,
            fontWeight: 'bold',
            textAlign: 'center',
            padding: '6px 8px',
            letterSpacing: '0.1em',
            outline: 'none',
          }}
        />
        <span style={{
          fontSize: 11, color: INK_SECONDARY, fontWeight: 'bold',
        }}>MHz</span>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button
          onClick={submit}
          onMouseEnter={() => setHoverConfirm(true)}
          onMouseLeave={() => setHoverConfirm(false)}
          style={{
            position: 'relative', zIndex: 1,
            fontSize: 11,
            color: '#EEF4F8',
            border: 'none',
            background: hoverConfirm ? OK_GREEN : INK_PRIMARY,
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
            position: 'relative', zIndex: 1,
            fontSize: 11,
            color: hoverCancel ? '#EEF4F8' : INK_PRIMARY,
            border: `1px solid ${INK_PRIMARY}`,
            background: hoverCancel ? INK_PRIMARY : 'transparent',
            padding: '6px 16px',
            letterSpacing: '0.1em',
            fontWeight: 'bold',
            fontFamily: FONT,
            cursor: 'pointer',
          }}
        >[ CANCEL ]</button>
      </div>
      {err && (
        <div style={{
          fontSize: 10,
          color: ALARM_RED,
          textAlign: 'center',
          marginTop: 8,
          fontWeight: 'bold',
        }}>
          {err}
        </div>
      )}
    </div>
  );
}

function PeerRow({ peer, transmitting }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <div style={{
        width: 7, height: 7, borderRadius: '50%',
        background: transmitting ? ALARM_RED : INK_SECONDARY,
        flexShrink: 0,
      }} />
      <span style={{
        fontSize: 11,
        color: transmitting ? INK_PRIMARY : INK_MUTED,
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
  const fillColor = level > 70 ? ALARM_RED : OK_GREEN;
  return (
    <div style={{ padding: '8px 14px', borderBottom: `1px solid ${SOFT_DIVIDER}` }}>
      <div style={{
        fontSize: 10, color: INK_PRIMARY, marginBottom: 4, fontWeight: 'bold',
      }}>
        MIC LEVEL
      </div>
      <div style={{
        width: '100%', height: 6, background: 'rgba(0,0,0,0.2)',
        borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{ height: '100%', width: `${level}%`, background: fillColor, borderRadius: 2, transition: 'width 0.05s' }} />
      </div>
    </div>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────

function SettingsView({
  voiceProfile, setVoiceProfile, bumpProfileVersion, onClose, getInputLevel,
  pttKey, setPttKey,
  micDeviceId, setMicDeviceId, outputDeviceId, setOutputDeviceId,
}) {
  // Device enumeration — labels are only populated after mic permission has
  // been granted for this origin. Since the preview chain below calls
  // getUserMedia on mount, by the time this useEffect resolves we usually
  // have real names. Re-enumerate on `devicechange` so hot-plugging a
  // headset shows up without reopening Settings.
  const [inputDevices, setInputDevices]   = useState([]);
  const [outputDevices, setOutputDevices] = useState([]);
  const outputSupported = typeof HTMLMediaElement !== 'undefined' &&
                         typeof HTMLMediaElement.prototype.setSinkId === 'function';

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const enumerate = () => {
      navigator.mediaDevices.enumerateDevices().then((devs) => {
        setInputDevices(devs.filter(d => d.kind === 'audioinput'));
        setOutputDevices(devs.filter(d => d.kind === 'audiooutput'));
      }).catch(() => {});
    };
    enumerate();
    navigator.mediaDevices.addEventListener?.('devicechange', enumerate);
    return () => {
      navigator.mediaDevices.removeEventListener?.('devicechange', enumerate);
    };
  }, []);

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
            border: '2px solid #2A5A7A',
            color: '#0D1A24',
            background: previewing ? 'rgba(0,0,0,0.1)' : PANEL_BG,
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
              border: '2px solid #2A5A7A', color: '#2A5A7A', background: PANEL_BG,
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

        {/* DEVICE PICKERS — input mic and output speaker/headphones. Both
            default to system default (null value); persisted at Dashboard
            level via localStorage so the choice survives page reloads. */}
        <div style={{ marginTop: 20, borderTop: `1px solid ${SOFT_DIVIDER}`, paddingTop: 16 }}>
          <div style={{
            fontSize: 10, color: '#0D1A24', fontWeight: 'bold',
            marginBottom: 8, letterSpacing: '0.1em',
          }}>
            INPUT DEVICE
          </div>
          <select
            value={micDeviceId ?? '__default__'}
            onChange={e => setMicDeviceId?.(e.target.value === '__default__' ? null : e.target.value)}
            style={{
              position: 'relative', zIndex: 1,
              width: '100%',
              background: 'rgba(255,255,255,0.85)',
              color: '#061018',
              border: '1px solid #2A5A7A',
              fontSize: 11, fontFamily: FONT,
              padding: '5px 8px',
              outline: 'none',
            }}
          >
            <option value="__default__">System Default</option>
            {inputDevices.map((d, i) => (
              <option key={d.deviceId || `in-${i}`} value={d.deviceId}>
                {d.label || `Input ${i + 1}`}
              </option>
            ))}
          </select>

          <div style={{
            fontSize: 10, color: '#0D1A24', fontWeight: 'bold',
            margin: '12px 0 8px', letterSpacing: '0.1em',
          }}>
            OUTPUT DEVICE
          </div>
          <select
            value={outputDeviceId ?? '__default__'}
            onChange={e => setOutputDeviceId?.(e.target.value === '__default__' ? null : e.target.value)}
            disabled={!outputSupported}
            style={{
              position: 'relative', zIndex: 1,
              width: '100%',
              background: outputSupported ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)',
              color: '#061018',
              border: '1px solid #2A5A7A',
              fontSize: 11, fontFamily: FONT,
              padding: '5px 8px',
              outline: 'none',
              cursor: outputSupported ? 'pointer' : 'not-allowed',
            }}
          >
            <option value="__default__">System Default</option>
            {outputDevices.map((d, i) => (
              <option key={d.deviceId || `out-${i}`} value={d.deviceId}>
                {d.label || `Output ${i + 1}`}
              </option>
            ))}
          </select>
          {!outputSupported && (
            <div style={{
              fontSize: 9, color: '#CC3322', marginTop: 4, letterSpacing: '0.04em',
            }}>
              This browser doesn't support output device selection — audio uses the OS default.
            </div>
          )}
        </div>

        {/* PTT KEY BINDING */}
        <div style={{ marginTop: 20, borderTop: `1px solid ${SOFT_DIVIDER}`, paddingTop: 16 }}>
          <div style={{
            fontSize: 12, color: '#0D1A24', fontWeight: 'bold',
            marginBottom: 8, letterSpacing: '0.1em',
          }}>
            PTT KEY BINDING
          </div>
          <div style={{
            fontSize: 12, color: '#061018', fontWeight: 'bold',
            marginBottom: 6, letterSpacing: '0.08em',
          }}>
            CURRENT KEY: {(pttKey || 'v').toUpperCase()}
          </div>
          <button
            onClick={remapListening ? undefined : startRemap}
            style={{
              border: `1px solid ${remapListening ? '#FFBB33' : '#2A5A7A'}`,
              color: remapListening ? '#FFBB33' : '#2A5A7A',
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
  const fillColor = level > 70 ? '#FF4455' : level > 30 ? '#33DDAA' : '#2A5A7A';
  return (
    <div>
      <div style={{
        fontSize: 11, color: '#0D1A24', letterSpacing: '0.1em', marginBottom: 6, fontWeight: 'bold',
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
        <span style={{ fontSize: 12, color: '#0D1A24', letterSpacing: '0.1em', fontWeight: 'bold' }}>
          {FIELD_LABELS[field] || field.toUpperCase().replace(/_/g, ' ')}
        </span>
        <span style={{ fontSize: 12, color: '#061018', fontWeight: 'bold' }}>
          {formattedValue}
        </span>
      </div>
      <div style={{
        position: 'relative', width: '100%', height: 6,
        background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`,
      }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#2A5A7A' }} />
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
