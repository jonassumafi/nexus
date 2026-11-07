// Companion mode — 324×640 pinned-dock layout.
//
// Six bands stack top → bottom:
//   1. TitleBar (toolbar icons live in its extras slot)
//   2. Profile band (avatar + name/rank + RP / missions)
//   3. Tabs band (Missions / Crew / Ships)
//   4. Content band (flex 1, scrolls)
//   5. Dock (pinned to bottom; slides front ↔ settings face)
//
// The dock holds two radio tiles (Crew left, Command right) + ONE shared
// mic strip. Tapping a tile's gear slides the whole dock to a settings
// face scoped to that radio. Content shrinks to let the dock grow but
// never past its 72px min-height, so the window never overflows.

import { useEffect, useMemo, useState, useCallback, useRef, Component } from 'react';
import { useAuthContext }   from '../context/AuthContext.jsx';
import { useRadioConnection } from '../hooks/useRadioConnection';
import { useRadioConnectionUDP } from '../hooks/useRadioConnectionUDP';
import { useCommandTunerRx } from '../hooks/useCommandTunerRx';
import useMyRadio from '../hooks/useMyRadio';
import { randomVoiceProfile } from '../utils/spacesuitFilter';
import { resolveAvatar, initialsOf } from '../utils/avatar';
import formatModel from '../utils/formatShipModel';
import api from '../services/api';
import TitleBar from '../components/TitleBar';
import UpdateCard from '../components/UpdateCard';
import useUpdateFlow from '../hooks/useUpdateFlow';
import FreqTuneInput from '../components/FreqTuneInput';
import SharedMicStrip from '../components/SharedMicStrip';
import RadioPickerModal from '../components/RadioPickerModal';
import { playTune } from '../utils/audioFx';
import '../components/radioMotion.css';

// ── Error boundary ────────────────────────────────────────────────────
class CompanionBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('[companion] crash:', err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    const electron = typeof window !== 'undefined' ? window.electronAPI : null;
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10,
        background: 'var(--bg0, #020C14)', color: 'var(--fg1, #9fb4c7)',
        fontFamily: 'var(--font, system-ui)', textAlign: 'center',
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red, #ff6b6b)', letterSpacing: '0.1em' }}>
          COMPANION ERROR
        </div>
        <div style={{ fontSize: 11, opacity: 0.8 }}>
          {String(this.state.err?.message || this.state.err || 'Unknown error')}
        </div>
        <button className="btn" onClick={() => electron?.setMode?.('full')}
          style={{ fontSize: 11, padding: '6px 12px' }}>
          Back to full dashboard
        </button>
      </div>
    );
  }
}

const PROFILE_FIELDS = [
  'highpass', 'lowpass', 'resonance_freq', 'resonance_q',
  'distortion', 'static_level', 'pitch_shift', 'bit_crush',
];

export default function CompanionExport() {
  return <CompanionBoundary><Companion /></CompanionBoundary>;
}

// Pick transport once at mount — hooks can't be swapped mid-render.
// Radio presets come from the backend as { id, label, band, family, blurb }.
// The visible "short" form is the last word of the label (e.g. "VX-51
// Fieldmaster" → "Fieldmaster"). Mirrors Dashboard/CrewRadioCard's helper.
function shortOfLabel(label) {
  if (!label) return '';
  const parts = String(label).trim().split(/\s+/);
  return parts[parts.length - 1] || label;
}

const initialTransport = (() => {
  try {
    if (import.meta.env.VITE_NEXUS_UDP_ONLY === '1') return 'udp';
    if (typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('udp') === '1') return 'udp';
  } catch {}
  return 'webrtc';
})();

function Companion() {
  const { user: jwtUser } = useAuthContext();
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;
  const updateFlow = useUpdateFlow();

  // Full operator record
  const [me, setMe] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get('/auth/me').then(({ data }) => { if (!cancelled) setMe(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const user = me || jwtUser || null;

  // ── Voice / radio state ────────────────────────────────────────────
  const [voiceProfile, setVoiceProfile]     = useState(null);
  const [profileVersion] = useState(0);
  const [pttKey, setPttKeyState] = useState(() => localStorage.getItem('nexus_ptt_key') || 'v');
  const [micSensitivity, setMicSensitivity] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  // Incoming playback volume — shared with the rest of the app via
  // localStorage. main.jsx runs a one-time migration that seeds this
  // to 100 for new installs and rescales legacy pre-quadratic values.
  const [rxVolume, setRxVolume] = useState(() => {
    const v = Number(localStorage.getItem('nexus_rx_volume'));
    return Number.isFinite(v) && v >= 0 && v <= 150 ? v : 100;
  });
  useEffect(() => {
    try { localStorage.setItem('nexus_rx_volume', String(rxVolume)); } catch {}
  }, [rxVolume]);
  const [crewLocked, setCrewLocked] = useState(false);
  const [crewPowered, setCrewPowered] = useState(true);
  const [commandLocked, setCommandLocked] = useState(false);
  const [commandPowered, setCommandPowered] = useState(true);
  const [micDeviceId]    = useState(() => localStorage.getItem('nexus_mic_device_id') || null);
  const [outputDeviceId] = useState(() => localStorage.getItem('nexus_output_device_id') || null);

  const useCrewHook = initialTransport === 'udp' ? useRadioConnectionUDP : useRadioConnection;
  const crew = useCrewHook({
    voiceProfile, voiceProfileVersion: profileVersion,
    pttKey, micDeviceId, outputDeviceId, me,
  });

  const { radio: myRadio } = useMyRadio();
  const { radio: myCommandRadio } = useMyRadio({ tunerId: 'left' });

  useEffect(() => { crew.setSrsRadioSpec?.(myRadio?.spec || null); }, [myRadio, crew.setSrsRadioSpec]);
  useEffect(() => { crew.setSrsRadioBand?.(myRadio?.band || 'VHF'); }, [myRadio, crew.setSrsRadioBand]);
  useEffect(() => { crew.setMuted?.(isMuted); }, [isMuted, crew.setMuted]);
  useEffect(() => { crew.setMicSensitivity?.(micSensitivity); }, [micSensitivity, crew.setMicSensitivity]);

  // Command tuner
  const command = useCommandTunerRx({
    voiceProfile,
    srsSpec: myCommandRadio?.spec || null,
    micDeviceId, outputDeviceId,
    otherPttKey: pttKey,
    locked: commandLocked,
  });

  // Push the incoming volume into both hooks so the slider actually
  // governs peer loudness in Companion view, not just UI state. Must sit
  // below both hook calls — referencing `command` in the deps array
  // before its declaration above was the TDZ crash ("Cannot access
  // 'command' before initialization") that broke every Companion switch
  // since 0.9.24.
  useEffect(() => {
    const v = rxVolume / 100;
    crew.setRxVolume?.(v);
    command.setRxVolume?.(v);
  }, [rxVolume, crew.setRxVolume, command.setRxVolume]);

  // Persist pttKey helper
  const setPttKey = useCallback((k) => {
    setPttKeyState(k);
    try { localStorage.setItem('nexus_ptt_key', k); } catch {}
  }, []);

  // Load voice profile
  useEffect(() => {
    let cancelled = false;
    api.get('/users/voice-profile').then(({ data }) => {
      if (cancelled) return;
      if (data?.ptt_key) setPttKey(data.ptt_key);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data fetches
  const [missions, setMissions] = useState([]);
  const [myShips, setMyShips]   = useState([]);
  useEffect(() => {
    api.get('/missions').then(({ data }) => setMissions(Array.isArray(data) ? data : [])).catch(() => setMissions([]));
    api.get('/ships/mine').then(({ data }) => setMyShips(Array.isArray(data) ? data : [])).catch(() => setMyShips([]));
  }, []);

  const myMissionId = user?.current_mission_assignment?.mission_id;
  const myMission = myMissionId ? missions.find(m => String(m._id) === String(myMissionId)) : null;

  // Pin state
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!electron?.onWindowState) return;
    return electron.onWindowState((s) => {
      if (s && typeof s.pinned === 'boolean') setPinned(s.pinned);
    });
  }, [electron]);

  // Tabs
  const [activeTab, setActiveTab] = useState('missions');

  // Real backend statuses: "WAITING FOR CREW", "FINALIZED", "IN PROGRESS",
  // "COMPLETE", "ABORT". "Open" for the Companion means a mission still
  // accepting crew — WAITING FOR CREW or FINALIZED. Previous filter checked
  // for a lowercase "waiting" that never existed, so the list was always empty.
  const openMissions = useMemo(
    () => missions
      .filter(m => {
        const s = String(m.status || '').toUpperCase();
        return s === 'WAITING FOR CREW' || s === 'FINALIZED';
      })
      .slice(0, 20),
    [missions]
  );

  // Real data: primary_ship + supporting_ships[], each ship carries crew_roles
  // (not crew_slots), and role entries key `slots` (not `capacity`). Previous
  // reads returned empty, so the Crew tab always said "No active mission crew."
  const crewRoster = useMemo(() => {
    const ships = myMission
      ? [myMission.primary_ship, ...(myMission.supporting_ships || [])].filter(Boolean)
      : [];
    if (!ships.length) return [];
    const out = [];
    for (const ship of ships) {
      for (const [roleName, role] of Object.entries(ship.crew_roles || {})) {
        for (const occupant of (role.filled || [])) {
          out.push({
            name: occupant?.citizen_name || 'Operator',
            status: roleName,
            open: false,
          });
        }
        const total = role.slots || role.capacity || 0;
        const openCount = Math.max(0, total - (role.filled || []).length);
        for (let i = 0; i < openCount; i++) {
          out.push({ name: null, status: roleName, open: true });
        }
      }
    }
    return out;
  }, [myMission]);

  const [joiningId, setJoiningId] = useState(null);
  const joinMission = useCallback(async (mission) => {
    if (!mission?._id) return;
    setJoiningId(mission._id);
    try {
      const ship = (mission.ships || [])[0];
      const roleName = ship && Object.keys(ship.crew_slots || {}).find(r => {
        const s = ship.crew_slots[r];
        return (s.filled || []).length < (s.capacity || 0);
      });
      if (ship && roleName) {
        await api.post('/crew/reserve', {
          mission_id: mission._id,
          ship_id: ship.ship?._id || ship._id,
          role: roleName,
        });
      }
    } catch {}
    setJoiningId(null);
  }, []);

  // ── Dock / settings slide state ───────────────────────────────────
  const [openSettingsTuner, setOpenSettingsTuner] = useState(null); // 'crew' | 'command' | null
  const [cfgClosing, setCfgClosing] = useState(false);
  const facesRef = useRef(null);
  const frontRef = useRef(null);
  const backRef = useRef(null);

  const animateFaces = useCallback((opening) => {
    const f = facesRef.current;
    if (!f) return;
    const from = f.getBoundingClientRect().height;
    let to;
    if (opening) {
      const back = backRef.current;
      const prevVis = back.style.visibility;
      back.style.visibility = 'visible';
      to = back.offsetHeight;
      back.style.visibility = prevVis;
    } else {
      to = frontRef.current?.offsetHeight || 0;
    }
    f.style.height = from + 'px';
    void f.offsetHeight;
    f.style.height = to + 'px';
    const clear = () => { f.style.height = ''; f.removeEventListener('transitionend', onEnd); };
    const onEnd = (e) => { if (e.target === f && e.propertyName === 'height') clear(); };
    f.addEventListener('transitionend', onEnd);
    setTimeout(clear, 700);
  }, []);

  const openCfg = useCallback((which) => {
    const wasOpen = !!openSettingsTuner;
    setOpenSettingsTuner(which);
    if (!wasOpen) requestAnimationFrame(() => animateFaces(true));
  }, [openSettingsTuner, animateFaces]);

  const closeCfg = useCallback(() => {
    if (!openSettingsTuner) return;
    setCfgClosing(true);
    setOpenSettingsTuner(null);
    requestAnimationFrame(() => {
      animateFaces(false);
      setTimeout(() => setCfgClosing(false), 460);
    });
  }, [openSettingsTuner, animateFaces]);

  useEffect(() => {
    if (!openSettingsTuner) return;
    const onKey = (e) => { if (e.key === 'Escape') closeCfg(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSettingsTuner, closeCfg]);

  // ── Toolbar icon buttons (in TitleBar.extras) ─────────────────────
  const [showRigPicker, setShowRigPicker] = useState(null); // 'crew' | 'command' | null
  const toolbarExtras = (
    <>
      <IconBtn title={pinned ? 'Unpin' : 'Pin on top'}
        onClick={async () => { if (!electron) return; const next = await electron.togglePin(); setPinned(next); }}
        pressed={pinned}>⌖</IconBtn>
      <IconBtn title="Full dashboard" onClick={() => electron?.setMode?.('full')}>▦</IconBtn>
      <IconBtn title="Radio-only" onClick={() => electron?.setMode?.('radio')}>▬</IconBtn>
    </>
  );

  // ── Radio action plumbing ────────────────────────────────────────
  const onCrewCommitFreq = useCallback((raw) => {
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n) || n < 50 || n > 350) return;
    try { crew.joinFrequency?.(n.toFixed(1), null); } catch {}
  }, [crew.joinFrequency]);
  const onCommandCommitFreq = useCallback((raw) => {
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n) || n < 50 || n > 350) return;
    try { command.joinFrequency?.(n.toFixed(1), null); } catch {}
  }, [command.joinFrequency]);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="cmp-drag" style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font)', color: 'var(--fg1)',
      background: 'var(--bg0)', overflow: 'hidden',
    }}>
      {/* Companion body = drag region. Interactive elements below still
          get clicks because they override back to no-drag via the rule
          below. Lets the user grab any empty area to move the window,
          not just the 30px titlebar. */}
      <style>{`
        .cmp-drag { -webkit-app-region: drag; }
        .cmp-drag button,
        .cmp-drag input,
        .cmp-drag select,
        .cmp-drag textarea,
        .cmp-drag a,
        .cmp-drag [role="button"],
        .cmp-drag [contenteditable="true"] { -webkit-app-region: no-drag; }
      `}</style>
      <TitleBar subtitle="Companion" compact />
      <UpdateCard flow={updateFlow} compact />

      {/* Dedicated toolbar band below the titlebar — the 324px window
          can't fit mode switchers + version chips + window controls on
          one 30px row without clipping. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 8px', height: 32, flex: 'none',
        borderBottom: '1px solid var(--rim0)',
        background: 'var(--bg1)',
      }}>
        <span style={{ flex: 1 }} />
        {toolbarExtras}
      </div>

      <ProfileBand user={user} />

      <TabsBand activeTab={activeTab} setActiveTab={setActiveTab} />

      <div style={{
        flex: '1 1 auto', minHeight: 72, overflowY: 'auto',
        padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {activeTab === 'missions' && (
          openMissions.length === 0
            ? <div style={emptyStyle}>No open missions.</div>
            : openMissions.map(m => (
                <MissionItem key={m._id} m={m}
                  onJoin={() => joinMission(m)}
                  joining={joiningId === m._id} />
              ))
        )}
        {activeTab === 'crew' && (
          crewRoster.length === 0
            ? <div style={emptyStyle}>No active mission crew.</div>
            : crewRoster.map((c, i) => (
                <div key={i} style={{
                  ...itemStyle,
                  // Open-slot rows get a dashed border + muted palette so they
                  // read as "need to be filled" without stealing focus.
                  ...(c.open ? {
                    borderStyle: 'dashed',
                    borderColor: 'color-mix(in srgb, var(--amber, #FFBB33) 40%, var(--rim0))',
                    background: 'color-mix(in srgb, var(--amber, #FFBB33) 6%, var(--bg2))',
                  } : null),
                }}>
                  <b style={{
                    ...itemTitleStyle,
                    ...(c.open ? {
                      color: 'color-mix(in srgb, var(--amber, #FFBB33) 55%, #fff)',
                      letterSpacing: '0.14em',
                      fontSize: 10,
                    } : null),
                  }}>{c.open ? 'SLOT OPEN' : (c.name || 'Operator')}</b>
                  <span style={itemSubStyle}>{c.status}</span>
                </div>
              ))
        )}
        {activeTab === 'ships' && (
          myShips.length === 0
            ? <div style={emptyStyle}>No ships registered.</div>
            : myShips.map(s => {
                // Status logic:
                //   - On mission (claimed but not yet launched): "On mission"
                //   - On a mission currently IN PROGRESS: "Active"
                //   - Otherwise: the ship's model/type
                const mid = s.current_mission_id;
                let statusText = formatModel(s.type || s.ship_model) || 'Idle';
                if (mid) {
                  const assigned = missions.find(mx => String(mx._id) === String(mid));
                  const running = String(assigned?.status || '').toUpperCase() === 'IN PROGRESS';
                  statusText = running ? 'Active' : 'On mission';
                }
                return (
                  <div key={s._id} style={itemStyle}>
                    <b style={itemTitleStyle}>{s.ship_name || 'Unnamed ship'}</b>
                    <span style={itemSubStyle}>{statusText}</span>
                  </div>
                );
              })
        )}
      </div>

      {/* Dock */}
      <div
        className={
          'rm-mod' +
          (openSettingsTuner ? ' rm-cfg' : '') +
          (cfgClosing ? ' rm-closing' : '')
        }
        style={{
          flex: 'none',
          borderTop: '1px solid var(--rim1)',
          background: 'var(--bg1)',
          boxShadow: '0 -6px 14px rgba(0,0,0,.35)',
          borderRadius: 0,
        }}
      >
        <div className="rm-faces" ref={facesRef}>
          <div className="rm-face rm-front" ref={frontRef} style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <RadioTile
                role="Crew"
                rigShort={shortOfLabel(myRadio?.label)}
                rigLabel={myRadio ? `${myRadio.band} · ${myRadio.label}` : ''}
                freq={crew.tunedFrequency || ''}
                pttKey={pttKey}
                isTx={!!crew.isPTTActive}
                isLive={(crew.peers || []).length > 0}
                locked={crewLocked}
                powered={crewPowered}
                onCommitFreq={onCrewCommitFreq}
                onPowerToggle={() => setCrewPowered(p => !p)}
                onLockToggle={() => setCrewLocked(l => !l)}
                onPttDown={() => { if (!isMuted && crewPowered) crew.startPTT?.(); }}
                onPttUp={() => crew.stopPTT?.()}
                onOpenSettings={() => openCfg('crew')}
                settingsOpen={openSettingsTuner === 'crew'}
              />
              <RadioTile
                role="Command"
                rigShort={shortOfLabel(myCommandRadio?.label)}
                rigLabel={myCommandRadio ? `${myCommandRadio.band} · ${myCommandRadio.label}` : '(inherits primary)'}
                freq={command.tunedFrequency || ''}
                pttKey={command.pttKey || 'CAPSLOCK'}
                isTx={!!command.isPTTActive}
                isLive={(command.peers || []).length > 0}
                locked={commandLocked}
                powered={commandPowered}
                onCommitFreq={onCommandCommitFreq}
                onPowerToggle={() => setCommandPowered(p => !p)}
                onLockToggle={() => setCommandLocked(l => !l)}
                onPttDown={() => { if (!isMuted && commandPowered) command.startPTT?.(); }}
                onPttUp={() => command.stopPTT?.()}
                onOpenSettings={() => openCfg('command')}
                settingsOpen={openSettingsTuner === 'command'}
              />
            </div>

            <SharedMicStrip
              compact
              getLevel={crew.getInputLevel}
              sensitivity={micSensitivity}
              setSensitivity={setMicSensitivity}
              rxVolume={rxVolume}
              setRxVolume={setRxVolume}
              isActive={!isMuted}
              isMuted={isMuted}
              onToggleMute={() => setIsMuted(m => !m)}
              peersCount={(() => {
                // Combined unique operators across both tuners.
                const ids = new Set();
                for (const p of (crew.peers || []))    if (p?.socketId || p?.userId) ids.add(String(p.socketId || p.userId));
                for (const p of (command.peers || [])) if (p?.socketId || p?.userId) ids.add(String(p.socketId || p.userId));
                return ids.size;
              })()}
            />

            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              color: 'var(--fg3)', fontSize: 11,
            }}>
              <button
                onClick={() => { /* TODO Volume · Pan advanced */ }}
                style={{
                  background: 'none', border: 0, padding: 0, cursor: 'pointer',
                  color: 'var(--fg2)',
                  font: '700 10px Inter', letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                }}
              >Volume · Pan</button>
              <span style={{ flex: 1 }} />
              <span style={{
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
              }}>
                SELCAL on my transmit · hold a key to TX
              </span>
            </div>

            {crew.micPermission === 'denied' && (
              <div style={{ fontSize: 10, color: 'var(--red)', textAlign: 'center' }}>
                Mic blocked — grant access in system settings.
              </div>
            )}
            {crew.micPermission === 'prompt' && (
              <button
                onClick={() => crew.requestMicPermission?.()}
                style={{
                  background: 'none', border: '1px solid var(--rim1)', borderRadius: 4,
                  padding: '4px 8px', color: 'var(--cyan)', fontSize: 10, cursor: 'pointer',
                }}
              >Grant mic access</button>
            )}
          </div>

          <div className="rm-face rm-back" ref={backRef} aria-hidden={!openSettingsTuner}
               style={{ padding: 8, display: 'flex', flexDirection: 'column' }}>
            <SettingsFace
              which={openSettingsTuner || 'crew'}
              onPick={(w) => openCfg(w)}
              crewState={{
                rig: myRadio, pttKey, setPttKey,
                locked: crewLocked, setLocked: setCrewLocked,
                openRigPicker: () => setShowRigPicker('crew'),
              }}
              commandState={{
                rig: myCommandRadio,
                pttKey: command.pttKey || 'CAPSLOCK',
                setPttKey: (k) => command.setPttKey?.(k),
                locked: commandLocked, setLocked: setCommandLocked,
                openRigPicker: () => setShowRigPicker('command'),
              }}
              otherPttKey={openSettingsTuner === 'crew' ? (command.pttKey || 'CAPSLOCK') : pttKey}
              onDone={closeCfg}
            />
          </div>
        </div>
      </div>

      <RadioPickerModal
        open={!!showRigPicker}
        onClose={() => setShowRigPicker(null)}
        tunerId={showRigPicker === 'command' ? 'left' : 'right'}
      />
    </div>
  );
}

// ─── Toolbar icon button ────────────────────────────────────────────
function IconBtn({ title, onClick, pressed, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={pressed ? 'true' : undefined}
      style={{
        WebkitAppRegion: 'no-drag',
        width: 28, height: 22, padding: 0,
        display: 'grid', placeItems: 'center',
        borderRadius: 5, border: '1px solid var(--rim1)',
        background: pressed
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--cyan) 34%, var(--bg0)), color-mix(in srgb, var(--cyan) 18%, var(--bg0)))'
          : 'linear-gradient(180deg, var(--bg3, #183230), var(--bg2))',
        color: pressed ? 'var(--cyan)' : 'var(--fg1)',
        cursor: 'pointer', fontSize: 11,
      }}
    >{children}</button>
  );
}

// ─── Profile band ───────────────────────────────────────────────────
function ProfileBand({ user }) {
  const name = user?.citizen_name || user?.username || '—';
  const rank = user?.rp_rank?.title || 'Drifter';
  const initials = initialsOf(name);
  const avatarSrc = resolveAvatar(user);
  const rp = user?.total_rp ?? '—';
  const mc = user?.missions_completed ?? '—';
  return (
    <div style={{
      flex: 'none', height: 56,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '0 10px',
      borderBottom: '1px solid var(--edge, var(--rim0))',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        display: 'grid', placeItems: 'center',
        background: 'var(--bg3)', border: '1px solid var(--rim1)',
        color: 'var(--cyan)', font: '700 12px Inter',
        flex: 'none', overflow: 'hidden',
      }}>
        {avatarSrc
          ? <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{
          display: 'block', font: '700 14px/1.2 Inter',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          color: 'var(--fg0, var(--t1))',
        }}>{name}</b>
        <span style={{
          font: '700 10px Inter', letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--cyan)',
        }}>{rank}</span>
      </div>
      <div style={{ textAlign: 'right' }}>
        <b style={{ display: 'block', font: '700 15px/1.1 Inter',
          color: 'color-mix(in srgb, var(--lime) 55%, #fff)',
          fontVariantNumeric: 'tabular-nums' }}>
          {rp}<small style={{ fontSize: 10, color: 'var(--fg3)', marginLeft: 3, fontWeight: 600 }}>RP</small>
        </b>
        <span style={{ fontSize: 11, color: 'var(--fg3)', fontVariantNumeric: 'tabular-nums' }}>
          {mc} missions
        </span>
      </div>
    </div>
  );
}

// ─── Tabs band ──────────────────────────────────────────────────────
function TabsBand({ activeTab, setActiveTab }) {
  const tabs = [
    { k: 'missions', label: 'Missions' },
    { k: 'crew',     label: 'Crew' },
    { k: 'ships',    label: 'Ships' },
  ];
  return (
    <div style={{
      flex: 'none', height: 36,
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
      padding: '0 8px', alignItems: 'center',
      borderBottom: '1px solid var(--edge, var(--rim0))',
    }}>
      {tabs.map(t => {
        const on = activeTab === t.k;
        return (
          <button
            key={t.k}
            onClick={() => setActiveTab(t.k)}
            aria-selected={on}
            style={{
              height: 26, borderRadius: 5,
              border: on
                ? '1px solid color-mix(in srgb, var(--cyan) 58%, var(--bg0))'
                : '1px solid var(--rim0)',
              background: on
                ? 'linear-gradient(180deg, color-mix(in srgb, var(--cyan) 34%, var(--bg0)), color-mix(in srgb, var(--cyan) 18%, var(--bg0)))'
                : 'var(--bg2)',
              color: on ? 'var(--cyan)' : 'var(--fg2)',
              font: '700 11px Inter', letterSpacing: '0.12em',
              textTransform: 'uppercase', cursor: 'pointer',
            }}
          >{t.label}</button>
        );
      })}
    </div>
  );
}

// ─── Mission list item ──────────────────────────────────────────────
const itemStyle = {
  display: 'flex', gap: 8, alignItems: 'center',
  padding: '7px 9px', border: '1px solid var(--rim0)',
  borderRadius: 6, background: 'var(--bg2)',
};
const itemTitleStyle = {
  font: '600 12px Inter', flex: 1, minWidth: 0,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  color: 'var(--fg0, var(--t1))',
};
const itemSubStyle = { color: 'var(--fg3, var(--t2))', fontSize: 11 };
const emptyStyle = { margin: 'auto', color: 'var(--fg3, var(--t2))', textAlign: 'center' };

function MissionItem({ m, onJoin, joining }) {
  // Real data: m.primary_ship + m.supporting_ships, each with crew_roles
  // (not crew_slots) — and role entries key `slots`, not `capacity`.
  // Previously this read nothing and always showed "0/0 FULL."
  const allShips = [m.primary_ship, ...(m.supporting_ships || [])].filter(Boolean);
  let filled = 0, cap = 0;
  for (const ship of allShips) {
    for (const r of Object.values(ship.crew_roles || {})) {
      cap    += r.slots || r.capacity || 0;
      filled += (r.filled || []).length;
    }
  }
  const openSlots = Math.max(0, cap - filled);
  return (
    <div style={itemStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ ...itemTitleStyle, display: 'block' }}>{m.name}</b>
        <span style={itemSubStyle}>
          {(m.mission_type || '').toUpperCase()} · {filled}/{cap}
        </span>
      </div>
      <button
        disabled={openSlots === 0 || joining}
        onClick={onJoin}
        style={{
          font: '700 10px Inter', letterSpacing: '0.06em',
          padding: '4px 10px', borderRadius: 4,
          border: '1px solid color-mix(in srgb, var(--cyan) 58%, var(--bg0))',
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--cyan) 34%, var(--bg0)), color-mix(in srgb, var(--cyan) 18%, var(--bg0)))',
          color: 'var(--cyan)', cursor: openSlots === 0 ? 'default' : 'pointer',
          opacity: openSlots === 0 ? 0.55 : 1,
        }}
      >{joining ? '…' : openSlots === 0 ? 'FULL' : 'JOIN'}</button>
    </div>
  );
}

// ─── Radio tile (inside dock) ───────────────────────────────────────
function RadioTile({
  role, rigShort, rigLabel, freq, pttKey, isTx, isLive,
  locked, powered,
  onCommitFreq, onPowerToggle, onLockToggle, onPttDown, onPttUp,
  onOpenSettings, settingsOpen,
}) {
  const [freqInput, setFreqInput] = useState(freq || '');
  useEffect(() => { setFreqInput(freq || ''); }, [freq]);

  const statusLabel = !powered ? 'OFF' : (isTx ? 'TX' : (isLive ? 'LIVE' : 'IDLE'));
  const statusColor = !powered
    ? 'var(--fg3)'
    : (isTx ? 'color-mix(in srgb, var(--red) 55%, #fff)'
            : (isLive ? 'color-mix(in srgb, var(--lime) 55%, #fff)' : 'var(--fg3)'));

  const commit = () => {
    if (locked || !powered) return;
    const raw = (freqInput || '').trim();
    if (!raw) { setFreqInput(freq || ''); return; }
    onCommitFreq?.(raw);
  };

  return (
    <div style={{
      minWidth: 0,
      border: `1px solid ${isTx ? 'color-mix(in srgb, var(--red) 58%, var(--bg0))' : 'var(--rim0)'}`,
      borderRadius: 8, background: 'var(--bg2)',
      boxShadow: isTx
        ? '0 0 0 1px color-mix(in srgb, var(--red) 58%, var(--bg0)), 0 0 16px color-mix(in srgb, var(--red) 28%, transparent)'
        : '0 1px 0 var(--hl) inset',
      display: 'flex', flexDirection: 'column',
      opacity: powered ? 1 : 0.65,
    }}>
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 5px 4px 8px', minHeight: 30,
        background: 'linear-gradient(180deg, var(--bg3, #183230), var(--bg1))',
        borderBottom: '1px solid var(--edge, var(--rim0))',
        borderRadius: '7px 7px 0 0',
      }}>
        <span style={{
          font: '700 11px Inter', letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--cyan)',
          flex: 1, minWidth: 0,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{role}</span>
        <span style={{
          font: '700 9px Inter', letterSpacing: '0.08em',
          color: statusColor, flex: 'none',
        }}>{statusLabel}</span>
        <button
          onClick={onPowerToggle}
          aria-label={powered ? `Disconnect ${role}` : `Connect ${role}`}
          title={powered ? 'Power off' : 'Power on'}
          style={{
            width: 22, height: 22, display: 'grid', placeItems: 'center',
            borderRadius: 4, padding: 0, cursor: 'pointer',
            border: '1px solid color-mix(in srgb, var(--red) 58%, var(--bg0))',
            background: 'linear-gradient(180deg, color-mix(in srgb, var(--red) 22%, var(--bg1)), color-mix(in srgb, var(--red) 10%, var(--bg0)))',
            color: 'color-mix(in srgb, var(--red) 55%, #fff)', fontSize: 12,
          }}
        >⏻</button>
        <button
          onClick={onOpenSettings}
          aria-expanded={settingsOpen}
          aria-label={`${role} settings`}
          title="Settings"
          style={{
            width: 22, height: 22, display: 'grid', placeItems: 'center',
            borderRadius: 4, padding: 0, cursor: 'pointer',
            border: '1px solid var(--rim1)',
            background: 'linear-gradient(180deg, var(--bg3, #183230), var(--bg2))',
            color: 'var(--fg1)', fontSize: 12,
          }}
        >⚙</button>
      </div>

      {/* body */}
      <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <FreqTuneInput
          value={freqInput}
          onChange={(locked || !powered) ? () => {} : setFreqInput}
          onCommit={commit}
          onCancel={() => setFreqInput(freq || '')}
          transmitting={isTx}
          lcdFontSize={16}
          playTune={(locked || !powered) ? undefined : playTune}
        />

        <div style={{ display: 'flex', gap: 5 }}>
          <button
            onClick={onLockToggle}
            disabled={!powered}
            aria-pressed={locked}
            title={locked ? 'Unlock tuner' : 'Lock tuner'}
            style={{
              flex: 1, height: 26, borderRadius: 5,
              border: locked
                ? '1px solid color-mix(in srgb, var(--amber) 55%, var(--bg0))'
                : '1px solid var(--rim1)',
              background: locked
                ? 'linear-gradient(180deg, color-mix(in srgb, var(--amber) 16%, var(--bg0)), color-mix(in srgb, var(--amber) 8%, var(--bg0)))'
                : 'linear-gradient(180deg, var(--bg3, #183230), var(--bg2))',
              color: locked ? 'var(--amber)' : 'var(--fg1)',
              font: '600 11px Inter', cursor: powered ? 'pointer' : 'not-allowed',
            }}
          >{locked ? '🔒 Locked' : '🔓 Unlocked'}</button>
        </div>

        <button
          onMouseDown={e => { e.preventDefault(); if (powered) onPttDown?.(); }}
          onMouseUp={onPttUp}
          onMouseLeave={onPttUp}
          onTouchStart={e => { e.preventDefault(); if (powered) onPttDown?.(); }}
          onTouchEnd={onPttUp}
          disabled={!powered || !freq}
          title={!powered ? 'Radio is off' : (!freq ? 'Tune a frequency first' : 'Hold to transmit')}
          style={{
            height: 34, width: '100%',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            padding: '0 5px', borderRadius: 5,
            border: isTx
              ? '1px solid color-mix(in srgb, var(--red) 58%, var(--bg0))'
              : '1px solid color-mix(in srgb, var(--cyan) 58%, var(--bg0))',
            background: isTx
              ? 'linear-gradient(180deg, color-mix(in srgb, var(--red) 46%, var(--bg0)), color-mix(in srgb, var(--red) 28%, var(--bg0)))'
              : 'linear-gradient(180deg, color-mix(in srgb, var(--cyan) 34%, var(--bg0)), color-mix(in srgb, var(--cyan) 18%, var(--bg0)))',
            color: isTx ? '#fff' : 'var(--cyan)',
            font: '700 12px Inter', letterSpacing: '0.04em',
            userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
            cursor: (!powered || !freq) ? 'not-allowed' : 'pointer',
            opacity: (!powered || !freq) ? 0.55 : 1,
          }}
        >
          TX
          {pttKey && (
            <span style={{
              display: 'inline-grid', placeItems: 'center',
              minWidth: 18, height: 18, padding: '0 4px',
              borderRadius: 4, border: '1px solid var(--rim1)',
              background: isTx ? '#fff' : 'var(--bg0)',
              color: isTx ? '#8a1d10' : 'var(--cyan)',
              font: '700 9px Inter', letterSpacing: '0.02em',
            }}>{String(pttKey).toUpperCase()}</span>
          )}
        </button>

        <div title={rigLabel} style={{
          textAlign: 'center', color: 'var(--fg3)',
          font: '600 10px Inter', letterSpacing: '0.04em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{rigShort || rigLabel || '(no rig)'}</div>
      </div>
    </div>
  );
}

// ─── Settings face ──────────────────────────────────────────────────
function SettingsFace({ which, onPick, crewState, commandState, otherPttKey, onDone }) {
  const state = which === 'command' ? commandState : crewState;
  const [capturing, setCapturing] = useState(false);
  const [capLabel, setCapLabel]   = useState(null);

  useEffect(() => { setCapturing(false); setCapLabel(null); }, [which]);

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
      if (otherPttKey && label.toUpperCase() === String(otherPttKey).toUpperCase()) {
        setCapLabel(label + ' in use');
        setTimeout(() => setCapLabel(null), 900);
        return;
      }
      state.setPttKey?.(label);
      setCapturing(false); setCapLabel(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, otherPttKey, state]);

  return (
    <>
      {/* Segmented picker */}
      <div style={{
        display: 'flex', border: '1px solid var(--rim1)', borderRadius: 6,
        overflow: 'hidden', marginBottom: 4,
      }}>
        {['crew','command'].map(k => {
          const on = which === k;
          return (
            <button key={k}
              onClick={() => onPick(k)}
              aria-pressed={on}
              style={{
                flex: 1, height: 26, border: 0,
                background: on
                  ? 'linear-gradient(180deg, color-mix(in srgb, var(--cyan) 34%, var(--bg0)), color-mix(in srgb, var(--cyan) 18%, var(--bg0)))'
                  : 'var(--bg0)',
                color: on ? 'var(--cyan)' : 'var(--fg3)',
                font: '700 10px Inter', letterSpacing: '0.12em',
                textTransform: 'uppercase', cursor: 'pointer',
              }}
            >{k === 'crew' ? 'Crew' : 'Command'}</button>
          );
        })}
      </div>

      {/* Row 0: Radio */}
      <div className="rm-row" style={{ '--i': 0, ...rowStyle }}>
        <span style={rowLabelStyle}>Radio</span>
        <div style={rowCtlStyle}>
          <button
            onClick={state.openRigPicker}
            disabled={state.locked}
            style={{
              ...btnStyle, width: '100%',
              textAlign: 'left', justifyContent: 'flex-start',
              opacity: state.locked ? 0.55 : 1,
            }}
            title={state.rig?.label ? `${state.rig.band} · ${state.rig.label}` : 'Change radio preset'}
          >{shortOfLabel(state.rig?.label) || '(no rig)'}</button>
        </div>
      </div>

      {/* Row 1: PTT key */}
      <div className="rm-row" style={{ '--i': 1, ...rowStyle }}>
        <span style={rowLabelStyle}>PTT key</span>
        <div style={rowCtlStyle}>
          <div className={`rm-cap${capturing ? ' rm-armed' : ''}`}>
            {capturing && !capLabel
              ? <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>Press a key…</span>
              : <span style={{
                  display: 'inline-grid', placeItems: 'center',
                  minWidth: 22, height: 20, padding: '0 6px',
                  borderRadius: 4, border: '1px solid var(--rim1)',
                  background: 'var(--bg0)', color: 'var(--cyan)',
                  font: '700 11px Inter',
                }}>{capLabel || String(state.pttKey || '—').toUpperCase()}</span>
            }
          </div>
          <button
            onClick={() => setCapturing(c => !c)}
            style={btnStyle}
          >{capturing ? 'Cancel' : 'Change'}</button>
        </div>
      </div>

      {/* Row 2: Lock tuner */}
      <div className="rm-row" style={{ '--i': 2, ...rowStyle }}>
        <span style={rowLabelStyle}>Lock tuner</span>
        <div style={rowCtlStyle}>
          <span style={{ color: 'var(--fg2)', minWidth: 62, textAlign: 'right' }}>
            {state.locked ? 'Locked' : 'Unlocked'}
          </span>
          <button
            className="rm-sw"
            role="switch"
            aria-checked={state.locked}
            aria-label="Lock tuner"
            onClick={() => state.setLocked(l => !l)}
          />
        </div>
      </div>

      {/* Row 3: Receive cue */}
      <div className="rm-row" style={{ '--i': 3, ...rowStyle }}>
        <span style={rowLabelStyle}>Receive</span>
        <div style={rowCtlStyle}>
          <select
            style={{
              height: 26, width: '100%', padding: '0 8px',
              borderRadius: 5, border: '1px solid var(--rim1)',
              background: 'var(--bg0)', color: 'var(--fg1)',
            }}
            defaultValue={which === 'command' ? 'command' : 'crew'}
          >
            <option value="crew">Crew click</option>
            <option value="command">Command click</option>
            <option value="silent">Silent</option>
          </select>
        </div>
      </div>

      {/* Footer row */}
      <div className="rm-row rm-foot" style={{ '--i': 4, ...rowFootStyle }}>
        <span style={{ flex: 1 }} />
        <button onClick={onDone} style={{
          ...btnStyle,
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--cyan) 34%, var(--bg0)), color-mix(in srgb, var(--cyan) 18%, var(--bg0)))',
          borderColor: 'color-mix(in srgb, var(--cyan) 58%, var(--bg0))',
          color: 'var(--cyan)', fontWeight: 700,
        }}>Done</button>
      </div>
    </>
  );
}

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 10, minHeight: 36,
  padding: '2px 2px', borderBottom: '1px solid var(--edge, var(--rim0))',
};
const rowFootStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
  paddingTop: 6, marginTop: 2,
  borderTop: '1px solid var(--rim0)',
};
const rowLabelStyle = {
  flex: '0 0 76px',
  font: '700 10px Inter', letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--fg2)',
  whiteSpace: 'nowrap',
};
const rowCtlStyle = {
  flex: 1, minWidth: 0,
  display: 'flex', alignItems: 'center', gap: 8,
  justifyContent: 'flex-end',
};
const btnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  height: 26, padding: '0 10px', borderRadius: 5,
  border: '1px solid var(--rim1)',
  background: 'linear-gradient(180deg, var(--bg3, #183230), var(--bg2))',
  color: 'var(--fg1)', font: '600 11px Inter',
  whiteSpace: 'nowrap', cursor: 'pointer',
};
