// Command tuner card — matches the primary radio's visual language.
// Uses FreqTuneInput for consistent LCD-styled frequency entry with the
// per-keystroke tune clicks, plays the same connect/disconnect sounds as
// the primary radio, and overlays a SELCAL chord as its unique transmit
// self-cue.
//
// Added in Stage 3b polish:
//   • Lock button — when locked, frequency / label / untune can't change
//   • Editable role label (double-click to rename)
//   • Duplicate PTT binding rejection (otherPttKey prop → error chip)
//   • Flex layout prevents Untune from clipping at small widths

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCommandTunerRx } from '../hooks/useCommandTunerRx';
import useMyRadio from '../hooks/useMyRadio';
import FreqTuneInput from './FreqTuneInput';
import { playTune } from '../utils/audioFx';
import api from '../services/api';
import RadioPickerModal from './RadioPickerModal';

const LABEL_LS_KEY   = 'nexus_command_label';
const LOCK_LS_KEY    = 'nexus_command_locked';
const DISABLE_LS_KEY = 'nexus_command_disabled';

// Outer wrapper: checks the disable flag BEFORE calling any audio-related
// hooks. When disabled, the inner component (which owns the hook) is
// never mounted → no getUserMedia, no socket listeners, no AudioContext.
// Toggling re-enable triggers a page reload so React rebuilds cleanly.
export default function CommandTunerRx(props) {
  const disabled = (() => {
    try { return localStorage.getItem(DISABLE_LS_KEY) === '1'; } catch { return false; }
  })();

  if (disabled) {
    const enable = () => {
      try { localStorage.setItem(DISABLE_LS_KEY, '0'); } catch {}
      try { location.reload(); } catch {}
    };
    return (
      <div style={{
        padding: '8px 12px',
        border: '1px dashed var(--rim1)',
        borderRadius: 6,
        background: 'var(--bg1)',
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11, color: 'var(--fg2)',
      }}>
        <span style={{
          fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'var(--amber)', fontWeight: 700,
        }}>Command disabled</span>
        <span style={{ flex: 1 }}>
          Only Crew is active. Re-enable to use the Command tuner again.
        </span>
        <button
          className="btn"
          onClick={enable}
          style={{ fontSize: 10, padding: '3px 10px' }}
        >Re-enable</button>
      </div>
    );
  }

  return <CommandTunerActive {...props} />;
}

function CommandTunerActive({
  voiceProfile, srsSpec, micDeviceId, outputDeviceId,
  otherPttKey = null,
}) {
  const [label, setLabel]     = useState(() => {
    try { return localStorage.getItem(LABEL_LS_KEY) || 'Command'; } catch { return 'Command'; }
  });
  const [editing, setEditing] = useState(false);
  const [locked, setLocked]   = useState(() => {
    try { return localStorage.getItem(LOCK_LS_KEY) === '1'; } catch { return false; }
  });
  const disableCommand = () => {
    try { localStorage.setItem(DISABLE_LS_KEY, '1'); } catch {}
    try { location.reload(); } catch {}
  };

  // Prefer the user's Command-specific radio; fall back to the primary.
  const { radio: commandRadio } = useMyRadio({ tunerId: 'left' });
  const effectiveSpec = commandRadio?.spec || srsSpec || null;

  const {
    tunedFrequency, peers, transmittingPeerIds, isPTTActive,
    joinFrequency, leaveFrequency, startPTT, stopPTT,
    pttKey, setPttKey, bindError,
    volume, setVolume,
    pan, setPan,
    micSensitivity, setMicSensitivity,
    getInputLevel,
  } = useCommandTunerRx({
    voiceProfile, srsSpec: effectiveSpec, micDeviceId, outputDeviceId,
    locked, otherPttKey,
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [freqInput, setFreqInput]           = useState('');
  const [remapListening, setRemapListening] = useState(false);
  const isFirstKeydownRef = useRef(false);

  useEffect(() => { setFreqInput(tunedFrequency || ''); }, [tunedFrequency]);

  // Hydrate label + locked from backend on first mount so they sync across
  // devices. localStorage still wins for live edits — this just fills the
  // initial state when localStorage is empty.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    api.get('/users/voice-profile').then(({ data }) => {
      if (!data) return;
      if (data.command_label && !localStorage.getItem(LABEL_LS_KEY)) {
        setLabel(data.command_label);
      }
      if (typeof data.command_locked === 'boolean' && !localStorage.getItem(LOCK_LS_KEY)) {
        setLocked(data.command_locked);
      }
    }).catch(() => {});
  }, []);

  // Debounced backend saves for label + locked. Prevents a double-click
  // rename from spamming the server with per-keystroke PUTs.
  const labelSaveTimer = useRef(null);
  useEffect(() => {
    try { localStorage.setItem(LABEL_LS_KEY, label); } catch {}
    clearTimeout(labelSaveTimer.current);
    labelSaveTimer.current = setTimeout(() => {
      api.put('/users/voice-profile', { command_label: label }).catch(() => {});
    }, 500);
    return () => clearTimeout(labelSaveTimer.current);
  }, [label]);
  useEffect(() => {
    try { localStorage.setItem(LOCK_LS_KEY, locked ? '1' : '0'); } catch {}
    api.put('/users/voice-profile', { command_locked: locked }).catch(() => {});
  }, [locked]);

  const applyFreq = useCallback(() => {
    if (locked) return;
    const raw = (freqInput || '').trim();
    if (!raw) { setFreqInput(tunedFrequency || ''); return; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { setFreqInput(tunedFrequency || ''); return; }
    if (n < 50 || n > 350) { setFreqInput(tunedFrequency || ''); return; }
    const normalized = n.toFixed(1);
    if (normalized === tunedFrequency) return;
    joinFrequency(normalized);
  }, [freqInput, tunedFrequency, joinFrequency, locked]);

  // PTT remap — accepts keyboard or Mouse4+ side button
  useEffect(() => {
    if (!remapListening) return;
    const commit = (newKey) => { setPttKey(newKey); setRemapListening(false); };
    const keyHandler = (e) => {
      e.preventDefault();
      if (isFirstKeydownRef.current) { isFirstKeydownRef.current = false; return; }
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
  }, [remapListening, setPttKey]);

  const startRemap = () => { isFirstKeydownRef.current = true; setRemapListening(true); };
  const clearBind  = () => setPttKey(null);
  const toggleLock = () => setLocked(l => !l);

  const activeTxCount = (transmittingPeerIds || []).length;
  const pttLabel = pttKey ? pttKey.toUpperCase() : '—';
  const pttIsMouse = /^mouse\d+$/i.test(pttKey || '');
  const pttIcon = pttIsMouse ? '🖱' : '⌨';

  return (
    <div style={{
      // v0.9.7 — scaled ~15% larger to match the Crew panel's visual weight
      // now that MIC TRACK + MIC VOLUME live here too. Padding and gap bump
      // from (10, 8) → (12, 10). Button heights are nudged proportionally
      // further down.
      padding: '12px 14px',
      border: '1px solid var(--rim1)',
      borderRadius: 7,
      background: 'linear-gradient(180deg, var(--bg2), var(--bg1))',
      display: 'flex', flexDirection: 'column', gap: 10,
      minWidth: 0,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
        paddingBottom: 6, borderBottom: '1px solid var(--rim0)',
      }}>
        <span style={{
          fontSize: 9, letterSpacing: '0.16em', color: 'var(--cyan)',
          fontWeight: 700, flexShrink: 0,
        }}>⬦</span>
        {editing ? (
          <input
            autoFocus
            value={label}
            onChange={e => setLabel(e.target.value.slice(0, 24))}
            onBlur={() => setEditing(false)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(false); }}
            style={{
              background: 'var(--bg0)', border: '1px solid var(--rim1)',
              color: 'var(--fg0)', fontSize: 10, padding: '2px 6px',
              borderRadius: 3, flex: 1, minWidth: 0,
              letterSpacing: '0.16em', textTransform: 'uppercase',
            }}
          />
        ) : (
          <span
            onDoubleClick={() => !locked && setEditing(true)}
            title={locked ? 'Locked — unlock to rename' : 'Double-click to rename'}
            style={{
              fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase',
              color: 'var(--cyan)', fontWeight: 700,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              cursor: locked ? 'default' : 'pointer',
              flex: 1, minWidth: 0,
            }}
          >{label}</span>
        )}
        <span style={{
          fontSize: 10,
          color: activeTxCount > 0 || isPTTActive ? 'var(--lime)' : 'var(--fg3)',
          letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums',
          flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          {tunedFrequency ? `${tunedFrequency} MHz` : 'Not tuned'}
          {activeTxCount > 0 && ' · RX'}
          {isPTTActive && ' · TX'}
        </span>
      </div>

      {/* Current Command radio — shows which rig your Command tx uses.
          Falls back to "(inherits primary)" when the Command slot is
          empty. Click to open the Radio Picker in Command mode. */}
      <button
        onClick={() => setPickerOpen(true)}
        disabled={locked}
        title={locked ? 'Locked' : 'Change Command radio'}
        style={{
          background: 'var(--bg0)', border: '1px solid var(--rim0)',
          borderRadius: 4, padding: '4px 8px', cursor: locked ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
          color: 'var(--fg1)', fontFamily: 'inherit',
        }}
      >
        <span style={{
          fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'var(--cyan)', fontWeight: 700, flexShrink: 0,
        }}>Rig</span>
        <span style={{
          fontSize: 11, flex: 1, textAlign: 'left',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: commandRadio ? 'var(--fg0)' : 'var(--fg3)',
        }}>
          {commandRadio ? `${commandRadio.band} · ${commandRadio.label}` : '(inherits primary)'}
        </span>
        {!locked && (
          <span style={{ fontSize: 9, color: 'var(--fg3)', flexShrink: 0 }}>▸</span>
        )}
      </button>

      {/* Tune row — FreqTuneInput for parity with primary radio */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FreqTuneInput
            value={freqInput}
            onChange={locked ? () => {} : setFreqInput}
            onCommit={applyFreq}
            onCancel={() => setFreqInput(tunedFrequency || '')}
            transmitting={isPTTActive}
            lcdFontSize={14}
            playTune={locked ? undefined : playTune}
          />
        </div>
        {tunedFrequency && !locked && (
          <button
            className="btn"
            onClick={leaveFrequency}
            style={{ fontSize: 10, padding: '4px 8px', height: 30, flexShrink: 0 }}
          >Untune</button>
        )}
        <button
          className={`btn${locked ? ' amb' : ''}`.trim()}
          onClick={toggleLock}
          title={locked ? 'Unlock tuner' : 'Lock tuner'}
          style={{
            width: 28, height: 30, padding: 0, fontSize: 12, flexShrink: 0,
            ...(locked ? { color: '#ffffff', fontWeight: 700 } : {}),
          }}
        >{locked ? '🔒' : '🔓'}</button>
      </div>

      {/* MIC TRACK — live mic input meter, matches Crew's visual layout */}
      <MicTrackMeter getLevel={getInputLevel} />

      {/* MIC VOLUME — pre-filter mic sensitivity slider, matches Crew */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'var(--fg0)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>Mic volume</span>
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'var(--fg0)',
            fontVariantNumeric: 'tabular-nums',
          }}>{micSensitivity}%</span>
        </div>
        <input
          type="range"
          min={0} max={150} step={5}
          value={micSensitivity}
          onChange={e => setMicSensitivity(Number(e.target.value))}
          disabled={locked}
          style={{
            width: '100%',
            accentColor: 'var(--cyan, #00EEFF)',
            height: 10, cursor: locked ? 'not-allowed' : 'pointer',
            background: 'var(--bg0, #020C14)',
            border: '1px solid var(--rim1, #2A5A7A)',
            borderRadius: 4, padding: 0,
          }}
        />
      </div>

      {/* Transmit + PTT bind row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <button
          className={`btn${isPTTActive ? ' tx on' : ''}`}
          onMouseDown={() => { if (tunedFrequency) startPTT(); }}
          onMouseUp={stopPTT}
          onMouseLeave={stopPTT}
          disabled={!tunedFrequency || !pttKey}
          style={{
            flex: 1, minWidth: 0, fontSize: 10, height: 30, padding: '0 8px',
            userSelect: 'none', letterSpacing: '0.06em',
          }}
        >
          {!tunedFrequency ? 'Not tuned' :
           !pttKey ? 'Bind a key →' :
           isPTTActive ? '● TX' : `● TX (${pttLabel})`}
        </button>
        <button
          className={`btn${remapListening ? ' amb' : ''}`.trim()}
          onClick={remapListening ? undefined : startRemap}
          disabled={remapListening}
          title={remapListening ? 'Press any key or mouse-side button' : 'Set Command PTT key'}
          style={{
            fontSize: 10, padding: '0 8px', height: 30, flexShrink: 0,
            minWidth: 54, letterSpacing: '0.06em',
            ...(remapListening ? { color: '#ffffff', fontWeight: 700 } : {}),
          }}
        >
          {remapListening ? 'Press…' : (pttKey ? `${pttIcon} ${pttLabel}` : 'Bind')}
        </button>
        {pttKey && !remapListening && (
          <button
            className="btn"
            onClick={clearBind}
            title="Clear binding"
            style={{ fontSize: 10, padding: '0 6px', height: 30, flexShrink: 0 }}
          >✕</button>
        )}
      </div>

      {/* Bind-error chip (duplicate rejection) */}
      {bindError && (
        <div style={{
          fontSize: 10, color: 'var(--red)', letterSpacing: '0.06em',
          background: 'color-mix(in srgb, var(--red) 14%, var(--bg0))',
          padding: '3px 6px', borderRadius: 3, border: '1px solid var(--red)',
        }}>⚠ {bindError}</div>
      )}

      {/* Peer list */}
      {tunedFrequency && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 6px',
          minWidth: 0,
        }}>
          {(peers || []).length === 0 ? (
            <div style={{
              gridColumn: '1 / -1', fontSize: 10, color: 'var(--fg3)',
              textAlign: 'center', padding: '4px 0',
            }}>No operators on this frequency.</div>
          ) : peers.map(p => {
            const speaking = (transmittingPeerIds || []).includes(p.socketId);
            return (
              <div
                key={p.socketId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '2px 6px',
                  background: speaking ? 'rgba(68,255,136,.14)' : 'transparent',
                  border: `1px solid ${speaking ? 'rgba(68,255,136,.55)' : 'var(--rim0)'}`,
                  borderRadius: 3, minWidth: 0,
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

      {/* Advanced tray — volume + stereo pan (both persist). Pan defaults
          to 0 so there's zero audible difference until the user moves it. */}
      <div>
        <button
          onClick={() => setAdvancedOpen(o => !o)}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'var(--fg3)', fontWeight: 600,
          }}
        >{advancedOpen ? '▾' : '▸'} Volume · Pan</button>
        {advancedOpen && (
          <div style={{
            marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6,
            padding: '6px 8px', background: 'var(--bg0)', border: '1px solid var(--rim0)',
            borderRadius: 4,
          }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{
                  fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: 'var(--fg2)', fontWeight: 600,
                }}>Volume</span>
                <span style={{ fontSize: 10, color: 'var(--fg0)', fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(volume * 100)}%
                </span>
              </div>
              <input
                type="range" min={0} max={1.5} step={0.05}
                value={volume}
                onChange={e => setVolume(Number(e.target.value))}
                disabled={locked}
                style={{
                  width: '100%', height: 8, cursor: locked ? 'not-allowed' : 'pointer',
                  accentColor: 'var(--cyan, #00EEFF)',
                  background: 'var(--bg0)',
                }}
              />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{
                  fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: 'var(--fg2)', fontWeight: 600,
                }}>Pan {pan === 0 ? '' : (pan < 0 ? '(L)' : '(R)')}</span>
                <span style={{ fontSize: 10, color: 'var(--fg0)', fontVariantNumeric: 'tabular-nums' }}>
                  {pan === 0 ? 'C' : pan.toFixed(2)}
                </span>
              </div>
              <input
                type="range" min={-0.6} max={0.6} step={0.05}
                value={pan}
                onChange={e => setPan(Number(e.target.value))}
                disabled={locked}
                style={{
                  width: '100%', height: 8, cursor: locked ? 'not-allowed' : 'pointer',
                  accentColor: 'var(--cyan, #00EEFF)',
                }}
              />
            </div>
            {/* Diagnostic opt-out. Shuts the Command tuner down completely
                (releases mic, closes socket listeners) via a page reload.
                Use this to A/B whether Command activity is affecting Crew. */}
            <button
              onClick={disableCommand}
              style={{
                marginTop: 4, background: 'none', border: '1px dashed var(--rim1)',
                padding: '4px 8px', borderRadius: 3, cursor: 'pointer',
                fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'var(--amber)', fontWeight: 600,
              }}
              title="Fully disable the Command tuner. Reloads the page. Useful to test if dual-radio activity is affecting your Crew audio."
            >Disable Command tuner (diagnostic)</button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 9, color: 'var(--fg3)', letterSpacing: '0.06em' }}>
        SELCAL on my transmit · {pttKey ? `hold ${pttLabel} to TX` : 'bind a key to transmit'}
      </div>

      <RadioPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        tunerId="left"
      />
    </div>
  );
}

// MIC TRACK — matches the Crew panel's live-input meter visually.
function MicTrackMeter({ getLevel }) {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: 'var(--fg0)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>Mic track</span>
        <span style={{
          fontSize: 11, fontWeight: 600, color: 'var(--fg0)',
          fontVariantNumeric: 'tabular-nums',
        }}>{Math.round(level)}%</span>
      </div>
      <div style={{
        width: '100%', height: 10,
        background: 'var(--bg0, #020C14)',
        border: '1px solid var(--rim1, #2A5A7A)',
        borderRadius: 4, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${level}%`, background: fillColor,
          transition: 'width 0.05s',
        }} />
      </div>
    </div>
  );
}
