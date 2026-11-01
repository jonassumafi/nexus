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

const FONT = "'Inter', system-ui, sans-serif";

const TUNE_CLIPS = ['tune_1','tune_2','tune_3','tune_4','tune_5','tune_6'];
const playTuneClick = () => {
  const pick = TUNE_CLIPS[Math.floor(Math.random() * TUNE_CLIPS.length)];
  new Audio(`/sounds/${pick}.mp3`).play().catch(() => {});
};

// Tiny helper: tag the next successful save on a `.btn.go` so the CSS
// pulse animation fires. Called by SettingsView's onSave on success.
function pulseSaveBtn(btnEl) {
  if (!btnEl) return;
  btnEl.classList.remove('saved');
  requestAnimationFrame(() => btnEl.classList.add('saved'));
  setTimeout(() => btnEl.classList.remove('saved'), 2850);
}

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
  const [manualErr, setManualErr] = useState('');

  const onTuneManual = useCallback(() => {
    const f = manualFreq.trim();
    if (!f) return;
    if (!/^\d{2,3}\.\d$/.test(f)) {
      setManualErr('VALID RANGE: 50.0 — 350.0 MHz');
      return;
    }
    const n = parseFloat(f);
    if (n < 50.0 || n > 350.0) {
      setManualErr('VALID RANGE: 50.0 — 350.0 MHz');
      return;
    }
    setManualErr('');
    joinFrequency(f, missionId);
    new Audio('/sounds/connect_mic_cut.mp3').play().catch(() => {});
    setManualFreq('');
  }, [manualFreq, joinFrequency, missionId]);

  const onTuneMission = useCallback(() => {
    if (!missionFrequency) return;
    joinFrequency(String(missionFrequency), missionId);
    new Audio('/sounds/connect_mic_cut.mp3').play().catch(() => {});
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
    new Audio('/sounds/connect_mic_cut.mp3').play().catch(() => {});
    setRadioState('tuned');
  }, [joinFrequency, missionId, setRadioState]);

  return (
    <div style={{
      position: 'relative',
      zIndex: 9001,
      flexShrink: 0,
      background: 'var(--bg0)',
      borderTop: '1px solid var(--rim0)',
    }}>
    <div style={{
      background: 'linear-gradient(180deg, var(--bg2), var(--bg1))',
      fontFamily: 'var(--font)',
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
                if (!isMuted) {
                  const muteClick = new Audio('/sounds/mute_mic.mp3');
                  muteClick.play().catch(() => {});
                } else {
                  const unmuteClick = new Audio('/sounds/unmute_mic.mp3');
                  unmuteClick.play().catch(() => {});
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
              setManualFreq={(v) => { setManualFreq(v); setManualErr(''); }}
              onTuneManual={onTuneManual}
              onTuneMission={onTuneMission}
              tuneErr={manualErr}
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
    <div className="sh" style={{ padding: '8px 12px' }}>
      <span style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.1em',
        color: 'var(--cyan)',
        textTransform: 'uppercase',
      }}>
        {isTuned && <i className="live-dot" />}
        Radio
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {isTuned && (
          <span className="badge b-lime" style={{ fontSize: 10 }}>Live</span>
        )}
        <button
          className="ibtn"
          onClick={closeIcon ? onClose : onOpenSettings}
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

function StandbyView({ missionFrequency, manualFreq, setManualFreq, onTuneManual, onTuneMission, tuneErr }) {
  return (
    <div style={{ padding: '14px 14px 12px' }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.1em',
        color: 'var(--fg3)',
        textTransform: 'uppercase',
        marginBottom: 10,
        textAlign: 'center',
      }}>
        No frequency tuned
      </div>

      {missionFrequency && (
        <>
          <div style={{
            fontSize: 11, color: 'var(--amber)', textAlign: 'center',
            marginBottom: 6, fontWeight: 600, letterSpacing: '0.03em',
          }}>
            Mission frequency: {missionFrequency} MHz
          </div>
          <button
            className="btn amb"
            onClick={onTuneMission}
            style={{ width: '100%', fontSize: 12, padding: '7px 0', marginBottom: 12 }}
          >
            Tune to mission
          </button>
        </>
      )}

      {/* Manual freq input with an inset TUNE button on the right edge,
          mirroring the Companion / Radio-only pattern so all three views
          finalize tuning the same way. */}
      <div style={{ position: 'relative', display: 'flex' }}>
        <input
          className="inp"
          value={manualFreq}
          onChange={e => {
            playTuneClick();
            setManualFreq(e.target.value);
          }}
          onKeyDown={e => { if (e.key === 'Enter') onTuneManual(); }}
          placeholder="127.4"
          style={{
            flex: 1,
            fontSize: 15,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'center',
            padding: '7px 72px 7px 10px', // reserve space for inset TUNE
          }}
        />
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); onTuneManual(); }}
          title="Finalize tuning"
          style={{
            position: 'absolute',
            right: 4, top: 4, bottom: 4,
            padding: '0 12px',
            borderRadius: 3,
            border: '1px solid rgba(102,170,221,.35)',
            background: 'linear-gradient(180deg, rgba(14,42,68,.9), rgba(10,26,43,.9))',
            color: 'var(--cyan)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.14em',
            cursor: 'pointer',
            textShadow: '0 0 6px color-mix(in srgb, var(--cyan) 55%, transparent)',
          }}
        >
          TUNE
        </button>
      </div>
      <div style={{
        fontSize: 10, color: 'var(--fg3)', textAlign: 'center',
        marginTop: 8, letterSpacing: '0.06em',
      }}>
        Tunable range: 50.0 — 350.0 MHz
      </div>
      {tuneErr && (
        <div className="err" style={{ textAlign: 'center', marginTop: 4 }}>
          {tuneErr}
        </div>
      )}
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
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderBottom: '1px solid rgba(26,58,80,.4)',
        }}>
          <div className={`lcd${isPTTActive ? ' tx' : ''}`} style={{ flex: 1, textAlign: 'center', fontSize: 22 }}>
            {frequency}
          </div>
          <span className="ptt">
            PTT <kbd>{(pttKey || 'V').toUpperCase()}</kbd>
          </span>
        </div>
      )}

      {/* RETUNE / DISCONNECT */}
      <div style={{
        display: 'flex',
        gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid rgba(26,58,80,.4)',
      }}>
        <button
          className="btn"
          onClick={onRetune}
          style={{ flex: 1, fontSize: 12, padding: '7px 10px' }}
        >
          ⇄ Retune
        </button>
        <button
          className="btn warn"
          onClick={onDisconnect}
          style={{ flex: 1, fontSize: 12, padding: '7px 10px' }}
        >
          ⏏ Disconnect
        </button>
      </div>

      {/* ON FREQUENCY peer list */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(26,58,80,.4)',
        maxHeight: 160,
        overflowY: 'auto',
      }}>
        <div className="h3" style={{ margin: '0 0 8px' }}>
          On frequency
        </div>
        {peers.length === 0 ? (
          <div className="empty" style={{ padding: '6px 0', fontSize: 11 }}>
            No other operators
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {peers.map(p => (
              <PeerRow key={p.socketId} peer={p} transmitting={transmittingSet.has(p.socketId)} />
            ))}
          </div>
        )}
      </div>

      {/* MIC status row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 14px',
        borderBottom: '1px solid rgba(26,58,80,.4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: isMuted ? 'var(--red)' : 'var(--lime)',
            boxShadow: `0 0 6px ${isMuted ? 'var(--red)' : 'var(--lime)'}`,
          }} />
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'var(--fg2)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>Mic</span>
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: isMuted ? 'var(--red)' : 'var(--lime)',
            letterSpacing: '0.03em',
          }}>
            {isMuted ? 'Muted' : 'Active'}
          </span>
        </div>
        <button
          className="ibtn"
          onClick={onToggleMute}
          aria-label={isMuted ? 'Unmute mic' : 'Mute mic'}
          style={isMuted ? { background: 'linear-gradient(180deg, #a8321f, #5e150b)', borderColor: 'var(--red)' } : {}}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>

      <MicLevelMeter getLevel={getInputLevel} active />

      {/* MIC VOLUME slider */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(26,58,80,.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'var(--fg2)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>Mic volume</span>
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'var(--fg0)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {Math.min(100, micSensitivity)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.min(100, micSensitivity)}
          onChange={e => onSensitivityChange(Number(e.target.value))}
          style={{
            width: '100%', accentColor: 'var(--rim2)',
            height: 6, cursor: 'pointer',
          }}
        />
      </div>

      {/* PTT button */}
      <div style={{ padding: '12px 14px 8px' }}>
        <button
          className={`btn${isPTTActive ? ' tx on' : ''}`}
          onMouseDown={onTransmitDown}
          onMouseUp={onTransmitUp}
          onMouseLeave={onTransmitUp}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          disabled={isMuted}
          style={{
            width: '100%',
            fontSize: 13,
            padding: '12px 0',
            letterSpacing: '0.08em',
            userSelect: 'none',
          }}
        >
          {isMuted
            ? '● Mic muted'
            : isPTTActive
              ? '● Transmitting'
              : <>● Transmit <kbd style={{ marginLeft: 6 }}>{(pttKey || 'V').toUpperCase()}</kbd></>
          }
        </button>
      </div>
      <div style={{
        fontSize: 10, fontWeight: 600, color: 'var(--fg3)',
        textAlign: 'center',
        padding: '0 14px 12px',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        Press and hold
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
    if (!/^\d{2,3}\.\d$/.test(s)) {
      setErr('VALID RANGE: 50.0 — 350.0 MHz');
      return;
    }
    const n = parseFloat(s);
    if (n < 50.0 || n > 350.0) {
      setErr('VALID RANGE: 50.0 — 350.0 MHz');
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
          placeholder="127.4"
          onChange={e => { playTuneClick(); setVal(e.target.value); if (err) setErr(''); }}
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
          color: '#FF5544',
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
  const initials = (peer.citizenName || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className={`peer${transmitting ? ' speak' : ''}`}>
      <div className="av">{initials}</div>
      <span className="nm0">{peer.citizenName || 'Unknown'}</span>
      <div className="eq"><i /><i /><i /></div>
    </div>
  );
}

// Legacy SignalBars component — kept exported in case anything imports it,
// though PeerRow now uses the shared .eq animation.
function SignalBars() { return null; }

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

      <div style={{ padding: 14, maxHeight: 520, overflowY: 'auto' }}>
        {PROFILE_FIELDS.map(field => (
          <SliderRow
            key={field}
            field={field}
            value={voiceProfile?.[field]}
            onChange={(v) => updateField(field, v)}
          />
        ))}

        <button
          className="btn"
          onMouseDown={startPreview}
          onMouseUp={stopPreview}
          onMouseLeave={stopPreview}
          onTouchStart={startPreview}
          onTouchEnd={stopPreview}
          style={{
            width: '100%',
            fontSize: 12,
            padding: '9px 0',
            margin: '12px 0',
            userSelect: 'none',
            ...(previewing ? {
              color: 'var(--cyan)',
              borderColor: 'var(--cyan)',
              background: 'linear-gradient(180deg, rgba(0,238,255,.14), rgba(0,238,255,.04))',
            } : {}),
          }}
        >
          {previewing ? '◉ Monitoring' : '▶ Preview voice'}
        </button>

        <MicLevelMeterInline getLevel={getSettingsLevel} />

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            className="btn"
            onClick={onRandomize}
            style={{ flex: 1, fontSize: 12, padding: '8px 0' }}
          >
            Randomize
          </button>
          <button
            className="btn go"
            onClick={async (e) => {
              const btn = e.currentTarget;
              const ok = await onSave();
              if (ok !== false) pulseSaveBtn(btn);
            }}
            disabled={saving}
            style={{ flex: 1, fontSize: 12, padding: '8px 0' }}
          >
            {saving ? <><span className="spinner" />Saving…</> : 'Save profile'}
          </button>
        </div>

        {showSaved && (
          <div style={{
            textAlign: 'center', fontSize: 11, color: 'var(--lime)',
            letterSpacing: '0.1em', marginTop: 10, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <span className="live-dot" style={{ animation: 'none' }} />
            Saved
          </div>
        )}

        {/* DEVICE PICKERS */}
        <div style={{ marginTop: 20, borderTop: '1px solid var(--rim0)', paddingTop: 16 }}>
          <div className="h3" style={{ margin: '0 0 6px' }}>Input device</div>
          <select
            className="inp"
            value={micDeviceId ?? '__default__'}
            onChange={e => setMicDeviceId?.(e.target.value === '__default__' ? null : e.target.value)}
            style={{ fontSize: 12, padding: '7px 10px', cursor: 'pointer' }}
          >
            <option value="__default__">System default</option>
            {inputDevices.map((d, i) => (
              <option key={d.deviceId || `in-${i}`} value={d.deviceId}>
                {d.label || `Input ${i + 1}`}
              </option>
            ))}
          </select>

          <div className="h3" style={{ margin: '14px 0 6px' }}>Output device</div>
          <select
            className="inp"
            value={outputDeviceId ?? '__default__'}
            onChange={e => setOutputDeviceId?.(e.target.value === '__default__' ? null : e.target.value)}
            disabled={!outputSupported}
            style={{ fontSize: 12, padding: '7px 10px', cursor: outputSupported ? 'pointer' : 'not-allowed', opacity: outputSupported ? 1 : 0.6 }}
          >
            <option value="__default__">System default</option>
            {outputDevices.map((d, i) => (
              <option key={d.deviceId || `out-${i}`} value={d.deviceId}>
                {d.label || `Output ${i + 1}`}
              </option>
            ))}
          </select>
          {!outputSupported && (
            <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6, lineHeight: 1.5 }}>
              This browser doesn't support output device selection — audio uses the OS default.
            </div>
          )}
        </div>

        {/* PTT KEY BINDING */}
        <div style={{ marginTop: 20, borderTop: '1px solid var(--rim0)', paddingTop: 16 }}>
          <div className="h3" style={{ margin: '0 0 6px' }}>PTT key binding</div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
          }}>
            <span style={{
              fontSize: 11, fontWeight: 600, color: 'var(--fg2)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>Current key</span>
            <kbd>{(pttKey || 'v').toUpperCase()}</kbd>
          </div>
          <button
            className={`btn ${remapListening ? 'amb' : ''}`.trim()}
            onClick={remapListening ? undefined : startRemap}
            disabled={remapListening}
            style={{ fontSize: 11, padding: '7px 14px' }}
          >
            {remapListening ? 'Press any key…' : 'Remap key'}
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
  const fillColor = level > 70 ? '#FF4455' : level > 30 ? '#44FF88' : '#2A5A7A';
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
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: 'var(--fg2)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          {FIELD_LABELS[field] || field.toUpperCase().replace(/_/g, ' ')}
        </span>
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'var(--fg0)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {formattedValue}
        </span>
      </div>
      <div style={{
        position: 'relative', width: '100%', height: 6,
        background: '#02080e',
        border: '1px solid var(--rim0)',
        borderRadius: 3,
        boxShadow: '0 1px 3px #000 inset',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: 'linear-gradient(90deg, var(--rim2), var(--blue))',
          transition: 'width .1s',
        }} />
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
