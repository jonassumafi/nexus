// Companion mode — 340×540 bespoke middle-size layout.
//
// Structure (top to bottom):
//   • Chassis strip: pin + mode switcher + close (always visible)
//   • Operator header: name + rank + RP (compact chip, dark)
//   • Mission bar: if on an active mission — name + elapsed + commander
//   • 3-tab feed: Missions / Crew / Ships — compact activity feed
//   • Radio strip: freq + PTT + mute + peer badge
//
// Routing: /companion, auth-aware (shows login prompt if not logged in).
// Shares voice-profile state via the useRadioConnection hook.

import { useEffect, useMemo, useState, useCallback, useRef, Component } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext }   from '../context/AuthContext.jsx';
import { useRadioConnection } from '../hooks/useRadioConnection';
import { randomVoiceProfile } from '../utils/spacesuitFilter';
import api from '../services/api';
import ThemePicker from '../components/ThemePicker';
import TitleBar from '../components/TitleBar';
import { playTune, playTransmit, playMute, playUnmute } from '../utils/audioFx';
import FreqTuneInput from '../components/FreqTuneInput';
import VoiceProfileModal from '../components/VoiceProfileModal';

// Error boundary — a renderer crash inside Companion was manifesting as
// the Electron window "abruptly closing" because the sub-mode window
// has no fallback UI. Catching render errors here keeps the frame alive
// and gives the user a path back to full mode.
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

const FEED_CATEGORY = {
  mission_created:     { tab: 'missions', tone: 'blue',   glyph: '+' },
  mission_launched:    { tab: 'missions', tone: 'lime',   glyph: '▲' },
  mission_complete:    { tab: 'missions', tone: 'cyan',   glyph: '✓' },
  mission_aborted:     { tab: 'missions', tone: 'red',    glyph: '■' },
  slot_filled:         { tab: 'crew',     tone: 'blue',   glyph: '✓' },
  slot_withdrawn:      { tab: 'crew',     tone: 'red',    glyph: '−' },
  rank_advancement:    { tab: 'crew',     tone: 'purple', glyph: '★' },
  rank_advanced:       { tab: 'crew',     tone: 'purple', glyph: '★' },
  player_connected:    { tab: 'crew',     tone: 'lime',   glyph: '●' },
  player_disconnected: { tab: 'crew',     tone: 'dim',    glyph: '○' },
  ship_borrowed:       { tab: 'ships',    tone: 'amber',  glyph: '⇄' },
  ship_fill_bonus:     { tab: 'ships',    tone: 'amber',  glyph: '✦' },
  post_mission_log:    { tab: 'missions', tone: 'lime',   glyph: '✎' },
};

export default function CompanionExport() {
  return <CompanionBoundary><Companion /></CompanionBoundary>;
}

function Companion() {
  const navigate = useNavigate();
  const { user: jwtUser, isAuthenticated } = useAuthContext();

  // JWT only carries { id, discord_id, username, onboarding_complete }.
  // Fetch /auth/me for the full operator record so citizen_name / rp_rank /
  // total_rp / missions_completed / current_mission_assignment aren't
  // undefined. Fall back to the JWT payload if the fetch fails.
  const [me, setMe] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get('/auth/me').then(({ data }) => { if (!cancelled) setMe(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const user = me || jwtUser || {};
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;

  const [pinned, setPinned] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  useEffect(() => {
    if (!electron?.onWindowState) return;
    return electron.onWindowState((s) => {
      if (s && typeof s.pinned === 'boolean') setPinned(s.pinned);
    });
  }, [electron]);

  // Voice / radio state (mirrors Dashboard's pattern)
  const [voiceProfile, setVoiceProfile]     = useState(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [pttKey, setPttKey] = useState(() => localStorage.getItem('nexus_ptt_key') || 'v');
  const [micSensitivity, setMicSensitivity] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [freqInput, setFreqInput] = useState('');
  const [micDeviceId]    = useState(() => localStorage.getItem('nexus_mic_device_id') || null);
  const [outputDeviceId] = useState(() => localStorage.getItem('nexus_output_device_id') || null);

  const {
    tunedFrequency, peers, transmittingPeerIds, isPTTActive,
    joinFrequency, startPTT, stopPTT,
    setMicSensitivity: setHookMicSensitivity,
    setMuted: setHookMuted,
  } = useRadioConnection({
    voiceProfile, voiceProfileVersion: profileVersion,
    pttKey, micDeviceId, outputDeviceId,
  });

  useEffect(() => { setHookMuted(isMuted); }, [isMuted, setHookMuted]);
  useEffect(() => { setHookMicSensitivity(micSensitivity); }, [micSensitivity, setHookMicSensitivity]);

  // Load voice profile on mount
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

  // Fetch missions + feed. Fires on mount — if the API returns 401 (not
  // authenticated), these promises just reject silently and the component
  // renders with empty data, which still produces a usable UI frame.
  const [missions, setMissions] = useState([]);
  const [myShips, setMyShips]   = useState([]);
  useEffect(() => {
    // Live data only. Empty state is now a legitimate "nothing here yet"
    // instead of the dummy fallback — important for real test sessions.
    api.get('/missions').then(({ data }) => setMissions(Array.isArray(data) ? data : [])).catch(() => setMissions([]));
    api.get('/ships/mine').then(({ data }) => setMyShips(Array.isArray(data) ? data : [])).catch(() => setMyShips([]));
  }, []);

  // Auto-tune to current mission frequency
  const autoTunedRef = useRef(false);
  useEffect(() => {
    if (autoTunedRef.current || !user?.current_mission_assignment?.mission_id || tunedFrequency) return;
    autoTunedRef.current = true;
    const mid = user.current_mission_assignment.mission_id;
    api.get(`/missions/${mid}`).then(({ data }) => {
      if (data?.frequency) joinFrequency(data.frequency, data._id);
    }).catch(() => {});
  }, [user, tunedFrequency, joinFrequency]);

  // Current active mission (if any)
  const myMissionId = user?.current_mission_assignment?.mission_id;
  const myMission = myMissionId ? missions.find(m => String(m._id) === String(myMissionId)) : null;

  // Elapsed timer
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!myMission?.launched_at && !myMission?.start_time) return;
    const anchor = new Date(myMission.launched_at || myMission.start_time).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - anchor) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [myMission?.launched_at, myMission?.start_time]);

  // ── Tab-specific data derivations ────────────────────────────────────
  const [activeTab, setActiveTab] = useState('missions');

  // Missions tab: open missions waiting for crew. Falls back to the dummy
  // list so there's always something to look at even if /missions is empty.
  const openMissions = useMemo(() => {
    return missions
      .filter(m => (m.status || 'waiting') === 'waiting')
      .slice(0, 20);
  }, [missions]);

  // Crew tab: the roster of my current mission. No dummy fallback —
  // empty means "no active mission crew" and that's the honest state.
  const crewRoster = useMemo(() => {
    if (!myMission?.ships?.length) return [];
    const out = [];
    for (const ship of myMission.ships) {
      for (const roleName of Object.keys(ship.crew_slots || {})) {
        const slot = ship.crew_slots[roleName];
        for (const filled of (slot.filled || [])) {
          out.push({
            citizen_name: filled.citizen_name,
            role: roleName,
            ship: ship.ship?.name || ship.name,
            filled: true,
          });
        }
        const openCount = Math.max(0, (slot.capacity || 0) - (slot.filled || []).length);
        for (let i = 0; i < openCount; i++) {
          out.push({ role: roleName, ship: ship.ship?.name || ship.name, filled: false });
        }
      }
    }
    return out;
  }, [myMission]);

  // Ships tab: the player's own ships. No fallback.
  const myShipList = myShips;

  // Who is speaking (same pattern as RadioWidget)
  const speakingPeer = useMemo(() => {
    if (isPTTActive) return { label: 'You', self: true };
    const t = Array.from(transmittingPeerIds || []);
    if (t.length === 0) return null;
    const p = (peers || []).find(x => t.includes(x.socketId));
    return p ? { label: p.citizenName || 'Operator', self: false } : null;
  }, [isPTTActive, transmittingPeerIds, peers]);

  const onPTTDown = useCallback(() => {
    // Transmit cue is played centrally inside useRadioConnection.startPTT
    // so it fires from every mode. Here we just open the mic.
    if (!isMuted) startPTT?.();
  }, [isMuted, startPTT]);
  const onPTTUp   = useCallback(() => { stopPTT?.(); }, [stopPTT]);
  const toggleMute = useCallback(() => {
    setIsMuted(m => { (m ? playUnmute : playMute)(); return !m; });
  }, []);

  // Keep the input in sync with the currently tuned frequency when the
  // user isn't actively typing (e.g. auto-tune to a mission).
  useEffect(() => { setFreqInput(tunedFrequency || ''); }, [tunedFrequency]);

  // Apply a typed frequency. Accepts a flexible numeric input (e.g. "127",
  // "127.4", "127.40"). Rejects empty / unparseable values silently so a
  // blur without typing doesn't clear the current tuning.
  const applyFreq = useCallback(() => {
    const raw = (freqInput || '').trim();
    if (!raw) { setFreqInput(tunedFrequency || ''); return; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { setFreqInput(tunedFrequency || ''); return; }
    const normalized = n.toFixed(1);
    if (normalized === tunedFrequency) return;
    try { joinFrequency(normalized, null); } catch {}
  }, [freqInput, tunedFrequency, joinFrequency]);

  // ── Chassis strip (window chrome) ───────────────────────────────────────
  const chassis = (
    <div className="topbar" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 14px', gap: 6,
      borderBottom: '1px solid var(--edge, var(--rim0))',
    }}>
      <span className="eng" style={{ fontSize: 10, letterSpacing: '0.16em' }}>
        Nexus Companion
      </span>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button className="btn"
          onClick={() => setShowVoiceModal(true)}
          title="Voice profile"
          style={{ width: 26, height: 22, padding: 0, fontSize: 11 }}>🎚</button>
        <ThemePicker compact />
        <button className={`btn${pinned ? ' nt on' : ''}`}
          onClick={async () => { if (!electron) return; const next = await electron.togglePin(); setPinned(next); }}
          title={pinned ? 'Unpin' : 'Pin on top'}
          style={{ width: 26, height: 22, padding: 0, fontSize: 11 }}>⌖</button>
        <button className="btn"
          onClick={() => electron?.setMode?.('full')}
          title="Full dashboard"
          style={{ width: 26, height: 22, padding: 0, fontSize: 10 }}>⊞</button>
        <button className="btn"
          onClick={() => electron?.setMode?.('radio')}
          title="Radio-only"
          style={{ width: 26, height: 22, padding: 0, fontSize: 10 }}>▬</button>
      </div>
    </div>
  );

  // ── Operator header + stats ─────────────────────────────────────────────
  const header = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px',
      borderTop: '1px solid var(--rim0)',
      borderBottom: '1px solid var(--rim0)',
      background: 'linear-gradient(180deg, var(--bg2), var(--bg1))',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--blue) 55%, var(--bg3)), color-mix(in srgb, var(--blue) 18%, var(--bg0)) 75%)',
        border: '1px solid var(--rim1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: 'var(--fg0)',
        flexShrink: 0,
      }}>
        {(user?.citizen_name || user?.username || 'OP').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg0)',
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {user?.citizen_name || user?.username || 'Unknown operator'}
        </div>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--blue)',
          letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {user?.rp_rank?.title || 'Drifter'}
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--fg3)', textAlign: 'right' }}>
        <div><b style={{ color: 'var(--lime)', fontSize: 13 }}>{user?.total_rp ?? 0}</b> RP</div>
        <div style={{ marginTop: 1 }}>{user?.missions_completed ?? 0} missions</div>
      </div>
    </div>
  );

  // ── Mission bar (if on mission) ─────────────────────────────────────────
  const missionBar = myMission && (
    <div className="raised" style={{
      margin: '8px 10px 0', padding: '7px 10px',
      borderColor: 'rgba(68,255,136,.3)',
      background: 'linear-gradient(180deg, rgba(68,255,136,.1), rgba(68,255,136,.03))',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--lime)',
            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            ● {myMission.name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--fg2)', marginTop: 1 }}>
            {myMission.mission_type} · Cmdr {myMission.created_by?.citizen_name || '—'}
          </div>
        </div>
        <div className="lcd" style={{ fontSize: 13, padding: '2px 8px', marginLeft: 8 }}>
          {formatHMS(elapsed)}
        </div>
      </div>
    </div>
  );

  // Join a mission from the Missions tab. Fires crew/reserve; on success,
  // the socket will push the slot_filled event back and the parent app
  // state will update. Dummy entries just acknowledge visually.
  const [joiningId, setJoiningId] = useState(null);
  const joinMission = useCallback(async (mission) => {
    if (!mission || !mission._id) return;
    setJoiningId(mission._id);
    try {
      // Pick the first ship + first open role as a default — the full dashboard
      // has a slot picker, but companion is a quick join.
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

  // ── 3-tab content ────────────────────────────────────────────────────
  const tabs = (
    <>
      <div className="tabs" style={{ padding: '8px 10px 4px' }}>
        {['missions', 'crew', 'ships'].map(t => (
          <button
            key={t}
            className={`tab${activeTab === t ? ' on' : ''}`}
            onClick={() => setActiveTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="feed" style={{ padding: '0 2px' }}>
        {activeTab === 'missions' && (
          openMissions.length === 0 ? (
            <div className="empty" style={{ padding: 10, fontSize: 11 }}>No open missions.</div>
          ) : openMissions.map((m, i) => (
            <MissionRow
              key={m._id ?? `dm-${i}`}
              mission={m}
              onJoin={() => joinMission(m)}
              joining={joiningId === m._id}
            />
          ))
        )}

        {activeTab === 'crew' && (
          crewRoster.length === 0 ? (
            <div className="empty" style={{ padding: 10, fontSize: 11 }}>No active mission crew.</div>
          ) : crewRoster.map((c, i) => <CrewRow key={i} crew={c} />)
        )}

        {activeTab === 'ships' && (
          myShipList.length === 0 ? (
            <div className="empty" style={{ padding: 10, fontSize: 11 }}>No ships registered.</div>
          ) : myShipList.map((s, i) => <ShipRow key={s._id ?? `ds-${i}`} ship={s} />)
        )}
      </div>
    </>
  );

  // ── Radio strip (pinned at bottom) ──────────────────────────────────────
  const radioStrip = (
    <div style={{
      flexShrink: 0, borderTop: '1px solid var(--rim0)',
      padding: '8px 10px', background: 'linear-gradient(180deg, var(--bg2), var(--bg1))',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FreqTuneInput
          value={freqInput}
          onChange={setFreqInput}
          onCommit={applyFreq}
          onCancel={() => setFreqInput(tunedFrequency || '')}
          transmitting={isPTTActive}
          lcdFontSize={16}
          playTune={playTune}
        />
        <button
          className={`btn${isMuted ? ' warn' : ''}`}
          onClick={toggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          aria-pressed={isMuted}
          style={{ fontSize: 11, padding: '5px 9px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', WebkitAppRegion: 'no-drag' }}
        >
          <HeadphonesIcon muted={isMuted} />
        </button>
      </div>
      <button
        className={`btn${isPTTActive ? ' tx on' : ''}`}
        onMouseDown={onPTTDown}
        onMouseUp={onPTTUp}
        onMouseLeave={onPTTUp}
        disabled={isMuted || !tunedFrequency}
        style={{ fontSize: 11, padding: '7px 0', userSelect: 'none' }}
      >
        {isMuted ? '● Mic muted' :
         !tunedFrequency ? 'Not tuned' :
         isPTTActive ? `● Transmitting` : `● Transmit (${(pttKey || 'V').toUpperCase()})`}
      </button>
      <div style={{
        fontSize: 10, color: speakingPeer
          ? (speakingPeer.self ? 'var(--cyan)' : 'var(--lime)')
          : 'var(--fg3)',
        textAlign: 'center',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        {speakingPeer && <span className="live-dot" style={{
          background: speakingPeer.self ? 'var(--cyan)' : 'var(--lime)',
          boxShadow: `0 0 6px ${speakingPeer.self ? 'var(--cyan)' : 'var(--lime)'}`,
        }} />}
        {speakingPeer ? `${speakingPeer.label} speaking` :
          tunedFrequency ? `${peers?.length || 0} on frequency` : 'Standby'}
      </div>
    </div>
  );

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font)', color: 'var(--fg1)',
      background: 'var(--bg0)',
    }}>
      <TitleBar title="NEXUS" subtitle="Companion" />
      {chassis}
      {header}
      {missionBar}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {tabs}
      </div>
      {radioStrip}
      <VoiceProfileModal
        open={showVoiceModal}
        onClose={() => setShowVoiceModal(false)}
        voiceProfile={voiceProfile}
        setVoiceProfile={setVoiceProfile}
        bumpVersion={() => setProfileVersion(v => v + 1)}
        pttKey={pttKey}
        setPttKey={setPttKey}
      />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function formatHMS(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function formatRelative(ts) {
  const t = new Date(ts).getTime();
  if (!t) return '';
  const delta = Date.now() - t;
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatFeedLine(ev) {
  switch (ev.event_type) {
    case 'mission_created':   return `${ev.citizen_name} created ${ev.mission_name}`;
    case 'mission_launched':  return `${ev.mission_name} launched`;
    case 'mission_complete':  return `${ev.mission_name} complete`;
    case 'mission_aborted':   return `${ev.mission_name} aborted`;
    case 'slot_filled':       return `${ev.citizen_name} joined ${ev.ship_name}`;
    case 'slot_withdrawn':    return `${ev.citizen_name} left ${ev.ship_name}`;
    case 'rank_advancement':
    case 'rank_advanced':     return `${ev.citizen_name} → ${ev.new_rank || ev.rank_name}`;
    case 'player_connected':  return `${ev.citizen_name} online`;
    case 'player_disconnected': return `${ev.citizen_name} offline`;
    case 'ship_borrowed':     return `${ev.citizen_name} borrowed ${ev.ship_name}`;
    case 'ship_fill_bonus':   return `${ev.ship_name} earned +${ev.rp_earned} RP`;
    case 'post_mission_log':  return `${ev.citizen_name} logged ${ev.mission_name}`;
    default: return ev.event_type || 'event';
  }
}

// Headphones icon — clear when live, with a diagonal red slash when muted.
// Inline SVG so it inherits currentColor from the button's styling.
function HeadphonesIcon({ muted }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true">
      {/* Headband + two earcups */}
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h3v6H5a1 1 0 0 1-1-1v-5z" />
      <path d="M20 14h-3v6h2a1 1 0 0 0 1-1v-5z" />
      {muted && (
        <line x1="3" y1="3" x2="21" y2="21"
              stroke="#FF5544" strokeWidth="2.2" />
      )}
    </svg>
  );
}

// ─── Dummy data — displayed when the backend returns an empty list, so
// the companion tabs always show something to try. Each entry is shaped
// like the live API response so one swap works without row changes. ───

const DUMMY_MISSIONS = [
  {
    _id: 'dm1', name: 'Jumptown Haul', mission_type: 'cargo', status: 'waiting',
    created_by: { citizen_name: 'MERC_HARPER' },
    ships: [{
      ship: { name: 'HCS JOMLET' },
      crew_slots: {
        Pilot:    { capacity: 1, filled: [{ citizen_name: 'MERC_HARPER' }] },
        Turret:   { capacity: 2, filled: [] },
        Engineer: { capacity: 1, filled: [] },
      },
    }],
  },
  {
    _id: 'dm2', name: 'Nyx Shadow Patrol', mission_type: 'combat', status: 'waiting',
    created_by: { citizen_name: 'VEX_RELAY' },
    ships: [{
      ship: { name: 'IRON VEIL' },
      crew_slots: {
        Pilot:  { capacity: 1, filled: [{ citizen_name: 'VEX_RELAY' }] },
        Turret: { capacity: 2, filled: [{ citizen_name: 'SKEG_7' }] },
      },
    }],
  },
  {
    _id: 'dm3', name: 'Grim Hex Resupply', mission_type: 'logistics', status: 'waiting',
    created_by: { citizen_name: 'DOC_KALM' },
    ships: [{
      ship: { name: 'STEADFAST' },
      crew_slots: {
        Pilot:  { capacity: 1, filled: [{ citizen_name: 'DOC_KALM' }] },
        Medic:  { capacity: 1, filled: [] },
        Cargo:  { capacity: 2, filled: [] },
      },
    }],
  },
  {
    _id: 'dm4', name: 'Pryze Beacon Sweep', mission_type: 'scout', status: 'waiting',
    created_by: { citizen_name: 'ORB_NAV' },
    ships: [{
      ship: { name: 'STRIPLINER' },
      crew_slots: {
        Pilot:    { capacity: 1, filled: [{ citizen_name: 'ORB_NAV' }] },
        Engineer: { capacity: 1, filled: [] },
      },
    }],
  },
];

const DUMMY_CREW = [
  { citizen_name: 'MERC_HARPER', role: 'Pilot',    ship: 'HCS JOMLET', filled: true },
  { citizen_name: 'VEX_RELAY',   role: 'Turret',   ship: 'HCS JOMLET', filled: true },
  { citizen_name: 'SKEG_7',      role: 'Turret',   ship: 'HCS JOMLET', filled: true },
  {                              role: 'Engineer', ship: 'HCS JOMLET', filled: false },
];

const DUMMY_SHIPS = [
  { _id: 'ds1', name: 'HCS JOMLET',   ship_class: 'Hauler',   capacity: 4, assigned_mission: 'Jumptown Haul' },
  { _id: 'ds2', name: 'IRON VEIL',    ship_class: 'Fighter',  capacity: 3, assigned_mission: null },
  { _id: 'ds3', name: 'LITTLE WANDER', ship_class: 'Scout',   capacity: 1, assigned_mission: null },
  { _id: 'ds4', name: 'STEADFAST',    ship_class: 'Medical',  capacity: 4, assigned_mission: null },
];

function MissionRow({ mission, onJoin, joining }) {
  const ship = (mission.ships || [])[0];
  let filled = 0, cap = 0;
  if (ship) {
    for (const r of Object.keys(ship.crew_slots || {})) {
      const s = ship.crew_slots[r];
      cap += s.capacity || 0;
      filled += (s.filled || []).length;
    }
  }
  const openSlots = Math.max(0, cap - filled);
  return (
    <div className="fi" style={{ padding: '7px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg0)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mission.name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--fg3)', letterSpacing: '0.04em', marginTop: 2 }}>
            {(mission.mission_type || '').toUpperCase()} · Cmdr {mission.created_by?.citizen_name || '—'} · {filled}/{cap}
          </div>
        </div>
        <button
          className="btn go"
          disabled={openSlots === 0 || joining}
          onClick={onJoin}
          style={{ fontSize: 10, padding: '5px 10px', letterSpacing: '0.06em' }}
        >
          {joining ? '…' : openSlots === 0 ? 'FULL' : 'JOIN'}
        </button>
      </div>
    </div>
  );
}

function CrewRow({ crew }) {
  const initials = (crew.citizen_name || '—').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="fi" style={{ padding: '6px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%',
          background: crew.filled
            ? 'radial-gradient(circle at 35% 30%, #24557a, #0c2437)'
            : 'repeating-linear-gradient(45deg, var(--bg2) 0 3px, var(--bg1) 3px 6px)',
          border: '1px solid var(--rim1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700, color: 'var(--fg0)',
          flexShrink: 0,
        }}>
          {crew.filled ? initials : '?'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: crew.filled ? 'var(--fg0)' : 'var(--fg3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {crew.filled ? crew.citizen_name : <em style={{ fontStyle: 'italic' }}>Open slot</em>}
          </div>
          <div style={{ fontSize: 10, color: 'var(--fg3)', letterSpacing: '0.04em' }}>
            {crew.role} · {crew.ship}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShipRow({ ship }) {
  const assigned = ship.assigned_mission;
  return (
    <div className="fi" style={{ padding: '6px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 4,
          background: 'linear-gradient(180deg, var(--card-hi), var(--card-lo))',
          border: '1px solid var(--rim1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: 'var(--blue)', flexShrink: 0,
        }}>⬢</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--fg0)', fontWeight: 700,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ship.name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--fg3)', letterSpacing: '0.04em' }}>
            {(ship.ship_class || 'Vessel')} · {ship.capacity ?? '—'} slots
          </div>
        </div>
        {assigned
          ? <span style={{ fontSize: 9, color: 'var(--lime)', letterSpacing: '0.08em' }}>ACTIVE</span>
          : <span style={{ fontSize: 9, color: 'var(--fg3)', letterSpacing: '0.08em' }}>IDLE</span>}
      </div>
    </div>
  );
}
