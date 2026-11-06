// Command wrapper around <RadioModule />. Owns the Command tuner hook,
// label editing, lock state, and the remap listener. Pairs with
// CrewRadioCard — the two are rendered identically except for the
// `role` prop and the data they're wired to.

import { useState, useRef, useEffect, useCallback } from 'react';
import { useCommandTunerRx } from '../hooks/useCommandTunerRx';
import useMyRadio from '../hooks/useMyRadio';
import RadioModule from './RadioModule';
import RadioPickerModal from './RadioPickerModal';
import api from '../services/api';

const LABEL_LS_KEY   = 'nexus_command_label';
const LOCK_LS_KEY    = 'nexus_command_locked';
const POWER_LS_KEY   = 'nexus_command_powered';

export default function CommandRadioCard({
  voiceProfile, srsSpec, micDeviceId, outputDeviceId,
  otherPttKey = null,
  rxVolume = null,        // optional percent (0..150) from the shared RX slider
  onOpenSettings,
  siblingSettingsOpen = false,
  onSettingsOpenChange,
}) {
  // Prefer the user's Command-specific radio; fall back to the primary.
  const { radio: commandRadio } = useMyRadio({ tunerId: 'left' });
  const effectiveSpec = commandRadio?.spec || srsSpec || null;

  const [label, setLabel] = useState(() => {
    try { return localStorage.getItem(LABEL_LS_KEY) || 'Command'; } catch { return 'Command'; }
  });
  const [locked, setLocked] = useState(() => {
    try { return localStorage.getItem(LOCK_LS_KEY) === '1'; } catch { return false; }
  });
  const [powered, setPowered] = useState(() => {
    try { return localStorage.getItem(POWER_LS_KEY) !== '0'; } catch { return true; }
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [remapListening, setRemapListening] = useState(false);
  const isFirstKeydownRef = useRef(false);

  const {
    tunedFrequency, peers, transmittingPeerIds, isPTTActive,
    joinFrequency, leaveFrequency, startPTT, stopPTT,
    pttKey, setPttKey, bindError,
    volume, setVolume,
    pan, setPan,
  } = useCommandTunerRx({
    voiceProfile, srsSpec: effectiveSpec, micDeviceId, outputDeviceId,
    locked, otherPttKey,
  });

  // Mirror the shared RX slider into the Command tuner's internal volume
  // when the parent provides one. Null means "use the hook's own stored
  // value" (legacy standalone callers).
  useEffect(() => {
    if (rxVolume == null) return;
    setVolume(Math.max(0, Math.min(1.5, rxVolume / 100)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rxVolume]);


  // Hydrate label + locked once at mount.
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

  // Persist label + locked
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

  // Power-off calls leaveFrequency because toggling off should actually drop
  // us from the socket room, not just hide the UI. Ref-guarded so we only
  // fire on true→false transitions (not on mount).
  const prevPoweredRef = useRef(powered);
  useEffect(() => {
    try { localStorage.setItem(POWER_LS_KEY, powered ? '1' : '0'); } catch {}
    if (prevPoweredRef.current && !powered && tunedFrequency) {
      leaveFrequency();
    }
    prevPoweredRef.current = powered;
  }, [powered, tunedFrequency, leaveFrequency]);

  // PTT remap
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

  const onCommitFreq = useCallback((raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 50 || n > 350) return;
    const normalized = n.toFixed(1);
    if (normalized === tunedFrequency) return;
    joinFrequency(normalized);
  }, [joinFrequency, tunedFrequency]);

  // Shorthand: last word of the label (e.g. "VX-134 Patrol" → "Patrol").
  const shortOf = (name) => {
    if (!name) return '';
    const parts = String(name).trim().split(/\s+/);
    return parts[parts.length - 1] || name;
  };
  const rigLabel = commandRadio ? `${commandRadio.band} · ${commandRadio.label}` : '(inherits primary)';
  const rigShort = commandRadio ? shortOf(commandRadio.label) : '(inherits primary)';
  const isLive = (peers || []).length > 0;

  return (
    <>
      <RadioModule
        role={(label || 'COMMAND').toUpperCase()}
        rigLabel={rigLabel}
        rigShort={rigShort}
        freq={tunedFrequency || ''}
        pttKey={pttKey}
        isLive={isLive}
        isTx={isPTTActive}
        peers={peers}
        transmittingPeerIds={transmittingPeerIds}
        locked={locked}
        powered={powered}
        onCommitFreq={onCommitFreq}
        onPowerToggle={() => setPowered(p => !p)}
        onLockToggle={() => setLocked(l => !l)}
        onPttDown={startPTT}
        onPttUp={stopPTT}
        onRemapPtt={(preresolvedKey) => {
          if (typeof preresolvedKey === 'string' && preresolvedKey) {
            setPttKey(preresolvedKey);
            return;
          }
          isFirstKeydownRef.current = true;
          setRemapListening(true);
        }}
        onOpenSettings={onOpenSettings}
        onOpenRigPicker={() => setPickerOpen(true)}
        otherPttKey={otherPttKey}
        siblingSettingsOpen={siblingSettingsOpen}
        onSettingsOpenChange={onSettingsOpenChange}
      />
      {bindError && (
        <div style={{
          marginTop: 4,
          fontSize: 11, color: 'var(--red)', letterSpacing: '0.04em',
          background: 'color-mix(in srgb, var(--red) 14%, var(--bg0))',
          padding: '4px 8px', borderRadius: 3,
          border: '1px solid var(--red)',
        }}>⚠ {bindError}</div>
      )}
      <RadioPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        tunerId="left"
      />
      {remapListening && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            padding: '12px 20px', borderRadius: 8,
            background: 'var(--bg2)', border: '1px solid var(--amber)',
            color: 'var(--amber)', fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase', fontSize: 14,
          }}>
            Press any key or Mouse 4+ to bind COMMAND
          </div>
        </div>
      )}
    </>
  );
}
