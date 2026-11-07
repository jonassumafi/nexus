// Twin-tile radio — the new radio-only overlay layout, from
// radio_twin_tiles.html. Two side-by-side tiles (Crew + Command) with a
// shared mic strip on top. Tiles stack vertically under ~300 px.
//
// Hook plumbing is identical to RadioOverlay.jsx (Crew uses the
// transport-detected useRadioConnection/UDP hook; Command uses
// useCommandTunerRx), so every existing audio path — PTT key,
// transmit/receive chrome samples, per-peer voice filter — carries
// over unchanged. Only the visual layout and the peer-list affordance
// (chips + roster drawer instead of stacked peer rows) is new.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from '../context/AuthContext.jsx';
import { useRadioConnection } from '../hooks/useRadioConnection';
import { useRadioConnectionUDP } from '../hooks/useRadioConnectionUDP';
import { useCommandTunerRx } from '../hooks/useCommandTunerRx';
import useMyRadio from '../hooks/useMyRadio';
import { randomVoiceProfile } from '../utils/spacesuitFilter';
import api from '../services/api';

const PROFILE_FIELDS = [
  'highpass', 'lowpass', 'resonance_freq', 'resonance_q',
  'distortion', 'static_level', 'pitch_shift', 'bit_crush',
];

const STYLE_ID = 'radio-twin-tiles-styles';
function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.rtt {
  --under: color-mix(in srgb, var(--bg0) 55%, #000);
  --inset: color-mix(in srgb, var(--bg0) 60%, #000);
  --out:   cubic-bezier(.2,.8,.2,1);
  padding: 10px 12px 12px;
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px;
  background: linear-gradient(180deg, var(--bg1), var(--bg0));
  height: 100%; box-sizing: border-box; overflow: auto;
  font: 14px/1.5 Inter, system-ui, sans-serif;
  color: color-mix(in srgb, var(--cyan) 12%, #f2f6f8);
}
.rtt .raised { background: linear-gradient(180deg, var(--bg3), var(--bg2));
  border: 1px solid var(--rim0); border-radius: 4px;
  box-shadow: 0 1px 0 color-mix(in srgb, var(--cyan) 14%, transparent) inset,
              0 3px 0 var(--under), 0 6px 10px rgba(0,0,0,.35); }
.rtt .ib { width: 26px; height: 26px; flex: none; display: inline-grid; place-items: center;
  color: var(--fg2); border: 1px solid var(--rim1); border-radius: 3px;
  background: linear-gradient(180deg, var(--bg3), var(--bg2));
  box-shadow: 0 1px 0 color-mix(in srgb, var(--cyan) 16%, transparent) inset, 0 2px 0 var(--under);
  transition: transform .08s, color .15s, border-color .15s; cursor: pointer; }
.rtt .ib svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.rtt .ib:hover { color: var(--fg0); border-color: var(--blue); }
.rtt .ib:active { transform: translateY(2px); }
.rtt .ib.on { color: var(--cyan); border-color: var(--blue); }
.rtt .ib.red { color: #fff; border-color: var(--red); background: linear-gradient(180deg, #a8321f, #5e150b); }
.rtt .lcd { font: 700 17px/1.1 Inter, sans-serif; font-variant-numeric: tabular-nums; letter-spacing: .04em;
  text-align: center; color: var(--cyan); background: var(--inset); border-radius: 3px;
  padding: 5px 6px; box-shadow: 0 2px 6px #000 inset; flex: 1; min-width: 0;
  transition: color .2s; cursor: text; border: 1px solid transparent; }
.rtt .lcd.lk { cursor: not-allowed; }
.rtt input.lcd { width: 100%; border: 1px solid var(--blue); outline: none; }
.rtt .lrow { display: flex; gap: 6px; align-items: center; }
.rtt .txb { width: 100%; height: 30px; display: flex; align-items: center; justify-content: center; gap: 8px;
  font: 700 12px Inter; letter-spacing: .03em; text-transform: uppercase; color: var(--fg0);
  border: 1px solid var(--rim1); border-radius: 4px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--blue) 26%, var(--bg2)), color-mix(in srgb, var(--blue) 12%, var(--bg1)));
  box-shadow: 0 1px 0 color-mix(in srgb, var(--cyan) 22%, transparent) inset, 0 3px 0 var(--under);
  user-select: none; touch-action: none; transition: transform .08s, box-shadow .08s, color .15s; cursor: pointer; }
.rtt .txb:active, .rtt .txb.on { transform: translateY(3px);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--cyan) 22%, transparent) inset, 0 0 0 var(--under); }
.rtt .txb.on { color: #fff; border-color: var(--red);
  background: linear-gradient(180deg, #ff6a57, #a63020);
  box-shadow: 0 0 0 var(--under), 0 0 14px color-mix(in srgb, var(--red) 45%, transparent); }
.rtt .txb.dis { opacity: .42; transform: none !important;
  box-shadow: 0 3px 0 var(--under) !important; cursor: not-allowed; }
.rtt .txb kbd { font: 700 10px Inter; border: 1px solid color-mix(in srgb, var(--fg0) 28%, transparent);
  background: color-mix(in srgb, var(--bg0) 55%, #000); padding: 0 6px; border-radius: 2px; }
.rtt .led { width: 8px; height: 8px; border-radius: 50%; background: var(--lime);
  box-shadow: 0 0 6px var(--lime); flex: none; }
.rtt .led.off { background: var(--red); box-shadow: 0 0 6px var(--red); }
.rtt .mic { display: flex; align-items: center; gap: 8px; font: 600 11px Inter;
  letter-spacing: .05em; text-transform: uppercase; color: var(--fg2); padding: 2px 2px 0; }
.rtt .mic em { font-style: normal; color: var(--lime); text-transform: none; letter-spacing: .02em; }
.rtt .mic.mute em { color: var(--red); }
.rtt .mt { flex: 1; height: 6px; background: var(--inset); border: 1px solid var(--rim0);
  border-radius: 2px; overflow: hidden; }
.rtt .mt u { display: block; height: 100%; width: 0;
  background: linear-gradient(90deg, var(--lime), color-mix(in srgb, var(--lime) 60%, var(--amber)));
  transition: width .09s linear; }
.rtt .ms { display: grid; gap: 6px; padding: 8px 10px; background: var(--inset);
  border: 1px solid var(--rim0); border-radius: 4px; }
.rtt .ms label { display: grid; grid-template-columns: 58px 1fr 38px; gap: 8px; align-items: center;
  font: 600 10px Inter; letter-spacing: .06em; text-transform: uppercase; color: var(--fg2); }
.rtt .ms input { accent-color: var(--cyan); width: 100%; }
.rtt .ms b { text-align: right; color: var(--fg0); font-variant-numeric: tabular-nums; }
.rtt .tiles { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; align-items: stretch; }
.rtt .tiles.c1 { grid-template-columns: minmax(0, 1fr); }
.rtt .tile { padding: 8px; display: grid; gap: 6px; min-width: 0; align-content: start; }
.rtt .tile.tx { border-color: var(--red); }
.rtt .tile.tx .lcd { color: var(--red); }
.rtt .tile.off { opacity: .6; }
.rtt .tile.off .lcd { color: var(--fg2); }
.rtt .th2 { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; }
.rtt .th2 b { font: 700 12px Inter; letter-spacing: .07em; display: flex; align-items: center; gap: 7px; }
.rtt .th2 small { display: block; font: 500 10px Inter; color: var(--fg2); margin-top: 1px; }
.rtt .th2 .led.offc { background: var(--rim1); box-shadow: none; }
.rtt .cnt { display: flex; align-items: center; gap: 6px;
  font: 500 10.5px Inter; color: var(--fg2); min-height: 18px; width: 100%;
  border-radius: 3px; padding: 0 2px; }
.rtt button.cnt:hover { color: var(--fg0); }
.rtt .cnt .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--lime); font-weight: 600; }
.rtt .cnt .car { margin-left: auto; font-size: 9px; opacity: .7; transition: transform .16s; }
.rtt .cnt[aria-expanded=true] .car { transform: rotate(180deg); }
.rtt .cnt i.d { width: 6px; height: 6px; border-radius: 50%; background: var(--lime); flex: none; }
.rtt .cnt i.air { width: 6px; height: 6px; border-radius: 50%; background: var(--red);
  box-shadow: 0 0 6px var(--red); flex: none; }
.rtt .chips { display: flex; flex-wrap: wrap; gap: 4px; min-height: 22px; align-content: flex-start; }
.rtt .chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
  padding: 2px 7px; border-radius: 3px; border: 1px solid var(--rim0); background: var(--inset);
  font: 500 11px/1.45 Inter; color: var(--fg0);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rtt .chip.sp { border-color: var(--lime);
  box-shadow: 0 0 8px color-mix(in srgb, var(--lime) 25%, transparent); }
.rtt .eq { display: inline-flex; align-items: flex-end; gap: 1.5px; height: 10px; flex: none; }
.rtt .eq i { width: 2px; background: var(--lime); animation: rtt-eq .7s ease-in-out infinite; }
.rtt .eq i:nth-child(2) { animation-delay: .18s; }
.rtt .eq i:nth-child(3) { animation-delay: .36s; }
@keyframes rtt-eq { 0%, 100% { height: 2px; } 50% { height: 10px; } }
.rtt .more { font: 600 10.5px Inter; color: var(--cyan); padding: 2px 7px;
  border: 1px dashed var(--rim1); border-radius: 3px; background: transparent; cursor: pointer; }
.rtt .more:hover, .rtt .more[aria-expanded=true] { background: var(--bg3); border-style: solid; }
.rtt .nodata { font: 400 11px Inter; color: var(--fg2); padding: 3px 2px; }
.rtt .drawer { border: 1px solid var(--rim1); border-radius: 4px;
  background: var(--inset); overflow: hidden; }
.rtt .drh { display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 8px 6px 10px; border-bottom: 1px solid var(--rim0);
  font: 600 10.5px Inter; letter-spacing: .06em; text-transform: uppercase; color: var(--fg2); }
.rtt .drh b { color: var(--fg0); }
.rtt .drl { max-height: 152px; overflow-y: auto;
  display: grid; grid-template-columns: repeat(var(--dc, 2), minmax(0, 1fr));
  gap: 2px 10px; padding: 6px 10px;
  scrollbar-width: thin; scrollbar-color: var(--rim1) transparent; }
.rtt .drr { display: flex; align-items: center; gap: 7px; min-width: 0;
  padding: 3px 0; font: 500 12px Inter; color: var(--fg0); }
.rtt .av { width: 20px; height: 20px; border-radius: 50%; flex: none;
  background: radial-gradient(circle at 35% 30%, var(--rim1), var(--bg3));
  font: 600 8.5px Inter; color: var(--fg0); display: grid; place-items: center;
  box-shadow: 0 0 0 1px var(--rim0); }
.rtt .drr.sp .av { box-shadow: 0 0 0 2px var(--lime); }
.rtt .drr .nmn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rtt .drr .eq { margin-left: auto; }
@media (prefers-reduced-motion: reduce) { .rtt * { animation: none !important; transition: none !important; } }
`;
  document.head.appendChild(s);
}

function sh(n) { const s = String(n || ''); return s.length <= 12 ? s : s.slice(0, Math.max(6, Math.ceil(s.length / 2))) + '…'; }
function initials(n) { const w = String(n || '').replace(/[_-]+/g, ' ').split(' ').filter(Boolean); return (w.length > 1 ? w[0][0] + w[1][0] : (n || '').slice(0, 2)).toUpperCase(); }
const IC = {
  lock:   <svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>,
  unlock: <svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1"/></svg>,
  pwr:    <svg viewBox="0 0 16 16"><path d="M8 2v5.5"/><path d="M4.6 4.4a5 5 0 1 0 6.8 0"/></svg>,
  gear:   <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>,
  mic:    <svg viewBox="0 0 16 16"><rect x="6" y="2" width="4" height="7" rx="2"/><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5v2"/></svg>,
  micoff: <svg viewBox="0 0 16 16"><rect x="6" y="2" width="4" height="7" rx="2"/><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5v2M2 2l12 12"/></svg>,
  x:      <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>,
};

export default function RadioTwinTiles() {
  useEffect(() => { injectStyles(); }, []);
  const { user: me } = useAuthContext();

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
  const [micDeviceId]    = useState(() => localStorage.getItem('nexus_mic_device_id') || null);
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
  const [micOpen, setMicOpen] = useState(false);

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

  // Mic meter.
  const [micLevel, setMicLevel] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      const v = crew.getInputLevel?.() || 0;
      setMicLevel(Number.isFinite(v) ? v : 0);
    }, 90);
    return () => clearInterval(id);
  }, [crew]);

  // Window width — observe our own container.
  const rootRef = useRef(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const chipCap = width < 400 ? 3 : 5;
  const stack   = width < 300;

  // Frequency editing per tile.
  const [editing, setEditing] = useState(null); // 'crew' | 'command' | null
  const editRef = useRef(null);
  useEffect(() => { if (editing) editRef.current?.select(); }, [editing]);

  // Roster open per tile.
  const [rosterOpen, setRosterOpen] = useState(null); // 'crew' | 'command' | null
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (editing)    setEditing(null);
        else if (rosterOpen) setRosterOpen(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, rosterOpen]);

  const commitFreq = useCallback((which, raw) => {
    const hook = which === 'crew' ? crew : cmd;
    const n = Number(String(raw || '').trim().replace(',', '.'));
    if (!Number.isFinite(n) || n < 50 || n > 350) { setEditing(null); return; }
    const normalized = n.toFixed(1);
    try { hook.joinFrequency(normalized, which === 'cmd' ? undefined : null); } catch {}
    setEditing(null);
  }, [crew, cmd]);

  // Per-tile speaker detection.
  const txIds = useMemo(() => new Set((crew.transmittingPeerIds || []).filter(Boolean)), [crew.transmittingPeerIds]);
  const cmdTxIds = useMemo(() => new Set((cmd.transmittingPeerIds || []).filter(Boolean)), [cmd.transmittingPeerIds]);

  const tiles = [
    {
      id: 'crew', name: 'CREW', rig: crewRadio?.label || crewRadio?.id || '—',
      freq: crew.tunedFrequency || '', locked: crewLocked, setLocked: setCrewLocked,
      powered: crewPowered, setPowered: setCrewPowered,
      tx: !!crew.isPTTActive, peers: crew.peers || [], txIds,
      startPTT: () => crew.startPTT?.(), stopPTT: () => crew.stopPTT?.(),
      pttKey: (pttKey || 'v').toUpperCase(),
    },
    {
      id: 'command', name: 'COMMAND', rig: cmdRadio?.label || cmdRadio?.id || '—',
      freq: cmd.tunedFrequency || '', locked: cmdLocked, setLocked: setCmdLocked,
      powered: cmdPowered, setPowered: setCmdPowered,
      tx: !!cmd.isPTTActive, peers: cmd.peers || [], txIds: cmdTxIds,
      startPTT: () => cmd.startPTT?.(), stopPTT: () => cmd.stopPTT?.(),
      pttKey: (cmd.pttKey || 'c').toUpperCase(),
    },
  ];

  const cols = stack ? 1 : 2;

  return (
    <div ref={rootRef} className="rtt">
      {/* Mic strip */}
      <div className={`mic${muted ? ' mute' : ''}`}>
        <i className={`led${muted ? ' off' : ''}`} />
        <span>Mic <em>{muted ? 'Muted' : 'Active'}</em></span>
        <span className="mt"><u style={{ width: muted ? 0 : `${Math.min(100, micLevel * (micSensitivity / 100))}%` }} /></span>
        <button className={`ib${muted ? ' red' : ''}`} onClick={() => setMuted(m => !m)} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute microphone' : 'Mute microphone'}>
          {muted ? IC.micoff : IC.mic}
        </button>
        <button className={`ib${micOpen ? ' on' : ''}`} onClick={() => setMicOpen(o => !o)} aria-label="Mic settings" title="Mic settings">{IC.gear}</button>
      </div>
      {micOpen && (
        <div className="ms">
          <label>
            Outgoing
            <input type="range" min="0" max="150" step="5" value={micSensitivity} onChange={e => setMicSensitivity(Number(e.target.value))} />
            <b>{micSensitivity}%</b>
          </label>
          <label>
            Incoming
            <input type="range" min="0" max="150" step="5" value={rxVolume} onChange={e => setRxVolume(Number(e.target.value))} />
            <b>{rxVolume}%</b>
          </label>
        </div>
      )}

      {/* Tiles */}
      <div className={`tiles${cols === 1 ? ' c1' : ''}`}>
        {tiles.map(t => {
          const speakers = (t.peers || []).filter(p => t.txIds.has(p.socketId));
          const visible = [...(t.peers || [])].sort((a, b) => {
            const as = t.txIds.has(a.socketId) ? 0 : 1;
            const bs = t.txIds.has(b.socketId) ? 0 : 1;
            return as - bs;
          });
          const shown = visible.slice(0, chipCap);
          const more = visible.length - shown.length;
          const isEditing = editing === t.id;
          const isRosterOpen = rosterOpen === t.id;
          const dbl = !t.tx && speakers.length > 1;
          const txDisabled = muted || !t.powered;
          const statusInner = !t.powered
            ? (<><i className="d" style={{ background: 'var(--rim1)' }} /><span>Disconnected</span></>)
            : dbl
              ? (<><i className="air" /><span className="nm" style={{ color: 'var(--red)' }}>Double talk</span></>)
              : t.tx
                ? (<><i className="air" /><span className="nm" style={{ color: 'var(--red)' }}>You are on air</span></>)
                : speakers[0]
                  ? (<><span className="eq"><i /><i /><i /></span><span className="nm">{sh(speakers[0].citizenName || speakers[0].userId || 'Unknown')}</span></>)
                  : (<><i className="d" /><span>{visible.length} on frequency</span></>);
          return (
            <div key={t.id} className={`tile raised${t.powered ? '' : ' off'}${t.tx ? ' tx' : ''}`}>
              <div className="th2">
                <div>
                  <b><i className={`led${t.powered ? '' : ' offc'}`} />{t.name}</b>
                  <small>{t.rig}</small>
                </div>
                <button className={`ib${t.powered ? '' : ' red'}`} onClick={() => t.setPowered(p => !p)} aria-label={t.powered ? `Disconnect ${t.name}` : `Reconnect ${t.name}`} title={t.powered ? 'Disconnect' : 'Reconnect'}>{IC.pwr}</button>
              </div>
              <div className="lrow">
                {isEditing ? (
                  <input
                    ref={editRef}
                    className="lcd"
                    defaultValue={t.freq}
                    inputMode="decimal"
                    aria-label="Frequency"
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitFreq(t.id, e.currentTarget.value); }
                      if (e.key === 'Escape') { setEditing(null); }
                    }}
                    onBlur={() => setEditing(null)}
                  />
                ) : (
                  <button
                    className={`lcd${t.locked ? ' lk' : ''}`}
                    onClick={() => { if (!t.powered || t.locked) return; setEditing(t.id); }}
                    title={t.locked ? 'Frequency locked' : 'Click to type a frequency'}
                  >{t.freq || '—'}</button>
                )}
                <button className={`ib${t.locked ? ' on' : ''}`} onClick={() => t.setLocked(l => !l)} aria-label={t.locked ? 'Unlock' : 'Lock'} title={t.locked ? 'Unlock frequency' : 'Lock frequency'}>{t.locked ? IC.lock : IC.unlock}</button>
              </div>
              <button
                className={`txb${t.tx ? ' on' : ''}${txDisabled ? ' dis' : ''}`}
                aria-disabled={txDisabled}
                onPointerDown={e => { if (txDisabled) return; e.preventDefault(); t.startPTT(); }}
                onPointerUp={() => t.stopPTT()}
                onPointerCancel={() => t.stopPTT()}
              >
                {t.tx ? 'On air' : muted ? 'Mic muted' : !t.powered ? 'Off' : 'Transmit'} <kbd>{t.pttKey}</kbd>
              </button>
              {visible.length > 0 ? (
                <button className="cnt" aria-expanded={isRosterOpen} onClick={() => setRosterOpen(o => o === t.id ? null : t.id)} aria-label={`Show roster, ${visible.length} on frequency`}>
                  {statusInner}
                  <span className="car">▾</span>
                </button>
              ) : (
                <div className="cnt">{statusInner}</div>
              )}
              <div className="chips">
                {!t.powered
                  ? <span className="nodata">Disconnected</span>
                  : visible.length === 0
                    ? <span className="nodata">No other operators</span>
                    : (
                      <>
                        {shown.map(p => {
                          const name = p.citizenName || p.userId || 'Unknown';
                          const speaking = t.txIds.has(p.socketId);
                          return (
                            <span key={p.socketId || p.userId} className={`chip${speaking ? ' sp' : ''}`} title={name}>
                              {speaking && <span className="eq"><i /><i /><i /></span>}
                              {sh(name)}
                            </span>
                          );
                        })}
                        {more > 0 && (
                          <button className="more" aria-expanded={isRosterOpen} onClick={() => setRosterOpen(o => o === t.id ? null : t.id)}>
                            +{more}
                          </button>
                        )}
                      </>
                    )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Roster drawer */}
      {rosterOpen && (() => {
        const t = tiles.find(x => x.id === rosterOpen);
        if (!t || !t.powered) return null;
        return (
          <div className="drawer" role="region" aria-label={`${t.name} roster`}>
            <div className="drh">
              <span><b>{t.name}</b> · {t.peers.length} on frequency</span>
              <button className="ib" onClick={() => setRosterOpen(null)} aria-label="Close roster" title="Close">{IC.x}</button>
            </div>
            <div className="drl" style={{ '--dc': stack ? 1 : 2 }}>
              {t.peers.map(p => {
                const name = p.citizenName || p.userId || 'Unknown';
                const speaking = t.txIds.has(p.socketId);
                return (
                  <div key={p.socketId || p.userId} className={`drr${speaking ? ' sp' : ''}`} title={name}>
                    <span className="av">{initials(name)}</span>
                    <span className="nmn">{sh(name)}</span>
                    {speaking && <span className="eq"><i /><i /><i /></span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
