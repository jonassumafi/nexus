// Radio-only overlay — rebuilt from radio_roster_v2.html. Thin skin
// over the same radio engine the Full + Companion views use; no
// parallel state, no second copy of radio logic.
//
// Structure:
//   • Two chips side-by-side (CREW + CMD), a gear button beside them.
//     Clicking a chip selects it; always exactly one selected.
//     Double-click frequency to retune. Wheel over selected chip for
//     ±0.1 steps. Enter commits, Escape cancels, blur commits.
//   • Names-only roster right-aligned below the strip. Crew speakers
//     lime, Command speakers orange; linger 3 s after they stop.
//   • Red MUTED chip + red hairline beneath the strip when muted.
//   • Gear → one settings panel (click outside to close):
//     selected-radio lock/power, incoming/outgoing volume, mic input
//     device + sensitivity + mute + live meter, radio-type pickers,
//     opacity slider, Full-view button.
//
// Visual rules enforced:
//   • Skin tokens only (bg0..3, rim0/1, acc, acc2) plus lime/red/amber
//     and command-orange #ff9340. Never hardcode a skin color.
//   • Amber = selected chip, acc2 = locked, lime = speaking, orange =
//     command speaker, red = alerts / muted / double-talk.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from '../context/AuthContext.jsx';
import { useRadioConnection } from '../hooks/useRadioConnection';
import { useRadioConnectionUDP } from '../hooks/useRadioConnectionUDP';
import { useCommandTunerRx } from '../hooks/useCommandTunerRx';
import useMyRadio from '../hooks/useMyRadio';
import { randomVoiceProfile } from '../utils/spacesuitFilter';
import RadioPickerModal from './RadioPickerModal';
import api from '../services/api';
import { playMute, playUnmute } from '../utils/audioFx';

// Short mechanical cues shared with Full / Companion for the three
// radio-chrome toggles that live in this overlay. Lock + power reuse
// the same click samples the main view plays through radioChrome; we
// go direct via new Audio() so the overlay doesn't need an
// AudioContext of its own just for UI blips.
function playLockClose()  { try { new Audio('/sounds/click2.mp3').play().catch(() => {}); } catch {} }
function playLockOpen()   { try { new Audio('/sounds/click.mp3').play().catch(() => {}); }  catch {} }
function playPowerClick() { try { new Audio('/sounds/click.mp3').play().catch(() => {}); }  catch {} }

const PROFILE_FIELDS = [
  'highpass', 'lowpass', 'resonance_freq', 'resonance_q',
  'distortion', 'static_level', 'pitch_shift', 'bit_crush',
];

const CMD_ORANGE = '#ff9340';

const STYLE_ID = 'radio-overlay-v2-styles';
function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
:root { --cmd-orange: ${CMD_ORANGE}; }

.rov {
  --under: color-mix(in srgb, var(--bg0) 55%, #000);
  --inset: color-mix(in srgb, var(--bg0) 60%, #000);
  --t1: color-mix(in srgb, var(--acc2) 12%, #f2f6f8);
  --t2: color-mix(in srgb, var(--acc) 42%, #8a98a4);
  position: fixed; top: 0; right: 0;
  display: flex; flex-direction: column; align-items: flex-end;
  gap: 4px; width: max-content; min-width: 260px;
  padding: 2px 2px 4px 2px;
  font: 14px/1.5 Inter, system-ui, sans-serif;
  color: var(--t1);
  /* The overlay body is the drag handle. Interactive children (chips,
   * gear, settings controls, inputs, mute chip) opt back out below so
   * the player can still click them. Without this the only draggable
   * surface was the 4 px gap between chips — effectively unclickable. */
  -webkit-app-region: drag;
}
.rov button,
.rov input,
.rov select,
.rov textarea,
.rov [role="button"],
.rov .chip,
.rov .gearb,
.rov .mute,
.rov .sett,
.rov .roster .rw { -webkit-app-region: no-drag; }

.rov .glass {
  background: color-mix(in srgb, var(--bg0) 76%, transparent);
  border: 1px solid color-mix(in srgb, var(--rim0) 85%, transparent);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.rov .strip { display: flex; gap: 4px; align-self: stretch; align-items: center; }

.rov .chip {
  flex: 1; display: flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 8px; border-radius: 4px;
  position: relative; white-space: nowrap; cursor: pointer;
  transition: border-color .15s, box-shadow .15s, opacity .2s;
}
.rov .chip.sel {
  border-color: var(--amber);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--amber) 40%, transparent),
              0 0 12px color-mix(in srgb, var(--amber) 28%, transparent);
}
.rov .chip.sp .fr { color: var(--lime); }
.rov .chip.cmd .lab { color: var(--cmd-orange); }
.rov .chip.cmd.sp .fr { color: var(--cmd-orange); }
.rov .chip.off { opacity: .55; }
.rov .chip.off .fr { color: var(--t2); }
.rov .chip.dbl { animation: rov-dbl .4s steps(2) infinite; }
@keyframes rov-dbl {
  0%   { border-color: var(--red); box-shadow: 0 0 12px color-mix(in srgb, var(--red) 55%, transparent); }
  50%  { border-color: var(--rim0); box-shadow: none; }
}
.rov .chip.ring { animation: rov-ring .55s ease-out; }
@keyframes rov-ring {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--acc2) 85%, transparent); }
  100% { box-shadow: 0 0 0 9px transparent; }
}

.rov .led {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--lime); box-shadow: 0 0 6px var(--lime); flex: none;
}
.rov .led.off { background: var(--rim1); box-shadow: none; }
.rov .led.tx  { background: var(--red); box-shadow: 0 0 6px var(--red); }

.rov .lab {
  font: 600 9px Inter; letter-spacing: .09em; text-transform: uppercase;
  color: var(--t2);
}
.rov .fr {
  font: 700 12px Inter; font-variant-numeric: tabular-nums;
  color: var(--acc2); letter-spacing: .03em;
  padding: 0 2px; border-radius: 2px;
  min-width: 38px; text-align: center;
}
.rov .chip.lk .fr { color: var(--t1); }

.rov input.fi {
  width: 50px; font: 700 12px Inter;
  color: var(--acc2); background: var(--inset);
  border: 1px solid var(--amber); border-radius: 2px;
  outline: none; padding: 0 3px; text-align: center;
}

.rov .shake { animation: rov-shake .38s; }
@keyframes rov-shake {
  20% { transform: translateX(-4px); } 40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); } 80% { transform: translateX(2px); }
}

.rov svg.i { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

.rov .lkind { display: none; color: var(--acc2); place-items: center; }
.rov .chip.lk .lkind { display: inline-grid; }
.rov .lkind svg { width: 12px; height: 12px; }
.rov .lkbad { animation: rov-lkbad .5s; }
@keyframes rov-lkbad {
  0%, 100% { color: inherit; }
  30%      { color: var(--red); }
}
.rov .lkg .sh { transform-origin: 8px 11px; transition: transform .32s cubic-bezier(.3,1.8,.5,1); }
.rov .lkg.unl .sh { transform: rotate(-38deg) translate(-1px,-1px); }
.rov .pop1 { animation: rov-pop .45s cubic-bezier(.3,1.6,.5,1); }
@keyframes rov-pop {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.5); }
  100% { transform: scale(1); }
}

.rov .mute {
  display: none; align-items: center; gap: 5px;
  height: 24px; padding: 0 8px; border-radius: 4px;
  border-color: var(--red); color: var(--red);
  font: 700 9px Inter; letter-spacing: .09em; flex: none;
}
.rov .mute svg { width: 12px; height: 12px; }
.rov.muted .mute { display: flex; }

.rov .mtr {
  display: none; height: 2px; background: color-mix(in srgb, var(--red) 75%, transparent);
  align-self: stretch; border-radius: 1px;
}
.rov.muted .mtr { display: block; }

.rov .gearb {
  width: 24px; height: 24px; border-radius: 4px;
  align-self: center; display: inline-grid; place-items: center;
  color: var(--t2);
  background: color-mix(in srgb, var(--bg0) 76%, transparent);
  border: 1px solid color-mix(in srgb, var(--rim0) 85%, transparent);
  cursor: pointer; transition: color .15s, border-color .15s;
}
.rov .gearb svg { width: 12px; height: 12px; }
.rov .gearb:hover { color: var(--t1); border-color: var(--acc); }
.rov .gearb.open { color: var(--acc2); border-color: var(--acc2); }

.rov .roster {
  display: flex; flex-direction: column; gap: 1px;
  align-self: stretch; min-height: 0;
}
.rov .rw {
  display: flex; align-items: baseline; justify-content: flex-end;
  gap: 14px; height: 19px; padding: 0 3px;
  text-shadow: 0 1px 3px #000, 0 0 6px #000;
  transition: opacity .6s;
}
.rov .rw .n { font: 600 12.5px Inter; color: var(--t2); white-space: nowrap; }
.rov .rw.lit .n {
  color: var(--lime);
  text-shadow: 0 0 9px color-mix(in srgb, var(--lime) 65%, transparent), 0 1px 3px #000;
}
.rov .rw.cmd.lit .n {
  color: var(--cmd-orange);
  text-shadow: 0 0 9px color-mix(in srgb, var(--cmd-orange) 65%, transparent), 0 1px 3px #000;
}
.rov .rw.dbl .n { color: var(--red); animation: rov-fl .4s steps(2) infinite; }
.rov .rw.fade { opacity: 0; }
@keyframes rov-fl { 50% { opacity: .3; } }

.rov .sett {
  width: 246px; margin-top: 2px; padding: 9px 10px;
  border-radius: 6px;
  color: var(--t1); align-self: stretch;
}
.rov .sett h4 {
  font: 700 10px Inter; letter-spacing: .1em; text-transform: uppercase;
  color: var(--t1); margin-bottom: 4px;
}
.rov .sg { border-top: 1px solid var(--rim0); padding: 7px 0 2px; }
.rov .sg h5 {
  font: 700 9px Inter; letter-spacing: .1em; text-transform: uppercase;
  color: var(--acc); margin-bottom: 5px;
}
.rov .sg label {
  display: grid; grid-template-columns: 70px 1fr; align-items: center;
  gap: 8px; margin-bottom: 6px;
  font: 600 10px Inter; letter-spacing: .06em; text-transform: uppercase;
  color: var(--t2);
}
.rov .sg select {
  width: 100%; font: 500 11.5px Inter;
  color: var(--t1); background: var(--inset);
  border: 1px solid var(--rim1); border-radius: 3px;
  padding: 3px 4px; outline: none;
}
.rov .sg input[type=range] {
  width: 100%; accent-color: var(--acc2); height: 14px;
}
.rov .lv { height: 6px; background: var(--inset); border: 1px solid var(--rim0); border-radius: 2px; overflow: hidden; }
.rov .lv u {
  display: block; height: 100%; width: 0;
  background: linear-gradient(90deg, var(--lime), var(--amber));
  transition: width .08s;
}

.rov .ib {
  width: 24px; height: 22px; flex: none;
  display: inline-grid; place-items: center;
  color: var(--t2);
  border: 1px solid var(--rim1); border-radius: 3px;
  background: linear-gradient(180deg, var(--bg3), var(--bg2));
  box-shadow: 0 2px 0 var(--under);
  cursor: pointer;
}
.rov .ib svg { width: 12px; height: 12px; }
.rov .ib:hover { color: var(--t1); border-color: var(--acc); }
.rov .ib:active { transform: translateY(2px); box-shadow: none; }
.rov .ib.lockon { color: var(--acc2); border-color: var(--acc2); }
.rov .ib.bad { color: var(--red); border-color: var(--red); }

.rov .sel2 {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 6px;
}
.rov .selname {
  font: 700 10px Inter; letter-spacing: .09em; text-transform: uppercase;
  color: var(--amber);
  display: flex; align-items: center; gap: 6px;
}
.rov .mrow { display: flex; gap: 8px; align-items: center; }
.rov .mrow .lv { flex: 1; }

.rov .fvb {
  width: 100%; display: flex; align-items: center; justify-content: center;
  gap: 7px; height: 24px; margin-bottom: 4px;
  font: 700 10px Inter; letter-spacing: .06em; text-transform: uppercase;
  color: var(--t1);
  border: 1px solid var(--rim1); border-radius: 3px;
  background: linear-gradient(180deg, var(--bg3), var(--bg2));
  box-shadow: 0 2px 0 var(--under); cursor: pointer;
}
.rov .fvb svg { width: 12px; height: 12px; }
.rov .fvb:hover { border-color: var(--acc); }
.rov .fvb:active { transform: translateY(2px); box-shadow: none; }

.rov .rig-btn {
  font: 600 10px Inter; letter-spacing: .04em;
  color: var(--t1);
  border: 1px solid var(--rim1);
  background: var(--inset);
  height: 22px; border-radius: 3px; cursor: pointer; padding: 0 8px;
  text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  width: 100%;
}
.rov .rig-btn:hover { border-color: var(--acc); }

@media (prefers-reduced-motion: reduce) {
  .rov * { animation: none !important; transition: none !important; }
}
`;
  document.head.appendChild(s);
}

const LK_SVG = (unlocked) => (
  <svg className={`i lkg${unlocked ? ' unl' : ''}`} viewBox="0 0 24 24">
    <g className="sh"><path d="M8 11V8a4 4 0 0 1 8 0v3" /></g>
    <rect x="5" y="11" width="14" height="9" rx="2" />
  </svg>
);
const MIC_SVG = (
  <svg className="i" viewBox="0 0 24 24">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
const MICOFF_SVG = (
  <svg className="i" viewBox="0 0 24 24">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18" />
  </svg>
);
const GEAR_SVG = (
  <svg className="i" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
  </svg>
);
const POWER_SVG = (
  <svg className="i" viewBox="0 0 24 24">
    <path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0" />
  </svg>
);
const FULLVIEW_SVG = (
  <svg className="i" viewBox="0 0 24 24">
    <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
  </svg>
);

function shortName(n) {
  const s = String(n || '');
  return s.length <= 20 ? s : s.slice(0, 16) + '…';
}

// ────────────────────────────────────────────────────────────────────────

export default function RadioTwinTiles() {
  useEffect(() => { injectStyles(); }, []);
  const { user: me } = useAuthContext();

  // ─── Transport + hook setup (identical to the old version) ───────────
  const initialTransportRef = useRef((() => {
    try {
      if (import.meta.env.VITE_NEXUS_UDP_ONLY === '1') return 'udp';
      if (typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('udp') === '1') return 'udp';
    } catch {}
    return 'webrtc';
  })());

  const [voiceProfile, setVoiceProfile] = useState(null);
  const [pttKey, setPttKey] = useState(() => localStorage.getItem('nexus_ptt_key') || 'v');
  const [micDeviceId, setMicDeviceId] = useState(() => localStorage.getItem('nexus_mic_device_id') || null);
  const [outputDeviceId] = useState(() => localStorage.getItem('nexus_output_device_id') || null);
  const [micSensitivity, setMicSensitivity] = useState(() => {
    const v = Number(localStorage.getItem('nexus_mic_sensitivity'));
    return Number.isFinite(v) && v > 0 ? v : 100;
  });
  const [rxVolume, setRxVolume] = useState(() => {
    const v = Number(localStorage.getItem('nexus_rx_volume'));
    return Number.isFinite(v) && v >= 0 ? v : 100;
  });
  const [muted, setMuted] = useState(false);

  const [rigPicker, setRigPicker] = useState(null); // 'right' | 'left' | null

  const [crewLocked, setCrewLocked] = useState(() => localStorage.getItem('nexus_crew_locked') === '1');
  const [cmdLocked, setCmdLocked]   = useState(() => localStorage.getItem('nexus_command_locked') === '1');
  const [crewPowered, setCrewPowered] = useState(() => localStorage.getItem('nexus_crew_powered') !== '0');
  const [cmdPowered, setCmdPowered]   = useState(() => localStorage.getItem('nexus_command_powered') !== '0');
  useEffect(() => { localStorage.setItem('nexus_crew_locked', crewLocked ? '1' : '0'); }, [crewLocked]);
  useEffect(() => { localStorage.setItem('nexus_command_locked', cmdLocked ? '1' : '0'); }, [cmdLocked]);
  useEffect(() => { localStorage.setItem('nexus_crew_powered', crewPowered ? '1' : '0'); }, [crewPowered]);
  useEffect(() => { localStorage.setItem('nexus_command_powered', cmdPowered ? '1' : '0'); }, [cmdPowered]);

  const crew = (initialTransportRef.current === 'udp' ? useRadioConnectionUDP : useRadioConnection)({
    voiceProfile, voiceProfileVersion: 0, pttKey, micDeviceId, outputDeviceId, me,
  });
  const { radio: crewRadio } = useMyRadio({ tunerId: 'right' });
  const { radio: cmdRadio }  = useMyRadio({ tunerId: 'left' });
  const cmd = useCommandTunerRx({
    voiceProfile, srsSpec: cmdRadio?.spec || crewRadio?.spec || null,
    micDeviceId, outputDeviceId, locked: cmdLocked, otherPttKey: pttKey,
  });

  useEffect(() => { crew.setSrsRadioSpec?.(crewRadio?.spec || null); }, [crewRadio, crew]);
  useEffect(() => { crew.setSrsRadioBand?.(crewRadio?.band || 'VHF'); }, [crewRadio, crew]);
  useEffect(() => {
    localStorage.setItem('nexus_mic_sensitivity', String(micSensitivity));
    crew.setMicSensitivity?.(micSensitivity);
  }, [micSensitivity, crew]);
  useEffect(() => {
    localStorage.setItem('nexus_rx_volume', String(rxVolume));
    const v = rxVolume / 100;
    crew.setRxVolume?.(v);
    cmd.setRxVolume?.(v);
  }, [rxVolume, crew, cmd]);
  useEffect(() => {
    crew.setMuted?.(muted);
    cmd.setMuted?.(muted);
  }, [muted, crew, cmd]);
  useEffect(() => {
    if (crew.micPermission === 'prompt' || crew.micPermission === 'denied') crew.requestMicPermission?.();
  }, [crew.micPermission]); // eslint-disable-line react-hooks/exhaustive-deps

  // Voice profile once.
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

  // Mic meter (lives on-screen inside the settings panel while open).
  const [micLevel, setMicLevel] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      const v = crew.getInputLevel?.() || 0;
      setMicLevel(Number.isFinite(v) ? v : 0);
    }, 90);
    return () => clearInterval(id);
  }, [crew]);

  // ─── UI state ────────────────────────────────────────────────────────
  const [sel, setSel] = useState(0);              // 0 = crew, 1 = cmd
  const [editing, setEditing] = useState(null);   // 0 | 1 | null
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shakeTick, setShakeTick]   = useState({ 0: 0, 1: 0 });  // refuse-shake pulses
  const [ringTick, setRingTick]     = useState({ 0: 0, 1: 0 });  // lock-ring pulses
  const [lkbadTick, setLkbadTick]   = useState({ 0: 0, 1: 0 });  // lock-flash-red pulses

  const rootRef = useRef(null);
  const settingsRef = useRef(null);
  const gearRef = useRef(null);
  const editRef = useRef(null);

  // Measure the overlay root and tell main to match the window to it,
  // top-right-anchored. Fires every time the roster, strip or settings
  // panel changes size.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const api = window.electronAPI?.radio;
    if (!api?.resize) return;
    let last = { w: 0, h: 0 };
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        // offsetWidth/Height include padding + border; the measurement
        // the window needs. contentRect excludes padding, which would
        // leave a 4 px gap at the edges.
        const w = Math.ceil(el.offsetWidth);
        const h = Math.ceil(el.offsetHeight);
        if (w === last.w && h === last.h) continue;
        last = { w, h };
        try { api.resize(w, h); } catch {}
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (editing != null) { editRef.current?.focus(); editRef.current?.select(); } }, [editing]);

  // Click outside settings panel closes it.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e) => {
      if (settingsRef.current?.contains(e.target)) return;
      if (gearRef.current?.contains(e.target)) return;
      setSettingsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [settingsOpen]);

  // Escape: cancel editing first, otherwise close settings.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (editing != null)      setEditing(null);
      else if (settingsOpen)    setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, settingsOpen]);

  // Opacity (persisted). Applied natively on the Electron window.
  const [opacityPct, setOpacityPct] = useState(() => {
    const v = Number(localStorage.getItem('nexus_radio_opacity'));
    return Number.isFinite(v) && v >= 25 && v <= 100 ? v : 55;
  });
  useEffect(() => {
    try { localStorage.setItem('nexus_radio_opacity', String(opacityPct)); } catch {}
    try { window.electronAPI?.setOpacity?.(opacityPct / 100); } catch {}
  }, [opacityPct]);

  // Input device list (refreshes on devicechange).
  const [inputDevices, setInputDevices] = useState([]);
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const enumerate = () => {
      navigator.mediaDevices.enumerateDevices().then((devs) => {
        setInputDevices(devs.filter(d => d.kind === 'audioinput'));
      }).catch(() => {});
    };
    enumerate();
    navigator.mediaDevices.addEventListener?.('devicechange', enumerate);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', enumerate);
  }, []);

  // ─── Roster model ────────────────────────────────────────────────────
  // A "speaker" is identified by (channel, name). Keep a lingering map so
  // a name stays visible for 3 s after the person stops talking. Live set
  // is derived from the hook's transmittingPeerIds + peers.
  const txIds = useMemo(() => new Set((crew.transmittingPeerIds || []).filter(Boolean)), [crew.transmittingPeerIds]);
  const cmdTxIds = useMemo(() => new Set((cmd.transmittingPeerIds || []).filter(Boolean)), [cmd.transmittingPeerIds]);

  const liveSpeakers = useMemo(() => {
    const out = [];
    for (const p of (crew.peers || [])) {
      if (txIds.has(p.socketId)) out.push({ c: 0, name: p.citizenName || p.userId || 'Unknown' });
    }
    for (const p of (cmd.peers || [])) {
      if (cmdTxIds.has(p.socketId)) out.push({ c: 1, name: p.citizenName || p.userId || 'Unknown' });
    }
    return out;
  }, [crew.peers, cmd.peers, txIds, cmdTxIds]);

  const [recent, setRecent] = useState([]); // [{ c, name, t: lastSeen }]
  useEffect(() => {
    setRecent(prev => {
      const next = prev.slice();
      const liveKeys = new Set(liveSpeakers.map(s => `${s.c}:${s.name}`));
      // Refresh existing & add new.
      for (const s of liveSpeakers) {
        const k = `${s.c}:${s.name}`;
        const r = next.find(x => `${x.c}:${x.name}` === k);
        if (r) r.t = Date.now();
        else   next.push({ c: s.c, name: s.name, t: Date.now() });
      }
      // Prune after 3.2 s of silence (so the fade is visible).
      const cutoff = Date.now() - 3200;
      return next.filter(r => liveKeys.has(`${r.c}:${r.name}`) || r.t > cutoff);
    });
  }, [liveSpeakers]);

  // Keep re-rendering so names fade without a live event.
  const [, forceRender] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceRender(x => x + 1), 600);
    return () => clearInterval(id);
  }, []);

  // ─── Derived per-channel state ──────────────────────────────────────
  const crewLiveNames = useMemo(() => new Set(liveSpeakers.filter(s => s.c === 0).map(s => s.name)), [liveSpeakers]);
  const cmdLiveNames  = useMemo(() => new Set(liveSpeakers.filter(s => s.c === 1).map(s => s.name)), [liveSpeakers]);

  const crewTotalSpeakers = (crew.transmittingPeerIds || []).length + (crew.isPTTActive ? 1 : 0);
  const cmdTotalSpeakers  = (cmd.transmittingPeerIds  || []).length + (cmd.isPTTActive  ? 1 : 0);
  const crewDbl = crewTotalSpeakers > 1;
  const cmdDbl  = cmdTotalSpeakers  > 1;

  const chips = [
    {
      c: 0, label: 'CREW',
      freq: crew.tunedFrequency || '',
      locked: crewLocked, powered: crewPowered,
      tx: !!crew.isPTTActive,
      speaking: crewLiveNames.size > 0 || !!crew.isPTTActive,
      dbl: crewDbl,
    },
    {
      c: 1, label: 'CMD',
      freq: cmd.tunedFrequency || '',
      locked: cmdLocked, powered: cmdPowered,
      tx: !!cmd.isPTTActive,
      speaking: cmdLiveNames.size > 0 || !!cmd.isPTTActive,
      dbl: cmdDbl,
    },
  ];

  // ─── Actions ────────────────────────────────────────────────────────
  const refuse = (c) => {
    setShakeTick(prev => ({ ...prev, [c]: prev[c] + 1 }));
    setLkbadTick(prev => ({ ...prev, [c]: prev[c] + 1 }));
  };

  const beginEdit = (c) => {
    setSel(c);
    const ch = chips[c];
    if (ch.locked || !ch.powered) { refuse(c); return; }
    setEditing(c);
  };

  const commitFreq = useCallback((c, raw) => {
    const n = Number(String(raw || '').trim().replace(',', '.'));
    if (!Number.isFinite(n) || n < 50 || n > 350) { setEditing(null); return; }
    const normalized = n.toFixed(1);
    try {
      if (c === 0) crew.joinFrequency(normalized);
      else         cmd.joinFrequency(normalized);
    } catch {}
    setEditing(null);
  }, [crew, cmd]);

  const onWheel = (e) => {
    const chipEl = e.target.closest('[data-c]');
    if (!chipEl) return;
    const c = Number(chipEl.dataset.c);
    if (sel !== c || editing != null) return;
    e.preventDefault();
    const ch = chips[c];
    if (ch.locked || !ch.powered) { refuse(c); return; }
    const current = Number(ch.freq);
    if (!Number.isFinite(current)) return;
    const next = (current + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(1);
    try {
      if (c === 0) crew.joinFrequency(next);
      else         cmd.joinFrequency(next);
    } catch {}
  };

  const toggleLock = (c) => {
    if (c === 0) {
      setCrewLocked(l => { (l ? playLockOpen : playLockClose)(); return !l; });
    } else {
      setCmdLocked(l => { (l ? playLockOpen : playLockClose)(); return !l; });
    }
    setRingTick(prev => ({ ...prev, [c]: prev[c] + 1 }));
  };
  const togglePower = (c) => {
    playPowerClick();
    if (c === 0) setCrewPowered(p => !p);
    else         setCmdPowered(p => !p);
  };
  const toggleMute = () => {
    setMuted(m => { (m ? playUnmute : playMute)(); return !m; });
  };

  const goFull = () => {
    try { window.electronAPI?.setMode?.('full'); } catch {}
  };

  // ─── Render ─────────────────────────────────────────────────────────
  const selected = chips[sel];
  const selectedLocked = selected.locked;
  const selectedPowered = selected.powered;

  const nowTs = Date.now();

  return (
    <>
      <div ref={rootRef} className={`rov${muted ? ' muted' : ''}`}>
        {/* Strip */}
        <div className="strip" onWheel={onWheel}>
          {chips.map(ch => {
            const classes = ['chip', 'glass'];
            if (ch.c === 1) classes.push('cmd');
            if (sel === ch.c) classes.push('sel');
            if (ch.locked) classes.push('lk');
            if (!ch.powered) classes.push('off');
            if (ch.speaking && !ch.dbl) classes.push('sp');
            if (ch.dbl) classes.push('dbl');
            return (
              <div
                key={ch.c}
                className={classes.join(' ')}
                data-c={ch.c}
                onClick={(e) => {
                  if (e.target.closest('input')) return;
                  setSel(ch.c);
                }}
                onDoubleClick={(e) => {
                  const inFreq = e.target.closest('[data-x="fr"]');
                  if (!inFreq) return;
                  beginEdit(ch.c);
                }}
                title={ch.label}
              >
                <span
                  key={`ring-${ringTick[ch.c]}`}
                  className={`lkind pop1`}
                  aria-hidden="true"
                >
                  {LK_SVG(false)}
                </span>
                <i className={`led ${ch.tx ? 'tx' : (ch.powered ? '' : 'off')}`} />
                <span className="lab">{ch.label}</span>
                {editing === ch.c ? (
                  <input
                    ref={editRef}
                    className="fi"
                    defaultValue={ch.freq}
                    maxLength={5}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter')  { e.preventDefault(); commitFreq(ch.c, e.currentTarget.value); }
                      if (e.key === 'Escape') { setEditing(null); }
                    }}
                    onBlur={(e) => { if (editing === ch.c) commitFreq(ch.c, e.currentTarget.value); }}
                  />
                ) : (
                  <span
                    key={`shake-${shakeTick[ch.c]}`}
                    className="fr shake"
                    data-x="fr"
                    style={{ animation: shakeTick[ch.c] ? '' : 'none' }}
                  >{ch.freq || '—'}</span>
                )}
              </div>
            );
          })}
          <div className="mute glass" aria-hidden={!muted}>{MICOFF_SVG}MUTED</div>
          <button
            ref={gearRef}
            className={`gearb${settingsOpen ? ' open' : ''}`}
            title="Settings"
            onClick={(e) => { e.stopPropagation(); setSettingsOpen(o => !o); }}
          >
            {GEAR_SVG}
          </button>
        </div>

        {/* Thin red line under strip when muted */}
        <div className="mtr" />

        {/* Roster — names only, right-aligned */}
        <div className="roster">
          {recent.map(r => {
            const liveKey = `${r.c}:${r.name}`;
            const live = r.c === 0 ? crewLiveNames.has(r.name) : cmdLiveNames.has(r.name);
            const chDbl = r.c === 0 ? crewDbl : cmdDbl;
            const classes = ['rw'];
            if (r.c === 1) classes.push('cmd');
            if (chDbl && live) classes.push('dbl');
            else if (live)     classes.push('lit');
            else               classes.push('fade');
            return (
              <div key={liveKey} className={classes.join(' ')}>
                <span className="n">{shortName(r.name)}</span>
              </div>
            );
          })}
        </div>

        {/* Settings panel */}
        {settingsOpen && (
          <div ref={settingsRef} className="sett glass">
            <h4>Settings</h4>

            {/* Selected radio */}
            <div className="sg">
              <h5>Selected radio</h5>
              <div className="sel2">
                <span className="selname">{selected.label}</span>
                <span style={{ display: 'flex', gap: 4 }}>
                  <button
                    className={`ib${selectedLocked ? ' lockon' : ''}`}
                    onClick={() => toggleLock(sel)}
                    title={selectedLocked ? 'Unlock selected radio' : 'Lock selected radio'}
                  >
                    {LK_SVG(!selectedLocked)}
                  </button>
                  <button
                    className={`ib${selectedPowered ? '' : ' bad'}`}
                    onClick={() => togglePower(sel)}
                    title={selectedPowered ? 'Power off selected radio' : 'Power on selected radio'}
                  >
                    {POWER_SVG}
                  </button>
                </span>
              </div>
            </div>

            {/* Sound */}
            <div className="sg">
              <h5>Sound</h5>
              <label>
                Incoming
                <input
                  type="range" min="0" max="150" step="5"
                  value={rxVolume}
                  onChange={(e) => setRxVolume(Number(e.target.value))}
                />
              </label>
              <label>
                Outgoing
                <input
                  type="range" min="0" max="150" step="5"
                  value={micSensitivity}
                  onChange={(e) => setMicSensitivity(Number(e.target.value))}
                />
              </label>
            </div>

            {/* Microphone */}
            <div className="sg">
              <h5>Microphone</h5>
              <label>
                Input
                <select
                  value={micDeviceId || '__default__'}
                  onChange={(e) => {
                    const v = e.target.value === '__default__' ? null : e.target.value;
                    setMicDeviceId(v);
                    try {
                      if (v) localStorage.setItem('nexus_mic_device_id', v);
                      else   localStorage.removeItem('nexus_mic_device_id');
                    } catch {}
                  }}
                >
                  <option value="__default__">Default microphone</option>
                  {inputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>
                  ))}
                </select>
              </label>
              <label>
                Sensitivity
                <input
                  type="range" min="0" max="150" step="5"
                  value={micSensitivity}
                  onChange={(e) => setMicSensitivity(Number(e.target.value))}
                />
              </label>
              <label>
                Mic
                <span className="mrow">
                  <button
                    className={`ib${muted ? ' bad' : ''}`}
                    onClick={toggleMute}
                    title={muted ? 'Unmute microphone' : 'Mute microphone'}
                  >
                    {muted ? MICOFF_SVG : MIC_SVG}
                  </button>
                  <span className="lv"><u style={{ width: `${Math.min(100, (muted ? 0 : micLevel * (micSensitivity / 100)))}%` }} /></span>
                </span>
              </label>
            </div>

            {/* Radio type */}
            <div className="sg">
              <h5>Radio type</h5>
              <label>
                CREW
                <button
                  className="rig-btn"
                  onClick={() => setRigPicker('right')}
                  title="Change Crew radio"
                >{crewRadio?.label || crewRadio?.id || '—'}</button>
              </label>
              <label>
                CMD
                <button
                  className="rig-btn"
                  onClick={() => setRigPicker('left')}
                  title="Change Command radio"
                >{cmdRadio?.label || cmdRadio?.id || '(inherits)'}</button>
              </label>
            </div>

            {/* Display */}
            <div className="sg">
              <h5>Display</h5>
              <label>
                Opacity
                <input
                  type="range" min="25" max="100" step="1"
                  value={opacityPct}
                  onChange={(e) => setOpacityPct(Number(e.target.value))}
                />
              </label>
              <button className="fvb" onClick={goFull} title="Switch to Full view">
                {FULLVIEW_SVG}Full view
              </button>
            </div>
          </div>
        )}
      </div>

      {rigPicker && (
        <RadioPickerModal
          open
          tunerId={rigPicker}
          onClose={() => setRigPicker(null)}
        />
      )}
    </>
  );
}
