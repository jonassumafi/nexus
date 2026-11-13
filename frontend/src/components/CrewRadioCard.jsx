// Crew wrapper around <RadioModule />. Takes the primary radio's data
// (lifted up to Dashboard via useRadioConnection) and feeds it to the
// mirror-identical module. Pairs with CommandRadioCard.

import { useState, useRef, useEffect, useCallback } from 'react';
import RadioModule from './RadioModule';
import useMyRadio from '../hooks/useMyRadio';
import RadioPickerModal from './RadioPickerModal';
import api from '../services/api';

// Short mechanical cues for lock/power toggles. Matches the Radio-only
// overlay (RadioTwinTiles) so all three views sound the same.
function playLockClose()  { try { new Audio('/sounds/click2.mp3').play().catch(() => {}); } catch {} }
function playLockOpen()   { try { new Audio('/sounds/click.mp3').play().catch(() => {}); }  catch {} }
function playPowerClick() { try { new Audio('/sounds/click.mp3').play().catch(() => {}); }  catch {} }

export default function CrewRadioCard({
  tunedFrequency,
  peers,
  transmittingPeerIds,
  isPTTActive,
  joinFrequency,
  leaveFrequency,
  startPTT,
  stopPTT,
  pttKey,
  setPttKey,
  onOpenSettings,
  siblingSettingsOpen = false,
  onSettingsOpenChange,
}) {
  const { radio: crewRadio } = useMyRadio({ tunerId: 'right' });
  const [locked, setLocked] = useState(() => {
    try { return localStorage.getItem('nexus_crew_locked') === '1'; } catch { return false; }
  });
  const [powered, setPowered] = useState(() => {
    try { return localStorage.getItem('nexus_crew_powered') !== '0'; } catch { return true; }
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [remapListening, setRemapListening] = useState(false);
  const isFirstKeydownRef = useRef(false);

  useEffect(() => {
    try { localStorage.setItem('nexus_crew_locked', locked ? '1' : '0'); } catch {}
  }, [locked]);

  // Power-off calls leaveFrequency because toggling off should actually drop
  // us from the socket room, not just hide the UI. Ref-guarded so we only
  // fire on true→false transitions (not on mount).
  const prevPoweredRef = useRef(powered);
  useEffect(() => {
    try { localStorage.setItem('nexus_crew_powered', powered ? '1' : '0'); } catch {}
    if (prevPoweredRef.current && !powered && tunedFrequency) {
      leaveFrequency();
    }
    prevPoweredRef.current = powered;
  }, [powered, tunedFrequency, leaveFrequency]);

  // PTT remap — same two-phase pattern as the primary radio panel.
  useEffect(() => {
    if (!remapListening) return;
    const commit = (newKey) => {
      setPttKey(newKey);
      try { localStorage.setItem('nexus_ptt_key', newKey); } catch {}
      try { window?.electronAPI?.setPttKeys?.({ right: newKey }); } catch {}
      api.put('/users/voice-profile', { ptt_key: newKey }).catch(() => {});
      setRemapListening(false);
    };
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
    joinFrequency(normalized, null);
  }, [joinFrequency, tunedFrequency]);

  // Shorthand: last word of the label (e.g. "VX-134 Patrol" → "Patrol").
  const shortOf = (name) => {
    if (!name) return '';
    const parts = String(name).trim().split(/\s+/);
    return parts[parts.length - 1] || name;
  };
  const rigLabel = crewRadio ? `${crewRadio.band} · ${crewRadio.label}` : '(no rig)';
  const rigShort = crewRadio ? shortOf(crewRadio.label) : '(no rig)';
  const isLive = (peers || []).length > 0;

  return (
    <>
      <RadioModule
        role="CREW"
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
        onPowerToggle={() => { playPowerClick(); setPowered(p => !p); }}
        onLockToggle={() => setLocked(l => { (l ? playLockOpen : playLockClose)(); return !l; })}
        onPttDown={startPTT}
        onPttUp={stopPTT}
        onRemapPtt={(preresolvedKey) => {
          // New call style: back-face capture resolves the key itself and
          // passes it in. Legacy call style: no arg → fall back to the
          // full-screen listener overlay.
          if (typeof preresolvedKey === 'string' && preresolvedKey) {
            setPttKey(preresolvedKey);
            try { localStorage.setItem('nexus_ptt_key', preresolvedKey); } catch {}
            try { window?.electronAPI?.setPttKeys?.({ right: preresolvedKey }); } catch {}
            api.put('/users/voice-profile', { ptt_key: preresolvedKey }).catch(() => {});
            return;
          }
          isFirstKeydownRef.current = true;
          setRemapListening(true);
        }}
        onOpenSettings={onOpenSettings}
        onOpenRigPicker={() => setPickerOpen(true)}
        otherPttKey={null}
        siblingSettingsOpen={siblingSettingsOpen}
        onSettingsOpenChange={onSettingsOpenChange}
      />
      <RadioPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        tunerId="right"
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
            Press any key or Mouse 4+ to bind CREW
          </div>
        </div>
      )}
    </>
  );
}
