// RadioOverlay — the compact in-game overlay form of the radio.
// Mirrors `radio_overlay_layout.html`: 520px window, two mirror-identical
// rows (Crew + Command) sharing a 7-column grid, one shared mic strip,
// gear-triggered settings face that swaps bands 2+3 with a segmented
// Crew/Command picker.
//
// UX choice (per spec "I'll leave the exact UX choice to you"):
//   The LCD slot is an inline editable FreqTuneInput (it ships its own
//   TUNE commit affordance). The spec's external Tune column is kept
//   for grid parity and acts as a shortcut that focuses + selects the
//   input (keyboard-first commit path).
//
// Mounts the real radio hooks (Crew: useRadioConnection|UDP based on
// transport detection; Command: useCommandTunerRx). Self-contained — the
// Radio-only Electron window page just renders <RadioOverlay/>.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from '../context/AuthContext.jsx';
import { useRadioConnection } from '../hooks/useRadioConnection';
import { useRadioConnectionUDP } from '../hooks/useRadioConnectionUDP';
import { useCommandTunerRx } from '../hooks/useCommandTunerRx';
import useMyRadio from '../hooks/useMyRadio';
import FreqTuneInput from './FreqTuneInput';
import RadioPickerModal from './RadioPickerModal';
import { randomVoiceProfile } from '../utils/spacesuitFilter';
import { playTune } from '../utils/audioFx';
import api from '../services/api';
import './radioMotion.css';

const PROFILE_FIELDS = [
  'highpass', 'lowpass', 'resonance_freq', 'resonance_q',
  'distortion', 'static_level', 'pitch_shift', 'bit_crush',
];

export default function RadioOverlay() {
  const { user: me } = useAuthContext();

  // Transport: freeze once at mount (React can't flip hook identity per render).
  const initialTransportRef = useRef((() => {
    try {
      if (import.meta.env.VITE_NEXUS_UDP_ONLY === '1') return 'udp';
      if (typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('udp') === '1') return 'udp';
    } catch {}
    return 'webrtc';
  })());

  // Voice profile — fetched once; falls back to a random profile.
  const [voiceProfile, setVoiceProfile]     = useState(null);
  const [profileVersion, _setProfileVersion] = useState(0); // eslint-disable-line no-unused-vars
  const [pttKey, setPttKey]                 = useState(() => localStorage.getItem('nexus_ptt_key') || 'v');
  const [micDeviceId]       = useState(() => localStorage.getItem('nexus_mic_device_id') || null);
  const [outputDeviceId]    = useState(() => localStorage.getItem('nexus_output_device_id') || null);
  const [micSensitivity, setMicSensitivity] = useState(() => {
    const v = Number(localStorage.getItem('nexus_mic_sensitivity'));
    return Number.isFinite(v) && v > 0 ? v : 100;
  });

  // Per-tuner persisted state.
  const [crewLocked, setCrewLocked] = useState(() => {
    try { return localStorage.getItem('nexus_crew_locked') === '1'; } catch { return false; }
  });
  const [cmdLocked, setCmdLocked] = useState(() => {
    try { return localStorage.getItem('nexus_command_locked') === '1'; } catch { return false; }
  });
  const [crewPowered, setCrewPowered] = useState(() => {
    try { return localStorage.getItem('nexus_crew_powered') !== '0'; } catch { return true; }
  });
  const [cmdPowered, setCmdPowered] = useState(() => {
    try { return localStorage.getItem('nexus_command_powered') !== '0'; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem('nexus_crew_locked', crewLocked ? '1' : '0'); } catch {} }, [crewLocked]);
  useEffect(() => { try { localStorage.setItem('nexus_command_locked', cmdLocked ? '1' : '0'); } catch {} }, [cmdLocked]);
  useEffect(() => { try { localStorage.setItem('nexus_crew_powered', crewPowered ? '1' : '0'); } catch {} }, [crewPowered]);
  useEffect(() => { try { localStorage.setItem('nexus_command_powered', cmdPowered ? '1' : '0'); } catch {} }, [cmdPowered]);

  // Crew hook — WebRTC or UDP depending on transport detected at mount.
  const crew = (initialTransportRef.current === 'udp' ? useRadioConnectionUDP : useRadioConnection)({
    voiceProfile,
    voiceProfileVersion: profileVersion,
    pttKey,
    micDeviceId,
    outputDeviceId,
    me,
  });

  // Command hook — always WebRTC in both builds.
  const { radio: crewRadio } = useMyRadio({ tunerId: 'right' });
  const { radio: cmdRadio }  = useMyRadio({ tunerId: 'left' });

  const cmd = useCommandTunerRx({
    voiceProfile,
    srsSpec: cmdRadio?.spec || crewRadio?.spec || null,
    micDeviceId,
    outputDeviceId,
    locked: cmdLocked,
    otherPttKey: pttKey,
  });

  // Push rig spec / band into Crew hook.
  useEffect(() => { crew.setSrsRadioSpec?.(crewRadio?.spec || null); }, [crewRadio, crew]);
  useEffect(() => { crew.setSrsRadioBand?.(crewRadio?.band || 'VHF'); }, [crewRadio, crew]);

  // Mic sensitivity feeds the Crew hook (the hook owns the mic stream).
  useEffect(() => {
    try { localStorage.setItem('nexus_mic_sensitivity', String(micSensitivity)); } catch {}
    crew.setMicSensitivity?.(micSensitivity);
  }, [micSensitivity, crew]);

  // Request mic permission eagerly.
  useEffect(() => {
    if (crew.micPermission === 'prompt' || crew.micPermission === 'denied') {
      crew.requestMicPermission?.();
    }
  }, [crew.micPermission]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load voice profile once.
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

  // Mic level meter, cheap polling.
  const [micLevel, setMicLevel] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      const v = crew.getInputLevel?.() || 0;
      setMicLevel(Number.isFinite(v) ? v : 0);
    }, 70);
    return () => clearInterval(id);
  }, [crew]);

  // Commit a frequency to the given tuner.
  const commitCrewFreq = useCallback((raw) => {
    const n = Number(String(raw || '').trim());
    if (!Number.isFinite(n) || n < 50 || n > 350) return;
    const normalized = n.toFixed(1);
    if (normalized === crew.tunedFrequency) return;
    try { crew.joinFrequency(normalized, null); } catch {}
  }, [crew]);
  const commitCmdFreq = useCallback((raw) => {
    const n = Number(String(raw || '').trim());
    if (!Number.isFinite(n) || n < 50 || n > 350) return;
    const normalized = n.toFixed(1);
    if (normalized === cmd.tunedFrequency) return;
    try { cmd.joinFrequency(normalized); } catch {}
  }, [cmd]);

  // Settings face state.
  const [cfgOpen, setCfgOpen]       = useState(false);
  const [cfgClosing, setCfgClosing] = useState(false);
  const [cfgSel, setCfgSel]         = useState('crew'); // 'crew' | 'cmd'
  const [savedShow, setSavedShow]   = useState(false);
  const savedTimerRef = useRef(null);
  const showSaved = () => {
    setSavedShow(true);
    clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedShow(false), 1300);
  };

  // Refs for face measure-and-animate.
  const facesRef = useRef(null);
  const frontRef = useRef(null);
  const backRef  = useRef(null);
  const crewGearRef = useRef(null);
  const cmdGearRef  = useRef(null);

  const animateFaces = (opening) => {
    const f = facesRef.current;
    if (!f) return;
    const from = f.getBoundingClientRect().height;
    const front = frontRef.current;
    const back  = backRef.current;
    let to;
    if (opening) {
      const prev = back.style.visibility;
      back.style.visibility = 'visible';
      to = back.offsetHeight;
      back.style.visibility = prev;
    } else {
      to = front.offsetHeight;
    }
    f.style.height = from + 'px';
    void f.offsetHeight;
    f.style.height = to + 'px';
    const clear = () => { f.style.height = ''; f.removeEventListener('transitionend', onEnd); };
    const onEnd = (e) => { if (e.target === f && e.propertyName === 'height') clear(); };
    f.addEventListener('transitionend', onEnd);
    setTimeout(clear, 700);
  };

  const openCfg = useCallback((which) => {
    setCfgSel(which);
    if (cfgOpen) return; // already open — just re-select
    setCfgOpen(true);
    requestAnimationFrame(() => { animateFaces(true); });
  }, [cfgOpen]);

  const closeCfg = useCallback(() => {
    if (!cfgOpen) return;
    setCfgClosing(true);
    setCfgOpen(false);
    requestAnimationFrame(() => {
      animateFaces(false);
      setTimeout(() => setCfgClosing(false), 460);
      const btn = cfgSel === 'crew' ? crewGearRef.current : cmdGearRef.current;
      try { btn?.focus({ preventScroll: true }); } catch {}
    });
  }, [cfgOpen, cfgSel]);

  // Escape closes the settings face.
  useEffect(() => {
    if (!cfgOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeCfg(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cfgOpen, closeCfg]);

  // PTT remap — capture-in-row for the currently selected tuner.
  const [capturing, setCapturing] = useState(false);
  const [capLabel,  setCapLabel]  = useState(null);
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(false); setCapLabel(null); return; }
      const raw = e.key;
      const label = raw.length === 1
        ? raw.toUpperCase()
        : (raw === 'CapsLock' ? 'CAPSLOCK' : raw.toUpperCase());
      if (['SHIFT','CONTROL','ALT','META'].includes(label)) return;
      // Duplicate-rejection between tuners.
      const otherKey = cfgSel === 'crew'
        ? String(cmd.pttKey || '').toUpperCase()
        : String(pttKey || '').toUpperCase();
      if (otherKey && label === otherKey) {
        setCapLabel(label + ' in use');
        setTimeout(() => setCapLabel(null), 900);
        return;
      }
      setCapturing(false);
      setCapLabel(null);
      if (cfgSel === 'crew') {
        setPttKey(label);
        try { localStorage.setItem('nexus_ptt_key', label); } catch {}
        try { window?.electronAPI?.setPttKeys?.({ right: label }); } catch {}
        api.put('/users/voice-profile', { ptt_key: label }).catch(() => {});
      } else {
        try { cmd.setPttKey?.(label); } catch {}
      }
      showSaved();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, cfgSel, pttKey, cmd]);

  // Picker modals.
  const [crewPickerOpen, setCrewPickerOpen] = useState(false);
  const [cmdPickerOpen,  setCmdPickerOpen]  = useState(false);

  // Derived display values.
  const shortOf = (name) => {
    if (!name) return '';
    const parts = String(name).trim().split(/\s+/);
    return parts[parts.length - 1] || name;
  };
  const crewRig = crewRadio ? { label: `${crewRadio.band} · ${crewRadio.label}`, short: shortOf(crewRadio.label) } : { label: '(no rig)', short: '(no rig)' };
  const cmdRig  = cmdRadio  ? { label: `${cmdRadio.band} · ${cmdRadio.label}`,   short: shortOf(cmdRadio.label)  } : { label: '(inherits)', short: '(inherits)' };

  // Current selected tuner's bag (for the settings face).
  const selBag = useMemo(() => {
    if (cfgSel === 'crew') {
      return {
        role: 'Crew', rig: crewRig, key: pttKey, locked: crewLocked,
        setLocked: setCrewLocked,
        openPicker: () => setCrewPickerOpen(true),
      };
    }
    return {
      role: 'Command', rig: cmdRig, key: cmd.pttKey, locked: cmdLocked,
      setLocked: setCmdLocked,
      openPicker: () => setCmdPickerOpen(true),
    };
  }, [cfgSel, crewRig, cmdRig, pttKey, cmd.pttKey, crewLocked, cmdLocked]);

  const winClass = 'rm-ov-win' + (cfgOpen ? ' rm-ov-cfg' : '') + (cfgClosing ? ' rm-ov-closing' : '');

  // Derive RX state + the name of the first active speaker, per tuner. Used
  // to tint the row green and swap the rig label for "Name speaking".
  const resolveSpeaker = (hook) => {
    const ids = (hook.transmittingPeerIds || []).filter(Boolean);
    if (!ids.length) return null;
    const match = (hook.peers || []).find(p => p && (p.socketId === ids[0] || p.userId === ids[0]));
    return match?.citizenName || match?.userId || 'Peer';
  };
  const crewSpeaker = resolveSpeaker(crew);
  const cmdSpeaker  = resolveSpeaker(cmd);
  const crewIsRx = !!crewSpeaker && !crew.isPTTActive && crewPowered;
  const cmdIsRx  = !!cmdSpeaker  && !cmd.isPTTActive  && cmdPowered;

  return (
    <div className={winClass} style={winStyle}>
      <style>{OVERLAY_CSS}</style>

      {/* Bands 2 + 3 live inside .rm-ov-faces so the settings face can
          cover them. Titlebar + mic strip are siblings and stay visible. */}
      <div className="rm-ov-faces" ref={facesRef}>
        <div className="rm-ov-face rm-ov-front" ref={frontRef}>
          <RadioRow
            role="Crew"
            rig={crewRig}
            freq={crew.tunedFrequency || ''}
            keyLabel={pttKey}
            isTx={crew.isPTTActive}
            isRx={crewIsRx}
            speakerName={crewSpeaker}
            powered={crewPowered}
            locked={crewLocked}
            onPower={() => setCrewPowered(p => !p)}
            onLock={() => setCrewLocked(l => !l)}
            onPttDown={() => { if (crewPowered) crew.startPTT?.(); }}
            onPttUp={() => crew.stopPTT?.()}
            onCommitFreq={commitCrewFreq}
            onGear={() => (cfgOpen && cfgSel === 'crew') ? closeCfg() : openCfg('crew')}
            gearRef={crewGearRef}
          />
          <RadioRow
            role="Command"
            rig={cmdRig}
            freq={cmd.tunedFrequency || ''}
            keyLabel={cmd.pttKey}
            isTx={cmd.isPTTActive}
            isRx={cmdIsRx}
            speakerName={cmdSpeaker}
            powered={cmdPowered}
            locked={cmdLocked}
            onPower={() => setCmdPowered(p => !p)}
            onLock={() => setCmdLocked(l => !l)}
            onPttDown={() => { if (cmdPowered) cmd.startPTT?.(); }}
            onPttUp={() => cmd.stopPTT?.()}
            onCommitFreq={commitCmdFreq}
            onGear={() => (cfgOpen && cfgSel === 'cmd') ? closeCfg() : openCfg('cmd')}
            gearRef={cmdGearRef}
          />
        </div>

        <div className="rm-ov-face rm-ov-back" ref={backRef} aria-hidden={!cfgOpen}>
          <SettingsFace
            sel={cfgSel}
            setSel={setCfgSel}
            bag={selBag}
            capturing={capturing}
            capLabel={capLabel}
            startCapture={() => { setCapturing(true); setCapLabel(null); }}
            cancelCapture={() => { setCapturing(false); setCapLabel(null); }}
            savedShow={savedShow}
            showSaved={showSaved}
            close={closeCfg}
          />
        </div>
      </div>

      {/* Mic strip — single shared row at the bottom. */}
      <div className="rm-ov-mic">
        <span className="rm-ov-dot" />
        <span className="rm-ov-lab">Track</span>
        <div className="rm-ov-bar"><i style={{ width: `${Math.max(0, Math.min(100, micLevel))}%` }} /></div>
        <span className="rm-ov-pct tn">{Math.round(micLevel)}%</span>
        <span className="rm-ov-lab">Vol</span>
        <input
          className="rm-ov-sl"
          type="range" min={0} max={150} step={5}
          value={micSensitivity}
          onChange={e => setMicSensitivity(Number(e.target.value))}
          aria-label="Mic volume"
        />
        <span className="rm-ov-pct tn">{micSensitivity}%</span>
      </div>

      <RadioPickerModal open={crewPickerOpen} onClose={() => setCrewPickerOpen(false)} tunerId="right" />
      <RadioPickerModal open={cmdPickerOpen}  onClose={() => setCmdPickerOpen(false)}  tunerId="left"  />
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────
function RadioRow({
  role, rig, freq, keyLabel, isTx, isRx = false, speakerName = null,
  powered, locked, onPower, onLock, onPttDown, onPttUp, onCommitFreq, onGear, gearRef,
}) {
  // Local input state so the LCD edits without stomping the committed freq.
  const [input, setInput] = useState(freq || '');
  useEffect(() => { setInput(freq || ''); }, [freq]);

  // Motion refs — the row's dispatch adds transient classes that drive the
  // keyframe animations, then clears them so the same transition can fire again.
  const dispRef = useRef(null);
  const lockRef = useRef(null);
  const prevFreqRef = useRef(freq || '');
  const prevPoweredRef = useRef(powered);
  const prevLockedRef = useRef(locked);

  // Tune flash: freq string actually changed AND powered.
  useEffect(() => {
    const next = freq || '';
    const prev = prevFreqRef.current || '';
    prevFreqRef.current = next;
    if (!prev || !next || prev === next || !powered) return;
    const el = dispRef.current;
    if (!el) return;
    el.classList.remove('rm-ov-flash');
    void el.offsetWidth;
    el.classList.add('rm-ov-flash');
    const t = setTimeout(() => el.classList.remove('rm-ov-flash'), 440);
    return () => clearTimeout(t);
  }, [freq, powered]);

  // Power up: off → on. (Power-down animation is driven by the .rm-ov-off
  // class alone — it fires once when the class is added.)
  useEffect(() => {
    const was = prevPoweredRef.current;
    prevPoweredRef.current = powered;
    if (was || !powered) return;
    const el = dispRef.current;
    if (!el) return;
    el.classList.remove('rm-ov-pup');
    void el.offsetWidth;
    el.classList.add('rm-ov-pup');
    const t = setTimeout(() => el.classList.remove('rm-ov-pup'), 440);
    return () => clearTimeout(t);
  }, [powered]);

  // Lock snap on toggle (either direction).
  useEffect(() => {
    if (prevLockedRef.current === locked) return;
    prevLockedRef.current = locked;
    const el = lockRef.current;
    if (!el) return;
    el.classList.remove('rm-ov-snap');
    void el.offsetWidth;
    el.classList.add('rm-ov-snap');
    const t = setTimeout(() => el.classList.remove('rm-ov-snap'), 300);
    return () => clearTimeout(t);
  }, [locked]);

  // Deny shake when the user tries to tune while locked.
  const denyNow = useCallback(() => {
    const el = lockRef.current;
    if (!el) return;
    el.classList.remove('rm-ov-deny');
    void el.offsetWidth;
    el.classList.add('rm-ov-deny');
    setTimeout(() => el && el.classList.remove('rm-ov-deny'), 320);
  }, []);

  const tryCommit = (val) => {
    if (!powered) return;
    if (locked) { denyNow(); return; }
    onCommitFreq?.(val);
  };

  const rowClass = 'rm-ov-rr'
    + (isTx ? ' rm-ov-tx' : '')
    + (!isTx && isRx && powered ? ' rm-ov-rx' : '')
    + (locked ? ' rm-ov-locked' : '')
    + (powered ? '' : ' rm-ov-off');
  const label = (keyLabel || '').toString();
  const keyDisp = label.length === 1 ? label.toUpperCase() : (label === 'CapsLock' ? 'CAPS' : label.toUpperCase());
  const showSpeaker = isRx && !isTx && powered && speakerName;

  return (
    <div className={rowClass}>
      <button
        className="rm-ov-ib rm-ov-pw"
        onClick={onPower}
        aria-pressed={powered}
        title={powered ? `Power off ${role}` : `Power on ${role}`}
      >⏻</button>

      <div className="rm-ov-who">
        <b>{role}</b>
        <span className={showSpeaker ? 'rm-ov-spk' : undefined} title={showSpeaker ? `${speakerName} speaking` : rig.label}>
          {showSpeaker ? `${speakerName} speaking` : rig.short}
        </span>
      </div>

      <div className="rm-ov-disp" ref={dispRef} style={{ opacity: powered ? 1 : 0.55 }}>
        <FreqTuneInput
          value={input}
          onChange={(locked || !powered) ? () => {} : setInput}
          onCommit={() => tryCommit(input)}
          onCancel={() => setInput(freq || '')}
          transmitting={isTx}
          lcdFontSize={16}
          playTune={(locked || !powered) ? undefined : playTune}
        />
      </div>

      <button
        className="rm-ov-btn rm-ov-go rm-ov-lockable"
        onClick={() => tryCommit(input)}
        disabled={!powered}
        title={locked ? 'Tuner is locked' : 'Tune'}
      >Tune</button>

      <button
        ref={lockRef}
        className="rm-ov-ib rm-ov-lk"
        onClick={onLock}
        aria-pressed={locked}
        disabled={!powered}
        title={locked ? 'Unlock tuner' : 'Lock tuner'}
      >{locked ? '🔒' : '🔓'}</button>

      <button
        className={'rm-ov-btn rm-ov-go rm-ov-txb' + (isTx ? ' rm-ov-on' : '')}
        onMouseDown={e => { e.preventDefault(); onPttDown?.(); }}
        onMouseUp={onPttUp}
        onMouseLeave={onPttUp}
        onTouchStart={e => { e.preventDefault(); onPttDown?.(); }}
        onTouchEnd={onPttUp}
        disabled={!powered || !freq}
        title={!freq ? 'Tune a frequency first' : 'Hold to transmit'}
      >
        TX <span className="rm-ov-key">{keyDisp || '—'}</span>
      </button>

      <button
        ref={gearRef}
        className="rm-ov-ib"
        onClick={onGear}
        aria-label={`${role} settings`}
        title="Settings"
      >⚙</button>
    </div>
  );
}

// ─── Settings face ────────────────────────────────────────────────────────
function SettingsFace({ sel, setSel, bag, capturing, capLabel, startCapture, cancelCapture, savedShow, showSaved, close }) {
  const keyLabel = (bag.key || '').toString();
  const keyDisp = keyLabel.length === 1 ? keyLabel.toUpperCase() : (keyLabel === 'CapsLock' ? 'CAPS' : keyLabel.toUpperCase());
  return (
    <>
      <div className="rm-ov-bh">
        <div className="rm-ov-seg" role="group" aria-label="Radio">
          <button aria-pressed={sel === 'crew'} onClick={() => setSel('crew')}>Crew</button>
          <button aria-pressed={sel === 'cmd'}  onClick={() => setSel('cmd')}>Command</button>
        </div>
        <span style={{ flex: 1 }} />
        <button className="rm-ov-btn rm-ov-go" onClick={close}>Done</button>
      </div>
      <div className="rm-ov-cols">
        <div className="rm-row rm-ov-cfgrow" style={{ '--i': 0 }}>
          <span className="rm-ov-lb">Radio</span>
          <div className="rm-ov-c2">
            <button
              className="rm-ov-btn rm-ov-selbtn"
              onClick={() => { showSaved(); bag.openPicker(); }}
              title={bag.rig.label}
            >{bag.rig.short || bag.rig.label}</button>
          </div>
        </div>

        <div className="rm-row rm-ov-cfgrow" style={{ '--i': 1 }}>
          <span className="rm-ov-lb">PTT key</span>
          <div className="rm-ov-c2">
            <div className={`rm-cap${capturing ? ' rm-armed' : ''}${capLabel ? ' rm-bad' : ''}`}>
              {capturing && !capLabel ? (
                <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>Press a key…</span>
              ) : (
                <span className="rm-ov-key">{capLabel || keyDisp || '—'}</span>
              )}
            </div>
            <button
              className="rm-ov-btn"
              onClick={capturing ? cancelCapture : startCapture}
            >{capturing ? 'Cancel' : 'Change'}</button>
          </div>
        </div>

        <div className="rm-row rm-ov-cfgrow" style={{ '--i': 2 }}>
          <span className="rm-ov-lb">Lock tuner</span>
          <div className="rm-ov-c2">
            <span className="rm-ov-val">{bag.locked ? 'Locked' : 'Unlocked'}</span>
            <button
              className="rm-sw"
              role="switch"
              aria-checked={bag.locked}
              aria-label="Lock tuner"
              onClick={() => { bag.setLocked(v => !v); showSaved(); }}
            />
          </div>
        </div>

        <div className="rm-row rm-ov-cfgrow" style={{ '--i': 3 }}>
          <span className="rm-ov-lb">Receive</span>
          <div className="rm-ov-c2">
            {/* TODO: wire cue selection */}
            <select className="rm-ov-sel" defaultValue={sel === 'crew' ? 'crew-click' : 'cmd-click'}>
              <option value="crew-click">Crew click</option>
              <option value="cmd-click">Command click</option>
              <option value="silent">Silent</option>
            </select>
          </div>
        </div>
        {/* Row 4 (Pan) intentionally omitted — pan deprecated from UI. */}
      </div>
      <div className="rm-ov-foot">
        <span className={`rm-saved${savedShow ? ' rm-show' : ''}`}>
          <span>✓</span> Saved
        </span>
      </div>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────
const winStyle = {
  display: 'flex', flexDirection: 'column',
  width: '100vw', height: '100vh',
  background: 'var(--bg1, #0a1918)',
  color: 'var(--fg1, #e3faf6)',
  fontFamily: 'var(--font, Inter, system-ui, sans-serif)',
  overflow: 'hidden',
};

// Overlay-specific CSS. Prefixed `rm-ov-` to avoid colliding with the
// Dashboard mirror card styles. Reuses `.rm-row`, `.rm-cap`, `.rm-sw`,
// `.rm-saved` from radioMotion.css for the settings face.
const OVERLAY_CSS = `
.rm-ov-win { --gap: 6px; --pad: 8px; }
.rm-ov-faces { position: relative; overflow: hidden; transition: height var(--cfg-height-dur, 420ms) var(--cfg-height-ease, cubic-bezier(.45,0,.2,1)); }
.rm-ov-face { transition: transform var(--cfg-swap-dur, 420ms) var(--cfg-swap-ease, cubic-bezier(.2,.8,.2,1)), opacity var(--cfg-fade-dur, 280ms) var(--cfg-swap-ease), filter var(--cfg-fade-dur) var(--cfg-swap-ease); }
.rm-ov-front { padding: var(--pad); display: flex; flex-direction: column; gap: var(--gap); }
.rm-ov-back  { position: absolute; left: 0; right: 0; top: 0; padding: var(--pad); opacity: 0; transform: translateX(var(--cfg-back-in, 26px)); pointer-events: none; visibility: hidden; filter: blur(var(--cfg-blur, 2px)); display: flex; flex-direction: column; gap: 2px; }
.rm-ov-win.rm-ov-cfg .rm-ov-front { position: absolute; left: 0; right: 0; top: 0; opacity: 0; transform: translateX(var(--cfg-front-out, -26px)); pointer-events: none; filter: blur(var(--cfg-blur, 2px)); }
.rm-ov-win.rm-ov-cfg .rm-ov-back  { position: relative; opacity: 1; transform: none; pointer-events: auto; visibility: visible; filter: none; }
.rm-ov-win.rm-ov-closing .rm-ov-back { visibility: visible; }
.rm-ov-win.rm-ov-cfg .rm-ov-back .rm-ov-cfgrow {
  animation: rm-rowin var(--cfg-swap-dur, 420ms) var(--cfg-swap-ease, cubic-bezier(.2,.8,.2,1)) both;
  animation-delay: calc(var(--i) * var(--cfg-row-stagger, 38ms) + var(--cfg-row-offset, 120ms));
}

/* 7-column mirrored grid — identical on both rows. */
.rm-ov-rr {
  display: grid;
  grid-template-columns: 28px 96px 1fr 52px 28px 84px 28px;
  gap: var(--gap); align-items: center;
  height: 48px; padding: 0 6px;
  border: 1px solid var(--rim0); border-radius: 7px;
  background: var(--bg2);
  transition: border-color 280ms, box-shadow 280ms, opacity 280ms;
}
.rm-ov-rr.rm-ov-tx {
  border-color: color-mix(in srgb, var(--red) 58%, var(--bg0));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--red) 58%, var(--bg0)), 0 0 14px color-mix(in srgb, var(--red) 28%, transparent);
}
.rm-ov-rr.rm-ov-off { opacity: 0.55; }

.rm-ov-who { min-width: 0; line-height: 1.2; }
.rm-ov-who b { display: block; font: 700 11px Inter; letter-spacing: .1em; text-transform: uppercase; color: var(--cyan, #7ef0dc); }
.rm-ov-who span { display: block; font: 500 11px Inter; color: var(--fg2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.rm-ov-disp { height: 32px; display: flex; align-items: center; border-radius: 5px; background: var(--bg0); border: 1px solid var(--edge, var(--rim0)); overflow: hidden; }
.rm-ov-disp > div { flex: 1; }

.rm-ov-ib {
  width: 28px; height: 28px; display: grid; place-items: center;
  border-radius: 5px; border: 1px solid var(--rim1);
  background: linear-gradient(180deg, var(--bg3, #183230), var(--bg2));
  box-shadow: 0 1px 0 var(--hl) inset, 0 2px 0 var(--edge, var(--rim0));
  padding: 0; color: var(--fg1); cursor: pointer; font-size: 13px;
  transition: transform 90ms, border-color 160ms, filter 160ms;
}
.rm-ov-ib:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--cyan); filter: brightness(1.12); }
.rm-ov-ib:disabled { opacity: 0.5; cursor: not-allowed; }
.rm-ov-pw { color: color-mix(in srgb, var(--red) 55%, #fff); border-color: color-mix(in srgb, var(--red) 55%, var(--bg0)); }

.rm-ov-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  height: 28px; padding: 0 8px; border-radius: 5px;
  border: 1px solid var(--rim1);
  background: linear-gradient(180deg, var(--bg3, #183230), var(--bg2));
  box-shadow: 0 1px 0 var(--hl) inset, 0 2px 0 var(--edge, var(--rim0));
  font: 600 11px Inter; white-space: nowrap; color: var(--fg1); cursor: pointer;
  transition: transform 90ms, border-color 160ms, filter 160ms;
}
.rm-ov-btn:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--cyan); filter: brightness(1.12); }
.rm-ov-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.rm-ov-go {
  background: linear-gradient(180deg, color-mix(in srgb, var(--cyan) 34%, var(--bg0)), color-mix(in srgb, var(--cyan) 18%, var(--bg0)));
  border-color: color-mix(in srgb, var(--cyan) 58%, var(--bg0));
  color: var(--cyan);
}
.rm-ov-txb { width: 100%; user-select: none; -webkit-user-select: none; touch-action: none; }
.rm-ov-txb.rm-ov-on {
  background: linear-gradient(180deg, color-mix(in srgb, var(--red) 46%, var(--bg0)), color-mix(in srgb, var(--red) 28%, var(--bg0)));
  border-color: color-mix(in srgb, var(--red) 58%, var(--bg0));
  color: #fff;
  transform: translateY(1px);
}
.rm-ov-key {
  display: inline-grid; place-items: center; min-width: 18px; height: 18px;
  padding: 0 4px; border-radius: 4px; border: 1px solid var(--rim1);
  background: var(--bg0); font: 700 9px Inter; color: var(--cyan);
}

/* Mic strip */
.rm-ov-mic { display: flex; align-items: center; gap: 10px; height: 28px; padding: 0 8px; border-top: 1px solid var(--rim0); background: var(--bg1); }
.rm-ov-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--lime); box-shadow: 0 0 7px color-mix(in srgb, var(--lime) 65%, transparent); flex: none; }
.rm-ov-lab { font: 700 10px Inter; letter-spacing: .14em; text-transform: uppercase; color: var(--fg2); flex: none; }
.rm-ov-bar { flex: 1; height: 7px; border-radius: 4px; background: var(--bg0); border: 1px solid var(--edge, var(--rim0)); overflow: hidden; min-width: 40px; }
.rm-ov-bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--lime), color-mix(in srgb, var(--lime) 60%, var(--cyan))); transition: width 90ms linear; }
.rm-ov-sl { width: 120px; accent-color: var(--cyan); }
.rm-ov-pct { width: 34px; text-align: right; font-weight: 600; color: var(--fg2); font-size: 11px; font-variant-numeric: tabular-nums; }

/* Settings face bits */
.rm-ov-bh { display: flex; align-items: center; gap: 10px; padding-bottom: 6px; }
.rm-ov-seg { display: flex; border: 1px solid var(--rim1); border-radius: 6px; overflow: hidden; width: 200px; }
.rm-ov-seg button { flex: 1; height: 26px; border: 0; background: var(--bg0); color: var(--fg2); font: 700 10px Inter; letter-spacing: .12em; text-transform: uppercase; cursor: pointer; transition: background 160ms, color 160ms; }
.rm-ov-seg button[aria-pressed=true] { background: linear-gradient(180deg, color-mix(in srgb, var(--cyan) 34%, var(--bg0)), color-mix(in srgb, var(--cyan) 18%, var(--bg0))); color: var(--cyan); }
.rm-ov-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 16px; }
.rm-ov-cols .rm-row { min-height: 36px; border-bottom: 1px solid var(--edge, var(--rim0)); padding: 4px 0; }
.rm-ov-lb { flex: 0 0 70px; font: 700 10px Inter; letter-spacing: .14em; text-transform: uppercase; color: var(--fg2); white-space: nowrap; }
.rm-ov-c2 { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
.rm-ov-sel { height: 26px; min-width: 0; width: 100%; padding: 0 8px; border-radius: 5px; border: 1px solid var(--rim1); background: var(--bg0); color: var(--fg1); }
.rm-ov-selbtn { width: 100%; justify-content: flex-start; text-align: left; }
.rm-ov-val { color: var(--fg2); min-width: 52px; text-align: right; font-size: 11px; }
.rm-ov-foot { display: flex; align-items: center; justify-content: flex-end; padding: 4px 2px 0; min-height: 20px; }

/* ===== Motion set — matches Dashboard RadioModule's rm-* visuals =====
   Ported from /radio_overlay_layout.html (v2). Applied to rm-ov-rr so
   the overlay animations stay consistent with the big-view radio panels. */
.rm-ov-rr { position: relative; }
.rm-ov-rr::after {
  content: ""; position: absolute; inset: -1px; border-radius: inherit;
  pointer-events: none; opacity: 0;
}
/* TX: red pulse ring + red sweep inside the display */
.rm-ov-rr.rm-ov-tx::after {
  animation: rm-ov-ringr 1.1s cubic-bezier(.2,.8,.2,1) infinite;
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--red) 55%, transparent);
}
@keyframes rm-ov-ringr {
  0%   { opacity: 1; box-shadow: 0 0 0 0 color-mix(in srgb, var(--red) 55%, transparent); }
  100% { opacity: 0; box-shadow: 0 0 0 8px transparent; }
}
/* RX: green rim + green pulse ring, speaker name tinted green */
.rm-ov-rr.rm-ov-rx {
  border-color: color-mix(in srgb, var(--lime) 55%, var(--bg0));
}
.rm-ov-rr.rm-ov-rx::after {
  animation: rm-ov-ringg 1.4s cubic-bezier(.2,.8,.2,1) infinite;
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--lime) 50%, transparent);
}
@keyframes rm-ov-ringg {
  0%   { opacity: 1; box-shadow: 0 0 0 0 color-mix(in srgb, var(--lime) 50%, transparent); }
  100% { opacity: 0; box-shadow: 0 0 0 8px transparent; }
}
.rm-ov-who span.rm-ov-spk {
  color: color-mix(in srgb, var(--lime) 55%, #fff) !important;
  font-weight: 700 !important;
}

/* Lock: amber row rim, dimmed tuner controls, lock-button snap and deny */
.rm-ov-rr.rm-ov-locked { border-color: color-mix(in srgb, var(--amber, #FFBB33) 35%, var(--rim0)); }
.rm-ov-rr.rm-ov-locked .rm-ov-lockable { opacity: 0.5; }
.rm-ov-lk[aria-pressed="true"] {
  color: var(--amber, #FFBB33);
  border-color: color-mix(in srgb, var(--amber, #FFBB33) 58%, var(--bg0));
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--amber, #FFBB33) 16%, var(--bg0)),
    color-mix(in srgb, var(--amber, #FFBB33) 8%,  var(--bg0)));
}
.rm-ov-lk.rm-ov-snap { animation: rm-ov-snap 280ms cubic-bezier(.34,1.56,.64,1); }
@keyframes rm-ov-snap {
  0%   { transform: scale(.7) rotate(-18deg); }
  60%  { transform: scale(1.25) rotate(4deg); }
  100% { transform: none; }
}
.rm-ov-lk.rm-ov-deny {
  animation: rm-ov-shake 300ms linear;
  border-color: var(--amber, #FFBB33);
  color: var(--amber, #FFBB33);
}
@keyframes rm-ov-shake {
  0%,100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}

/* Display: tune flash, transmit sweep, power down/up */
.rm-ov-disp { position: relative; overflow: hidden; }
.rm-ov-disp.rm-ov-flash { animation: rm-ov-dflash 420ms cubic-bezier(.2,.8,.2,1); }
@keyframes rm-ov-dflash {
  0%   { box-shadow: inset 0 0 22px color-mix(in srgb, var(--cyan) 70%, transparent); }
  100% { box-shadow: inset 0 0 0 transparent; }
}
.rm-ov-disp::after {
  content: ""; position: absolute; top: 0; bottom: 0;
  width: 30%; left: -40%; pointer-events: none; opacity: 0;
  background: linear-gradient(90deg, transparent,
    color-mix(in srgb, var(--red) 30%, transparent), transparent);
}
.rm-ov-rr.rm-ov-tx .rm-ov-disp::after { opacity: 1; animation: rm-ov-sweep 1.4s linear infinite; }
@keyframes rm-ov-sweep { to { left: 120%; } }
.rm-ov-rr.rm-ov-off .rm-ov-disp { animation: rm-ov-pdn 340ms cubic-bezier(.45,0,.2,1) both; }
@keyframes rm-ov-pdn {
  0%   { transform: scale(1,1);   opacity: 1;   filter: brightness(1); }
  55%  { transform: scale(1,.04); opacity: 1;   filter: brightness(2.2); }
  100% { transform: scale(1,1);   opacity: .14; filter: none; }
}
.rm-ov-disp.rm-ov-pup { animation: rm-ov-pup 420ms cubic-bezier(.2,.8,.2,1); }
@keyframes rm-ov-pup {
  0%   { transform: scale(.3,.02); opacity: 0;   }
  35%  { transform: scale(1,.04);  opacity: 1;   filter: brightness(2.4); }
  55%  { transform: scale(1,1);    opacity: .3;  }
  65%  { opacity: 1; }
  75%  { opacity: .4; }
  100% { opacity: 1; filter: none; }
}
.rm-ov-rr.rm-ov-off .rm-ov-txb,
.rm-ov-rr.rm-ov-off .rm-ov-lockable { opacity: 0.4; }
`;
