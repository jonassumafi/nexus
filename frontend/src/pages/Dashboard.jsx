import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocketContext } from '../context/SocketContext';
import api from '../services/api';
import { formatTimestamp, formatFeedTimestamp } from '../utils/time';
import ShipSchematic from '../components/ShipSchematic';
import MissionShipsStrip from '../components/MissionShipsStrip';
import ShipRegistration from '../components/ShipRegistration';
import MyShips from '../components/MyShips';
import CreateMission from '../components/CreateMission';
import ColumnResizeHandle from '../components/ColumnResizeHandle';
import RadioPanel from '../components/RadioPanel';
import CommandTunerRx from '../components/CommandTunerRx';
import CrewRadioCard from '../components/CrewRadioCard';
import CommandRadioCard from '../components/CommandRadioCard';
import SharedMicStrip from '../components/SharedMicStrip';
import RegistryBoot from '../components/RegistryBoot';
import ThemePicker from '../components/ThemePicker';
import SettingsPopover from '../components/SettingsPopover';
import SkinPopover from '../components/SkinPopover';
import TitleBar from '../components/TitleBar';
import OnlineCount from '../components/OnlineCount';
import FeedIcon from '../components/FeedIcon';
import ActivityFeed from '../components/ActivityFeed';
import useMyRadio from '../hooks/useMyRadio';
import RadioRigBadge from '../components/RadioRigBadge';
import RadioPickerModal from '../components/RadioPickerModal';
import BugReportModal from '../components/BugReportModal';
import UpdateCard from '../components/UpdateCard';
import useUpdateFlow from '../hooks/useUpdateFlow';
import GlobalChat, { useChatUnread } from '../components/GlobalChat';
import MissionBoardV2 from '../components/MissionBoardV2';
import Banner, { AnchoredPopover } from '../components/Banner';
import FriendsDrawer from '../components/FriendsDrawer';
import FriendAcceptedBanner from '../components/FriendAcceptedBanner';
import IdCardPopover from '../components/IdCardPopover';
import { useFriends } from '../hooks/useFriends';
import { useDMs } from '../hooks/useDMs';
import DMPane from '../components/DMPane';
import MessagesPopover from '../components/MessagesPopover';
import { toast } from '../components/Toaster';
import { resolveAvatar } from '../utils/avatar';
import { useRadioConnection } from '../hooks/useRadioConnection';
import { useRadioConnectionUDP } from '../hooks/useRadioConnectionUDP';
import { randomVoiceProfile } from '../utils/spacesuitFilter';

// Voice profile fields fetched from /users/voice-profile — mirrored from
// RadioPanel's original constant so the lifted fetch effect below can build
// the same cleaned object shape without a shared module.
const RADIO_PROFILE_FIELDS = [
  'highpass', 'lowpass', 'resonance_freq', 'resonance_q',
  'distortion', 'static_level', 'pitch_shift', 'bit_crush',
];

const playClick = () => {
  const file = Math.random() > 0.5 ? '/sounds/click.mp3' : '/sounds/click2.mp3';
  const snd = new Audio(file);
  snd.volume = 0.7;
  snd.play().catch(() => {});
};

const C = {
  // v0.6.6 — the legacy "C" palette now points at theme-scoped CSS
  // variables so dashboard column dividers and other long-standing
  // literals retint when the player switches skins. Semantic (green/red)
  // keys stay as hex constants on purpose.
  amber:  'var(--blue)',
  gold:   'var(--fg1)',
  dim:    'var(--rim1)',
  border: 'var(--rim0)',
  green:  '#44FF88',
  red:    '#FF5544',
  bgSel:  'var(--bg1)',
  deep:   'var(--bg1)',
  cyan:   'var(--cyan)',
};

const STATUS_COLOR = {
  'WAITING FOR CREW': '#FFBB33',
  'FINALIZED':        '#FFBB33',
  'IN PROGRESS':      '#44FF88',
  'COMPLETE':         '#66AADD',
  'ABORT':            '#FF5544',
};

const STATUS_ABBR = {
  'WAITING FOR CREW': 'WAITING',
  'FINALIZED':        'PREPARING',
  'IN PROGRESS':      'LAUNCHED',
  'COMPLETE':         'COMPLETE',
  'ABORT':            'ABORTED',
};

const STATUS_BADGE_CFG = {
  'WAITING FOR CREW': { bg: 'rgba(255,187,51,0.12)',  border: '#FFBB33', text: '#FFCC66', dot: '#FFBB33', dotAnim: 'pulse-dot 1.4s ease-in-out infinite', label: 'WAITING FOR CREW' },
  'FINALIZED':        { bg: 'rgba(102,170,221,0.15)', border: '#66AADD', text: '#99BBDD', dot: '#66AADD', dotAnim: 'pulse-dot 1.4s ease-in-out infinite', label: 'PREPARING FOR LAUNCH' },
  'IN PROGRESS':      { bg: 'rgba(51,221,170,0.12)',  border: '#44FF88', text: '#66EEBB', dot: '#44FF88', dotAnim: 'pulse-dot 0.8s ease-in-out infinite', label: 'IN PROGRESS' },
  'COMPLETE':         { bg: 'rgba(68,136,187,0.12)',  border: '#5F87A8', text: '#66AADD', dot: '#5F87A8', dotAnim: 'none', label: 'COMPLETE' },
  'ABORT':            { bg: 'rgba(255,85,68,0.12)',   border: '#FF5544', text: '#FF8877', dot: '#FF5544', dotAnim: 'none', label: 'ABORTED' },
};

const EVENT_LABEL = {
  MISSION_LAUNCHED: 'launched mission',
  POST_MISSION_LOG: 'submitted post-log',
  CREW_SLOT_FILLED: 'reserved crew slot',
  SHIP_FILL_BONUS:  'earned ship bonus',
};

// Four-category feed palette — each row is categorized then rendered with
// the concept's .fi/.fr/.ico pattern. `tone` picks the global icon-color
// utility class (lime/blue/red/amber/purple); `glyph` is the glyph shown
// inside the icon circle.
// Semantic color mapping — spread events across the full palette so the
// feed reads as a dashboard, not a wall of one color. Each tone is picked
// to match the *nature* of the event, not just its outcome:
//   blue   crew / people-events (joined, online)
//   lime   positive milestones (launched, logged, rank up)
//   cyan   completion / finished state
//   amber  cargo / ships / loans / "preparing" states
//   red    departures / aborts / failures
//   dim    offline / expired / neutral loss
//   purple rare / achievement / AI
// Tone (ring color) palette, collapsed to one color per *theme* of event:
//   blue   people joining / signing on   (slot_filled, player_connected, mission_created)
//   red    departures / failure           (slot_withdrawn, mission_aborted, queue_expired)
//   amber  ships / loans / preparation    (mission_prep, ship_borrowed, ship_fill_bonus)
//   lime   positive momentum              (mission_launched, post_mission_log)
//   cyan   finished / resolved state      (mission_complete)
//   purple achievement / AI               (rank_advanced, ai_summary)
//   dim    quiet / offline                (player_disconnected)
// The silhouette (via <FeedIcon type={...}/>) carries the specific event;
// the ring color is the second channel.
const FEED_CATEGORY = {
  mission_created:     { tone: 'blue'   },
  mission_prep:        { tone: 'amber'  },
  mission_launched:    { tone: 'lime'   },
  mission_complete:    { tone: 'cyan'   },
  mission_aborted:     { tone: 'red'    },
  slot_filled:         { tone: 'blue'   },
  slot_withdrawn:      { tone: 'red'    },
  ship_fill_bonus:     { tone: 'amber'  },
  ship_borrowed:       { tone: 'amber'  },
  rank_advanced:       { tone: 'purple' },
  rank_advancement:    { tone: 'purple' },
  post_mission_log:    { tone: 'lime'   },
  player_connected:    { tone: 'blue'   },
  player_disconnected: { tone: 'dim'    },
  queue_expired:       { tone: 'red'    },
  ai_summary:          { tone: 'purple' },
};
const DEFAULT_FEED_CAT = { tone: 'blue' };

function formatFeedText(ev) {
  switch (ev.event_type) {
    case 'slot_filled':
      return ev.rp_earned
        ? `${ev.citizen_name} joined ${ev.ship_name} as ${ev.role_name} · +${ev.rp_earned} RP`
        : `${ev.citizen_name} joined ${ev.ship_name} as ${ev.role_name}`;
    case 'slot_withdrawn':
      return ev.rp_deducted
        ? `${ev.citizen_name} withdrew from ${ev.ship_name} as ${ev.role_name} · -${ev.rp_deducted} RP`
        : `${ev.citizen_name} withdrew from ${ev.ship_name} as ${ev.role_name}`;
    case 'post_mission_log':
      return ev.rp_earned
        ? `${ev.citizen_name} submitted a post-mission log for ${ev.mission_name} · +${ev.rp_earned} RP`
        : `${ev.citizen_name} submitted a post-mission log for ${ev.mission_name}`;
    case 'mission_launched':
      return ev.rp_awarded
        ? `${ev.mission_name} launched by ${ev.citizen_name} · +${ev.rp_awarded} RP`
        : `${ev.mission_name} launched by ${ev.citizen_name}`;
    case 'ship_fill_bonus': {
      // Backend broadcasts `rp_awarded`; seed data uses `rp_earned`. Accept both.
      const pts = ev.rp_awarded ?? ev.rp_earned;
      return pts
        ? `${ev.ship_name} earned +${pts} Ship RP · fill threshold reached`
        : `${ev.ship_name} reached fill threshold`;
    }
    case 'mission_created':
      return `${ev.citizen_name} created ${ev.mission_name}`;
    case 'rank_advanced':
    case 'rank_advancement':
      // `rank_advanced` (legacy, uses rank_name) and `rank_advancement`
      // (new broadcast, uses new_rank) format identically.
      return `${ev.citizen_name} advanced to ${ev.new_rank ?? ev.rank_name}`;
    case 'mission_prep':
      return `${ev.mission_name} is preparing for launch`;
    case 'mission_complete':
      return ev.total_rp_awarded
        ? `${ev.citizen_name || 'Commander'} completed ${ev.mission_name} · +${ev.total_rp_awarded} RP awarded to crew`
        : `${ev.citizen_name || 'Commander'} completed ${ev.mission_name}`;
    case 'mission_aborted':
      return `${ev.citizen_name || 'Commander'} aborted ${ev.mission_name}`;
    case 'queue_expired':
      return `${ev.mission_name} expired — crew queue closed`;
    case 'player_connected':
      return `${ev.citizen_name} has connected to Nexus`;
    case 'player_disconnected':
      return `${ev.citizen_name} has disconnected from Nexus`;
    case 'ship_borrowed':
      return null;
    default:
      return ev.event_type;
  }
}

const MISSION_TYPE_COLORS = {
  'Combat':         { bg: 'rgba(255,85,68,0.15)',   border: '#FF5544', text: '#FF8877' },
  'Escort':         { bg: 'rgba(0,255,102,0.10)',   border: '#00FF66', text: '#44FF88' },
  'Logistics':      { bg: 'rgba(255,187,51,0.12)',  border: '#FFBB33', text: '#FFCC66' },
  'Reconnaissance': { bg: 'rgba(102,170,221,0.15)', border: '#66AADD', text: '#99BBDD' },
  'Salvage':        { bg: 'rgba(170,102,221,0.15)', border: '#AA66DD', text: '#CC99FF' },
  'Mining':         { bg: 'rgba(255,170,51,0.12)',  border: '#FFAA33', text: '#FFBB66' },
  'Bounty':         { bg: 'rgba(255,51,102,0.15)',  border: '#FF3366', text: '#FF6688' },
  'Patrol':         { bg: 'rgba(51,221,170,0.12)',  border: '#44FF88', text: '#66EEBB' },
  'Assassination':  { bg: 'rgba(221,51,51,0.15)',   border: '#DD3333', text: '#FF6666' },
  'Rescue':         { bg: 'rgba(51,187,255,0.12)',  border: '#33BBFF', text: '#66CCFF' },
  'Assault':        { bg: 'rgba(255,102,51,0.15)',  border: '#FF6633', text: '#FF8855' },
};
const DEFAULT_BADGE = { bg: 'rgba(42,106,154,0.15)', border: '#2A5A7A', text: '#99BBDD' };

// Human-readable "N ago" for mission post times. Fine-grained up to the
// 3-hour mark; past that the specific count isn't useful (an old mission
// is just an old mission) so we collapse to "More than 3 hours ago". The
// `_tick` argument isn't used in the computation — it exists so React
// components can pass a ticking value as a dependency to force a
// re-render each minute, keeping the display live.
function formatRelativeTime(ts, _tick) {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return '';
  const deltaMs = Math.max(0, Date.now() - t);
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 45)   return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60)   return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr  = min / 60;
  if (hr <= 3)    return `${Math.round(hr)} hour${Math.round(hr) === 1 ? '' : 's'} ago`;
  return 'More than 3 hours ago';
}

// Shared ticker — bumps once per minute. Components can subscribe via
// useRelativeTimeTick() so their relative-time labels refresh without
// each one owning its own interval.
function useRelativeTimeTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

function stripMissionPrefix(name = '') {
  const idx = name.indexOf(':');
  return idx >= 0 ? name.slice(idx + 1).trim() : name;
}

function findShipThumb(ship, shipThumbs) {
  if (!ship || !shipThumbs) return null;
  const src = ship.ship_model || ship.type || '';
  const key = src.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (shipThumbs[key]) return shipThumbs[key];
  const bare = (ship.type || '').toLowerCase().replace(/\s+/g, '_');
  if (bare) {
    for (const [k, v] of Object.entries(shipThumbs)) {
      if (k.endsWith('_' + bare)) return v;
    }
  }
  return null;
}

function StatusBadge({ status }) {
  const cfg = STATUS_BADGE_CFG[status] ?? STATUS_BADGE_CFG['WAITING FOR CREW'];
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 13, letterSpacing: '0.12em',
      padding: '4px 12px', marginBottom: 10,
      fontFamily: "'Inter', system-ui, sans-serif",
      background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.text,
    }}>
      <div style={{
        width: 6, height: 6, flexShrink: 0,
        background: cfg.dot, animation: cfg.dotAnim,
      }} />
      {cfg.label}
    </div>
  );
}

function useDots(active) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN(p => (p + 1) % 4), 400);
    return () => clearInterval(id);
  }, [active]);
  return '.'.repeat(n);
}

function Btn({ onClick, children, color = C.dim, disabled = false }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={disabled ? undefined : () => { playClick(); onClick?.(); }}
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'none',
        border: `1px solid ${disabled ? C.deep : hover ? color : '#5F87A8'}`,
        color: disabled ? C.deep : hover ? color : '#66AADD',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 18,
        padding: '10px 20px',
        cursor: disabled ? 'default' : 'pointer',
        letterSpacing: '0.05em',
      }}
    >
      {children}
    </button>
  );
}

// ─── Mini ID card widget + full-size modal ─────────────────────────────────
// Replaces the plain name/rank/RP text block in the top-right of the top bar
// with a compact ID card that reads like the "CITIZEN IDENTIFICATION CARD"
// preview from Onboarding Step6. Clicking opens the full-size card modal.

function computeDocNo(me) {
  const s = me?._id ? String(me._id) : '';
  if (!s) return 'NTS-XXXX-XXXX';
  return `NTS-${s.slice(-4).toUpperCase()}-${s.slice(-8, -4).toUpperCase()}`;
}

function IdCardWidget({ me, rpPct, rpLabel, onClick }) {
  const avatarSrc = resolveAvatar(me);
  // Dark banner-matching operator chip. No paper surface, no boxed border —
  // just an inline portrait + identity readout that visually extends the
  // topbar gradient. The paper dossier opens on click in IdCardModal.
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        height: '100%',
        padding: '0 12px 0 14px',
        cursor: 'pointer',
        flexShrink: 0,
        background: 'transparent',
        fontFamily: 'var(--font)',
        transition: 'opacity .15s',
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
    >
      {/* Portrait disc */}
      <div style={{
        width: 56, height: 56,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 30%, #24557a, #0c2437)',
        border: '1px solid var(--rim1)',
        boxShadow: '0 1px 0 rgba(150,210,255,.2) inset, 0 3px 0 #04101a, 0 6px 10px rgba(0,0,0,.5)',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        {avatarSrc && (
          <img
            src={avatarSrc}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
      </div>
      {/* Body */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
        minWidth: 0,
      }}>
        <div style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.14em',
          color: 'var(--fg3)',
          textTransform: 'uppercase',
        }}>
          Operator
        </div>
        <div style={{
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--fg0)',
          lineHeight: 1.1,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          maxWidth: 240,
        }}>
          {me?.citizen_name ?? 'Unknown operator'}
        </div>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--blue)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {me?.rp_rank?.title ?? 'Drifter'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, fontSize: 10, color: 'var(--fg3)', letterSpacing: '0.04em', minWidth: 180 }}>
          <span style={{ fontWeight: 600 }}>RP</span>
          <div style={{
            flex: 1,
            height: 5,
            borderRadius: 3,
            background: '#02080e',
            boxShadow: '0 1px 3px #000 inset',
            overflow: 'hidden',
            minWidth: 60,
          }}>
            <div style={{
              height: '100%',
              width: `${rpPct}%`,
              background: 'linear-gradient(90deg, #1f9c5a, var(--lime))',
              transition: 'width .35s ease',
            }} />
          </div>
          <span style={{ fontWeight: 600, color: 'var(--fg2)', fontVariantNumeric: 'tabular-nums' }}>{rpLabel}</span>
        </div>
      </div>
    </div>
  );
}

function IdCardModal({ me, onClose, onRefresh }) {
  const CARD_FONT = "'Inter', system-ui, sans-serif";
  const docNo = computeDocNo(me);
  const regDate = me?.created_at
    ? new Date(me.created_at).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];
  const portraitUrl = resolveAvatar(me);

  // Portrait regeneration state — post-onboarding operators whose avatar was
  // clobbered by the old Discord OAuth callback (or who just want a new
  // portrait) can regenerate here. The backend /users/generate-portrait
  // route now persists the URL directly to user.avatar, so a fetchMe()
  // afterwards refreshes both the widget and this modal.
  const [regenOpen, setRegenOpen]         = useState(false);
  const [regenDesc, setRegenDesc]         = useState('');
  const [regenBusy, setRegenBusy]         = useState(false);
  const [regenErr, setRegenErr]           = useState('');
  const [regenDone, setRegenDone]         = useState(false);

  const regenerate = async () => {
    const description = regenDesc.trim();
    if (!description || regenBusy) return;
    setRegenBusy(true);
    setRegenErr('');
    setRegenDone(false);
    try {
      await api.post('/users/generate-portrait', { description });
      await onRefresh?.();
      setRegenDone(true);
      setRegenDesc('');
    } catch (err) {
      setRegenErr(err?.response?.data?.error || 'PORTRAIT GENERATION FAILED');
    } finally {
      setRegenBusy(false);
    }
  };

  // ESC closes the modal alongside the backdrop click and the ✕ button.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'color-mix(in srgb, var(--bg0) 85%, transparent)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9500,
        padding: 20,
      }}
    >
      <button
        className="btn"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close ID card"
        style={{
          position: 'absolute', top: 20, right: 20,
          width: 36, height: 36, padding: 0, fontSize: 16,
        }}
      >✕</button>

      {/* Card — mirrors Onboarding.jsx Step6 styling (lines 452–555) exactly.
          Duplicated verbatim so this modal has no cross-file coupling and
          Step6's card can evolve independently for the preview experience. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 700, margin: '0 auto', width: '100%', fontFamily: CARD_FONT }}
      >
        <div style={{
          /* Real textured parchment image — the previous CSS-only layer
             stack was too subtle (2-7% opacities) and read as flat white.
             Using an ImageMagick-generated 820×600 warm cream + fiber +
             vignette JPEG gives genuine paper legibility without relying
             on CSS blending modes that render inconsistently across
             browsers.
             Image is fully owned (generated locally), no attribution. */
          backgroundImage: 'url(/images/id_card_parchment.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundColor: '#DADBDF',
          border: '1px solid #2A5A7A',
          boxShadow: 'inset 0 0 1px rgba(90, 70, 40, 0.25), 0 20px 50px rgba(0, 0, 0, .4)',
          position: 'relative',
        }}>
          {/* Faint watermark emblem — subtle UEE ring behind the body text.
              Only shows at close inspection; invisible from a glance. */}
          <div style={{
            position: 'absolute',
            top: 110, left: '50%',
            transform: 'translateX(-50%)',
            width: 220, height: 220,
            opacity: 0.045,
            pointerEvents: 'none',
            backgroundImage:
              "radial-gradient(circle, transparent 44%, #2A3A4A 44%, #2A3A4A 46%, transparent 46%), " +
              "radial-gradient(circle, transparent 34%, #2A3A4A 34%, #2A3A4A 35%, transparent 35%)",
            backgroundSize: '100% 100%',
            backgroundRepeat: 'no-repeat',
          }} />
          {/* Header */}
          <div style={{
            padding: '14px 20px',
            borderBottom: '1px solid #2A5A7A',
            background: '#0A1A28',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 16, color: '#CCE8FF', fontWeight: 'bold', letterSpacing: '0.1em' }}>
                CITIZEN IDENTIFICATION CARD
              </div>
              <div style={{ fontSize: 10, color: '#66AADD', letterSpacing: '0.08em', marginTop: 3 }}>
                FORM UEE-CIT-001 · OFFICIAL GOVERNMENT DOCUMENT
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32,
                border: '1px solid #FFBB33',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <div style={{
                  width: 22, height: 22,
                  border: '1px solid #FFBB33',
                  borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, color: '#FFBB33', fontWeight: 'bold', letterSpacing: '0.02em',
                }}>
                  UEE
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#FFBB33', letterSpacing: '0.1em', fontWeight: 'bold' }}>
                UNITED EMPIRE OF EARTH
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ display: 'flex', gap: 24, padding: 24 }}>
            <div style={{ width: '30%' }}>
              <div style={{
                width: '100%',
                aspectRatio: '3/4',
                border: '1px solid #2A5A7A',
                background: '#1A3A50',
                overflow: 'hidden',
              }}>
                {portraitUrl && (
                  <img
                    src={portraitUrl}
                    alt="Portrait"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                )}
              </div>
              <div style={{ fontSize: 10, color: '#1D3858', marginTop: 10, letterSpacing: '0.08em', fontWeight: 'bold' }}>
                DOC NO. {docNo}
              </div>
            </div>
            <div style={{ width: '70%', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { label: 'NAME',           value: me?.citizen_name },
                { label: 'PLACE OF BIRTH', value: me?.place_of_birth },
                { label: 'CITIZENSHIP',    value: me?.citizenship },
                { label: 'RP RANK',        value: me?.rp_rank?.title },
                { label: 'REG. DATE',      value: regDate },
              ].map((field, i) => (
                <div key={i}>
                  <div style={{ fontSize: 11, color: '#2A3A4A', letterSpacing: '0.12em', marginBottom: 4, fontWeight: 'bold' }}>
                    {field.label}
                  </div>
                  <div style={{ fontSize: 17, color: '#0D1A24', fontWeight: 'bold', letterSpacing: '0.04em' }}>
                    {field.value || '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '10px 20px',
            borderTop: '1px solid #2A5A7A',
            background: '#0A1A28',
            fontSize: 10,
            color: '#FFBB33',
            letterSpacing: '0.05em',
          }}>
            {'P<UEE<<CITIZEN<RECORD<<<<<<<<<<<<<<<<<<<'}
          </div>
        </div>

        {/* Portrait regeneration panel — collapsed by default. */}
        <div style={{
          marginTop: 16,
          border: '1px solid #1A3A50',
          background: '#040D15',
          fontFamily: CARD_FONT,
        }}>
          <button
            onClick={() => setRegenOpen(o => !o)}
            style={{
              width: '100%',
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              color: '#66AADD',
              fontFamily: CARD_FONT,
              fontSize: 12,
              letterSpacing: '0.12em',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>◈ REGENERATE PORTRAIT</span>
            <span style={{ color: '#5F87A8', fontSize: 11 }}>{regenOpen ? '▲' : '▼'}</span>
          </button>

          {regenOpen && (
            <div style={{ padding: '4px 16px 14px' }}>
              <div style={{
                fontSize: 10, color: '#66AADD', letterSpacing: '0.08em',
                marginBottom: 8, lineHeight: 1.5,
              }}>
                Describe your character's appearance. The AI generates a new
                portrait and persists it — future Discord logins will not
                overwrite it.
              </div>
              <textarea
                value={regenDesc}
                onChange={e => { setRegenDesc(e.target.value.slice(0, 500)); setRegenDone(false); }}
                rows={3}
                placeholder="e.g. Weathered pilot, mid-forties, cybernetic left eye, cropped grey hair, leather flight jacket"
                style={{
                  width: '100%',
                  background: '#000',
                  border: '1px solid #2A5A7A',
                  color: '#99BBDD',
                  fontFamily: CARD_FONT,
                  fontSize: 12,
                  padding: '8px 10px',
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  letterSpacing: '0.04em',
                }}
              />
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: 6, gap: 12,
              }}>
                <div style={{ fontSize: 10, color: '#5F87A8', minHeight: 12 }}>
                  {regenErr && <span style={{ color: '#FF5544' }}>{regenErr}</span>}
                  {!regenErr && regenDone && <span style={{ color: '#44FF88' }}>✓ PORTRAIT UPDATED</span>}
                  {!regenErr && !regenDone && <span>{regenDesc.length} / 500</span>}
                </div>
                <button
                  onClick={regenerate}
                  disabled={regenBusy || !regenDesc.trim()}
                  style={{
                    fontFamily: CARD_FONT,
                    fontSize: 11,
                    letterSpacing: '0.1em',
                    padding: '6px 14px',
                    border: '1px solid #44FF88',
                    color: regenBusy || !regenDesc.trim() ? '#5F87A8' : '#44FF88',
                    background: '#000',
                    cursor: regenBusy || !regenDesc.trim() ? 'default' : 'pointer',
                    opacity: regenBusy || !regenDesc.trim() ? 0.5 : 1,
                  }}
                >
                  {regenBusy ? 'GENERATING...' : '[ GENERATE PORTRAIT ]'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TopBar({ me, rankList, missions, onSelectMission, onMissionBoard, onRegisterShip, onMyShips, onCreateMission, onShipRegistry, onRefresh, myShipsMode, registerMode, createMissionMode, shipRegistryMode, navigate, chatBtnRef, chatOpen, setChatOpen, chatUnread, setShowBugReport, setShowRadioPicker, hideNav }) {
  const [hoverBtn, setHoverBtn] = useState(null);

  // Electron companion state. `electronAPI` is only present when the app is
  // running inside the Nexus Companion desktop shell — in a regular browser
  // tab this stays null and the Pin / Compact buttons never render.
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;
  const [pinned, setPinned]   = useState(false);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!electron?.onWindowState) return;
    return electron.onWindowState((s) => {
      if (s && typeof s.pinned  === 'boolean') setPinned(s.pinned);
      if (s && typeof s.compact === 'boolean') setCompact(s.compact);
    });
  }, [electron]);
  const [showIdCard, setShowIdCard] = useState(false);

  const total = me?.total_rp ?? 0;
  let rpPct = 0, rpLabel = `${total} / MAX`;

  if (rankList.length > 0) {
    const sorted = [...rankList].sort((a, b) => (a.min_rp ?? 0) - (b.min_rp ?? 0));
    let currIdx = 0;
    for (let i = 0; i < sorted.length; i++) {
      if ((sorted[i].min_rp ?? 0) <= total) currIdx = i;
    }
    const curr = sorted[currIdx];
    const next = currIdx < sorted.length - 1 ? sorted[currIdx + 1] : null;
    if (next) {
      const range = (next.min_rp ?? 0) - (curr.min_rp ?? 0);
      rpPct = range > 0
        ? Math.min(100, Math.max(0, Math.floor(((total - (curr.min_rp ?? 0)) / range) * 100)))
        : 100;
      rpLabel = `${total} / ${next.min_rp}`;
    } else {
      rpPct = 100;
    }
  } else if (me?.rp_rank) {
    const rank = me.rp_rank;
    if (rank.max_rp != null) {
      const range = (rank.max_rp ?? 0) - (rank.min_rp ?? 0);
      rpPct = range > 0
        ? Math.min(100, Math.max(0, Math.floor(((total - (rank.min_rp ?? 0)) / range) * 100)))
        : 100;
      rpLabel = `${total} / ${rank.max_rp}`;
    } else {
      rpPct = 100;
    }
  }

  const myMissionId = me?.current_mission_assignment?.mission_id;
  const myMission   = myMissionId
    ? missions.find(m => String(m._id) === String(myMissionId))
    : null;

  // Default idle state for non-danger buttons.
  const idleStyle = h => ({
    border: '1px solid #5F87A8',
    color: h ? '#000' : '#99BBDD',
    background: h ? '#5F87A8' : '#000',
  });
  // Active-screen indicator (Nexus cyan).
  const activeStyle = h => ({
    border: '1px solid #00EEFF',
    color: h ? '#000' : '#00EEFF',
    background: h ? '#00EEFF' : 'rgba(0,238,255,0.08)',
  });
  // Danger styling — DISCONNECT only.
  const dangerStyle = h => ({
    border: '1px solid #FF5544',
    color: h ? '#000' : '#FF5544',
    background: h ? '#FF5544' : '#000',
  });

  const btn = (id, label, styleFn, onClick) => {
    const h = hoverBtn === id;
    const s = styleFn(h);
    return (
      <button
        key={id}
        onMouseEnter={() => setHoverBtn(id)}
        onMouseLeave={() => setHoverBtn(null)}
        onClick={() => { playClick(); onClick(); }}
        style={{
          background: s.background ?? '#000',
          border: s.border,
          borderBottom: 'none',
          color: s.color,
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: 18, letterSpacing: '0.12em',
          padding: '6px 16px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          textAlign: 'left',
        }}
      >{label}</button>
    );
  };

  const navBtn = (key, label, active, onClick) => (
    <button
      key={key}
      className={`btn${active ? ' nt on' : ''}`}
      onClick={() => { playClick(); onClick(); }}
      style={{ fontSize: 12, padding: '7px 14px' }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Row 1 — brand bar */}
      <div className="topbar" style={{ paddingRight: 360 }}>
        <div className="brand">
          <img
            src="/images/nexus_logo.png"
            style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 6 }}
            alt=""
          />
          <div>
            <div className="bt1">Nexus Interstellar</div>
            <div className="bt2">Traffic System</div>
            <OnlineCount />
          </div>
        </div>

        {/* Window min / max / close now live in the shared <TitleBar />
            at the very top of the window — the inline duplicate block
            was removed in v0.6.3. */}
      </div>

      {/* Row 2 — nav. Hidden when the new <Banner /> is in use. */}
      {!hideNav && (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '14px 16px 10px',
        gap: 8,
        background: 'var(--bg1)',
        borderBottom: '1px solid #000',
        boxShadow: '0 1px 0 var(--rim0)',
        flexShrink: 0,
        flexWrap: 'wrap',
        paddingRight: 16,
      }}>
        <button
          className="btn"
          onClick={() => { playClick(); onMissionBoard?.(); }}
          style={{ fontSize: 12, padding: '7px 14px' }}
        >
          Missions
        </button>
        <button
          className="btn go"
          onClick={() => { playClick(); onCreateMission?.(); }}
          style={{ fontSize: 12, padding: '7px 14px' }}
        >
          + New mission
        </button>
        {navBtn('ships',    'My ships',      myShipsMode,      () => onMyShips?.())}
        {navBtn('register', 'Register ship', registerMode,     () => onRegisterShip?.())}
        {navBtn('registry', 'Ship registry', shipRegistryMode, () => onShipRegistry?.())}

        {/* Global chat launcher — collapsed state is just this button; the
            panel floats under it when open. Badge shows unread count since
            the last time the panel was opened. */}
        <button
          ref={chatBtnRef}
          className={`btn${chatOpen ? ' nt on' : ''}`}
          onClick={() => { playClick(); setChatOpen(o => !o); }}
          title="Global chat"
          style={{ fontSize: 12, padding: '7px 12px', position: 'relative' }}
        >
          💬 Chat
          {chatUnread > 0 && !chatOpen && (
            <span style={{
              position: 'absolute',
              top: -4, right: -4,
              minWidth: 16, height: 16,
              padding: '0 4px',
              borderRadius: 8,
              background: 'var(--red)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              boxShadow: '0 0 6px rgba(255,85,68,.65)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {chatUnread > 99 ? '99+' : chatUnread}
            </span>
          )}
        </button>

        {myMission && navBtn('mymission', 'My mission', false, () => onSelectMission(myMission._id))}
        <div style={{ flex: 1 }} />
        {/* Electron-only window controls — invisible in a regular browser tab. */}
        {electron && (
          <>
            <button
              className={`btn${pinned ? ' nt on' : ''}`}
              onClick={async () => { playClick(); const next = await electron.togglePin(); setPinned(next); }}
              style={{ fontSize: 12, padding: '7px 10px' }}
              title={pinned ? 'Unpin (window will no longer stay on top)' : 'Pin (keep window on top of other apps)'}
            >
              {pinned ? '⌖ Pinned' : '⌖ Pin'}
            </button>
            <button
              className="btn"
              onClick={() => { playClick(); electron.setMode?.('companion'); }}
              style={{ fontSize: 12, padding: '7px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title="Switch to the 340×540 companion window"
            >
              {/* Shrink-to-small-window glyph: two inward arrows pointing to a tiny frame */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 10V4h6" />
                <path d="M20 14v6h-6" />
                <path d="M4 4l7 7" />
                <path d="M20 20l-7-7" />
              </svg>
              Companion
            </button>
            <button
              className="btn"
              onClick={() => { playClick(); electron.setMode?.('radio'); }}
              style={{ fontSize: 12, padding: '7px 10px' }}
              title="Switch to the ultra-compact radio-only widget"
            >
              ⬤ Radio-only
            </button>
          </>
        )}
        <ThemePicker />
        <button
          className="btn"
          onClick={() => { playClick(); setShowBugReport(true); }}
          title="Report a bug"
          style={{ fontSize: 12, padding: '7px 10px' }}
        >
          🐞 Report a Bug
        </button>
        <button
          className="btn warn"
          onClick={() => { playClick(); navigate('/disconnect'); }}
          style={{ fontSize: 12, padding: '7px 14px' }}
        >
          Disconnect
        </button>
      </div>
      )}

      {/* Operator chip — absolutely positioned to sit on the brand row only
          so it stays on one gradient (no banner-seam exposure). Transparent
          background means the topbar gradient shows through.
          `data-nexus-chip` opts this element out of the Electron drag
          region injected by preload.js. */}
      {/* v0.6.4 — window min/max/close now live in the shared <TitleBar />
          at the very top of the window, so the chip no longer needs to
          reserve space on the right. Right-inset matches the nav row's
          padding (16px) so the chip's trailing edge lines up with the
          Disconnect button a few pixels to its left. */}
      <div data-nexus-chip style={{
        position: 'absolute',
        // v1.1.1 — nudged 6 px down so the chip visually centers on the
        // brand-bar row rather than hugging the TitleBar edge above it.
        top: 6,
        right: 16,
        height: 72,
        display: 'flex',
        alignItems: 'center',
        zIndex: 5,
      }}>
        <RadioRigBadge onClick={() => setShowRadioPicker(true)} />
        <IdCardWidget
          me={me}
          rpPct={rpPct}
          rpLabel={rpLabel}
          onClick={() => setShowIdCard(true)}
        />
      </div>

      {showIdCard && (
        <IdCardModal me={me} onClose={() => setShowIdCard(false)} onRefresh={onRefresh} />
      )}
    </div>
  );
}

function TypeBadge({ missionType, description, small = false }) {
  const colors = MISSION_TYPE_COLORS[missionType] || DEFAULT_BADGE;
  const [tip, setTip] = useState(false);
  const [pos, setPos] = useState(null);

  return (
    <>
      <span
        onMouseEnter={e => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ top: r.top - 8, left: r.left });
          setTip(true);
        }}
        onMouseLeave={() => setTip(false)}
        style={{
          display: 'inline-flex', alignItems: 'center',
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          color: colors.text,
          fontSize: 13,
          letterSpacing: '0.1em',
          padding: small ? '1px 6px' : '4px 10px',
          fontFamily: "'Inter', system-ui, sans-serif",
          cursor: 'default',
        }}
      >
        {missionType ? missionType.toUpperCase() : '—'}
      </span>
      {tip && pos && description && (
        <div style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          transform: 'translateY(-100%)',
          background: '#061018',
          border: '1px solid #1A3A50',
          color: '#99BBDD',
          fontSize: 16,
          padding: '6px 12px',
          whiteSpace: 'normal',
          maxWidth: 280,
          lineHeight: 1.6,
          zIndex: 9999,
          pointerEvents: 'none',
          fontFamily: "'Inter', system-ui, sans-serif",
          letterSpacing: '0.06em',
        }}>
          {description}
        </div>
      )}
    </>
  );
}

function MissionCard({ mission, selected, onClick, missionTypes = {}, shipThumbs = {} }) {
  const tick = useRelativeTimeTick();
  const selStyle = selected
    ? { borderLeft: `2px solid ${C.cyan}`, boxShadow: `0 0 8px #00EEFF33`, background: C.bgSel }
    : mission.is_org_mission
      ? { borderLeft: `2px solid ${C.amber}`, background: 'transparent' }
      : { borderLeft: `2px solid ${C.border}`, background: 'transparent' };

  const strippedName = stripMissionPrefix(mission.name);
  const typeInfo     = missionTypes[mission.mission_type] ?? {};
  const ships        = [mission.primary_ship, ...(mission.supporting_ships ?? [])].filter(Boolean);
  const primaryShip  = ships[0];
  const extraShips   = ships.length - 1;

  let totalSlots = 0, filledSlots = 0;
  for (const ship of ships) {
    for (const roleData of Object.values(ship?.crew_roles ?? {})) {
      totalSlots  += roleData.slots ?? 0;
      filledSlots += (roleData.filled ?? []).length;
    }
  }
  const fillPct  = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;
  const thumbUrl = findShipThumb(primaryShip, shipThumbs);

  return (
    <div
      onClick={onClick}
      style={{ padding: '16px 18px', borderBottom: '1px solid #080F18', cursor: 'pointer', ...selStyle }}
    >
      <div style={{
        fontSize: 16, color: C.gold,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {strippedName}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <TypeBadge missionType={mission.mission_type} description={typeInfo.description} small />
        <span style={{
          fontSize: 12, fontWeight: 'bold', letterSpacing: '0.08em',
          color: STATUS_COLOR[mission.status] ?? '#99BBDD',
        }}>
          {STATUS_ABBR[mission.status] ?? mission.status}
        </span>
      </div>

      {mission.created_at && (
        <div style={{
          fontSize: 11, color: 'var(--fg3)', marginTop: 4,
          letterSpacing: '0.03em',
          fontVariantNumeric: 'tabular-nums',
        }}>
          Posted {formatRelativeTime(mission.created_at, tick)}
        </div>
      )}

      {thumbUrl && (
        <img
          src={thumbUrl}
          alt=""
          style={{
            height: 40, width: 'auto', display: 'block', marginTop: 6,
            filter: 'invert(1) sepia(1) saturate(3) hue-rotate(175deg) brightness(0.55) contrast(1.2)',
          }}
        />
      )}

      <div style={{ fontSize: 16, color: '#99BBDD', marginTop: 4 }}>
        PRIMARY: {primaryShip?.ship_name ?? primaryShip?.type ?? '—'}
        {extraShips > 0 && (
          <span style={{ color: '#99BBDD' }}> +{extraShips} SHIP{extraShips > 1 ? 'S' : ''}</span>
        )}
      </div>

      {totalSlots > 0 && (
        <div className="fillbar">
          <div className="fb">
            <i
              className={fillPct >= 66 ? '' : fillPct >= 33 ? 'mid' : 'low'}
              style={{ width: `${fillPct}%` }}
            />
          </div>
          <span>{fillPct}%</span>
        </div>
      )}
    </div>
  );
}

function MissionDetail({ mission, me, timezone, onRefresh, onFeedRefresh, missionTypes = {}, preselectBorrowFriendId, onBorrowFriendConsumed }) {
  const [working, setWorking]           = useState(false);
  const [postLogOpen, setPostLogOpen]   = useState(false);
  const [logText, setLogText]           = useState('');
  const [selectedShipId, setSelectedShipId] = useState(null);
  const [flashMySlots, setFlashMySlots] = useState(false);
  const [crewNote, setCrewNote]         = useState('');
  const [freqReveal, setFreqReveal]     = useState(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [hoverComplete, setHoverComplete]     = useState(false);
  // Post-mission log button state: 'hidden' (mission not complete / wasn't on
  // crew / still loading), 'pending' (eligible, not yet submitted), 'submitted'
  // (eligible, already logged). Server-derived — see /:id/my-participation.
  const [logStatus, setLogStatus]       = useState('hidden');

  const myMongoId  = me?._id ? String(me._id) : null;
  const myId       = me?.discord_id ? String(me.discord_id) : myMongoId;
  const creatorId  = mission.created_by?._id ? String(mission.created_by._id) : null;
  const isCreator  = !!(myMongoId && creatorId && myMongoId === creatorId);
  const s          = mission.status;

  const ships        = [mission.primary_ship, ...(mission.supporting_ships ?? [])].filter(Boolean);
  const typeInfo     = missionTypes[mission.mission_type] ?? {};
  const strippedName = stripMissionPrefix(mission.name);

  const submitLog = async () => {
    if (!logText.trim() || working) return;
    setWorking(true);
    try {
      await api.post('/logs', { mission_id: mission._id, log_text: logText.trim() });
      setLogText('');
      setPostLogOpen(false);
      setLogStatus('submitted');
      onFeedRefresh();
    } catch {} finally { setWorking(false); }
  };

  // Fetch post-log eligibility whenever the viewed mission or its status
  // changes. Only makes the request for COMPLETE missions — earlier states
  // are always 'hidden' since the button shouldn't render.
  useEffect(() => {
    if (s !== 'COMPLETE') {
      setLogStatus('hidden');
      return;
    }
    let cancelled = false;
    api.get(`/missions/${mission._id}/my-participation`)
      .then(({ data }) => {
        if (cancelled) return;
        if (!data?.was_on_crew) setLogStatus('hidden');
        else if (data.log_submitted) setLogStatus('submitted');
        else setLogStatus('pending');
      })
      .catch(() => { if (!cancelled) setLogStatus('hidden'); });
    return () => { cancelled = true; };
  }, [mission._id, s]);

  const handleSlotClick = async (shipId, roleName, action) => {
    try {
      if (action === 'withdraw') {
        await api.post('/crew/withdraw', { ship_id: shipId, role: roleName });
      } else {
        await api.post('/crew/reserve', { ship_id: shipId, role: roleName });
        try {
          const { data } = await api.get(`/radio/frequency/${mission._id}`);
          if (data?.frequency) {
            setFreqReveal(data.frequency);
            setTimeout(() => setFreqReveal(null), 4000);
          }
        } catch {}
      }
      onRefresh();
    } catch (err) {
      if (err?.response?.status === 400) {
        setFlashMySlots(true);
        setTimeout(() => setFlashMySlots(false), 800);
      }
    }
  };

  const handleCompleteMission = async () => {
    if (working) return;
    setWorking(true);
    try {
      await api.put(`/missions/${mission._id}/complete`);
      setConfirmComplete(false);
      onRefresh();
      onFeedRefresh();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.error;
      if (msg) setCrewNote(msg);
      setConfirmComplete(false);
    } finally {
      setWorking(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    if (working) return;

    if (newStatus === 'FINALIZED') {
      const primaryShip = ships[0];
      const pilotFilled = (primaryShip?.crew_roles?.['Pilot']?.filled?.length ?? 0) > 0;
      let totalFilled = 0;
      for (const ship of ships) {
        totalFilled += Object.values(ship?.crew_roles ?? {})
          .reduce((sum, r) => sum + (r.filled?.length || 0), 0);
      }
      if (!pilotFilled || totalFilled < 2) {
        setCrewNote('⚠ MINIMUM CREW NOT MET — PILOT + 1 REQUIRED');
        return;
      }
      setCrewNote('');
    }

    setWorking(true);
    try {
      await api.patch(`/missions/${mission._id}/status`, { status: newStatus });
      onRefresh();
      if (newStatus === 'ABORTED') onFeedRefresh();
    } catch (err) {
      const msg = err?.response?.data?.error;
      if (msg) setCrewNote(msg);
    } finally {
      setWorking(false);
    }
  };

  // Creator control buttons by mission status. The `variant` tag selects the
  // .btn flavor (default / go / amb / warn / disabled).
  const ctrlBtn = (label, onClick, variant = 'default') => {
    const classes = `btn${variant === 'go' ? ' go' : variant === 'amb' ? ' amb' : variant === 'warn' ? ' warn' : ''}`;
    return (
      <button
        key={label}
        className={classes}
        disabled={!onClick || working || variant === 'disabled'}
        onClick={onClick && !working ? () => { playClick(); onClick(); } : undefined}
        style={{ width: '100%', fontSize: 13, padding: '10px 16px' }}
      >{label.replace(/\[\s*|\s*\]/g, '')}</button>
    );
  };

  const creatorButtons = () => {
    if (s === 'WAITING FOR CREW') return [
      ctrlBtn('Prepare for launch', () => handleStatusChange('FINALIZED'),  'amb'),
      ctrlBtn('Launch mission',     null,                                   'disabled'),
      ctrlBtn('Abort mission',      () => handleStatusChange('ABORTED'),    'warn'),
    ];
    if (s === 'FINALIZED') return [
      ctrlBtn('Mission locked',  null,                                      'disabled'),
      ctrlBtn('Launch mission',  () => handleStatusChange('IN PROGRESS'),   'go'),
      ctrlBtn('Abort mission',   () => handleStatusChange('ABORTED'),       'warn'),
    ];
    if (s === 'IN PROGRESS') {
      if (confirmComplete) {
        return [
          <div key="complete-confirm" className="raised" style={{
            padding: 12,
            marginBottom: 8,
            border: '1px solid rgba(68,255,136,.4)',
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
              color: 'var(--lime)', textTransform: 'uppercase', marginBottom: 6,
            }}>
              Confirm mission complete?
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg2)', marginBottom: 10, lineHeight: 1.5 }}>
              This will finalize all crew RP and archive the mission.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn go"
                disabled={working}
                onClick={!working ? handleCompleteMission : undefined}
                style={{ flex: 1, fontSize: 12, padding: '7px 8px' }}
              >✓ Confirm</button>
              <button
                className="btn"
                onClick={() => setConfirmComplete(false)}
                style={{ flex: 1, fontSize: 12, padding: '7px 8px' }}
              >Cancel</button>
            </div>
          </div>,
          ctrlBtn('Abort mission', () => handleStatusChange('ABORTED'), 'warn'),
        ];
      }
      return [
        ctrlBtn('Complete mission', () => setConfirmComplete(true), 'go'),
        ctrlBtn('Abort mission',    () => handleStatusChange('ABORTED'), 'warn'),
      ];
    }
    return null;
  };

  return (
    <div style={{
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: 16, color: C.amber,
      height: '100%', display: 'flex', flexDirection: 'column',
      position: 'relative',
    }}>

      {/* Frequency reveal overlay */}
      {freqReveal && (
        <div className="raised" style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 20,
          padding: '20px 28px',
          textAlign: 'center',
          minWidth: 300,
          borderColor: 'var(--cyan)',
          boxShadow: '0 1px 0 rgba(150,210,255,.18) inset, 0 3px 0 #050e18, 0 0 32px rgba(0,238,255,.4), 0 8px 20px rgba(0,0,0,.6)',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
            color: 'var(--lime)', textTransform: 'uppercase',
          }}>
            Slot reserved
          </div>
          <div className="h3" style={{ margin: '14px 0 6px' }}>
            Mission frequency
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8 }}>
            <span className="lcd" style={{
              fontSize: 32, padding: '4px 14px',
              animation: 'freqPulse 1s ease-in-out infinite',
            }}>
              {freqReveal}
            </span>
            <span style={{ fontSize: 13, color: 'var(--fg2)' }}>MHz</span>
          </div>
          <div style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.14em',
            color: 'var(--blue)', textTransform: 'uppercase', marginTop: 14,
          }}>
            Nexus comm system
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 2 }}>
            Tune in to join your crew.
          </div>
        </div>
      )}

      {/* Fixed header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--rim0)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>

          {/* Left: mission info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 24, color: 'var(--fg0)', fontWeight: 700,
              lineHeight: 1.2, marginBottom: 10,
            }}>
              {strippedName}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <StatusBadge status={s} />
              <TypeBadge missionType={mission.mission_type} description={typeInfo.description} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--fg2)', marginBottom: 8 }}>
              Commander: <span style={{ color: 'var(--fg0)' }}>{mission.created_by?.citizen_name ?? '—'}</span>
            </div>
            {mission.objectives && (
              <>
                <div className="h3" style={{ marginTop: 14 }}>Objectives</div>
                <div style={{ fontSize: 14, color: 'var(--fg0)', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxWidth: '62ch' }}>
                  {mission.objectives}
                </div>
              </>
            )}
          </div>

          {/* Right: creator controls */}
          {isCreator && s !== 'COMPLETE' && s !== 'ABORT' && (
            <div style={{ minWidth: 240, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6, flexShrink: 0 }}>
              <div className="h3" style={{ textAlign: 'right', marginBottom: 2 }}>Mission controls</div>
              {creatorButtons()}
              {crewNote && (
                <div className="err" style={{ textAlign: 'right', marginTop: 4 }}>
                  {crewNote}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '16px 24px' }}>
        {/* Post-mission log button sits directly above the crew manifest
            section (which lives inside ShipSchematic). Two states: pulsing
            cyan when the caller was on the crew but hasn't logged yet, dim
            green with a ✓ once the log is on record. Hidden entirely when
            the mission isn't COMPLETE or the caller wasn't on the crew. */}
        {(logStatus === 'pending' || logStatus === 'submitted') && (
          <PostMissionLogButton
            status={logStatus}
            onClick={() => setPostLogOpen(p => !p)}
          />
        )}
        {/* Ships area — tab strip + picker + selected ship schematic. The
            MissionShipsStrip owns tabs/add/picker; ShipSchematic renders the
            selected ship's map + manifest below. */}
        <div style={{ marginBottom: 16 }}>
          <MissionShipsStrip
            mission={mission}
            selectedShipId={selectedShipId || (ships[0] ? String(ships[0]._id) : null)}
            onSelectShip={setSelectedShipId}
            missionId={mission._id}
            canAdd={isCreator && s === 'WAITING FOR CREW'}
            onMissionRefresh={onRefresh}
            preselectFriendId={preselectBorrowFriendId}
            onPreselectConsumed={onBorrowFriendConsumed}
          />
          {(() => {
            const sid = selectedShipId || (ships[0] ? String(ships[0]._id) : null);
            const idx = ships.findIndex(sh => String(sh._id) === sid);
            if (idx < 0) return null;
            const sel = ships[idx];
            const myMongo = myMongoId;
            const ownerId = sel?.owner_id?._id ? String(sel.owner_id._id) : null;
            const isBorrowed = ownerId && myMongo && ownerId !== myMongo;
            const borrowedFrom = isBorrowed ? (sel?.owner_id?.citizen_name || null) : null;
            return (
              <div className="ms2-swap" key={sid} style={{ marginTop: 12 }}>
                <ShipSchematic
                  ships={[sel]}
                  shipIndex={0}
                  currentUserId={myId}
                  onSlotClick={handleSlotClick}
                  missionStatus={s}
                  me={me}
                  flashMySlots={flashMySlots}
                  hideNav={true}
                  borrowedFrom={borrowedFrom}
                />
              </div>
            );
          })()}
        </div>


        {(mission.mission_time || mission.start_time) && (
          <div className="raised" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {mission.mission_time && (
              <div>
                <div className="h3" style={{ margin: 0 }}>Mission time</div>
                <div style={{ fontSize: 13, color: 'var(--fg0)', marginTop: 2 }}>
                  {formatTimestamp(mission.mission_time, timezone)}
                </div>
              </div>
            )}
            {mission.start_time && (
              <div>
                <div className="h3" style={{ margin: 0 }}>Launched</div>
                <div style={{ fontSize: 13, color: 'var(--fg0)', marginTop: 2 }}>
                  {formatTimestamp(mission.start_time, timezone)}
                </div>
              </div>
            )}
          </div>
        )}

        {postLogOpen && (
          <div style={{ marginTop: 12 }}>
            <textarea
              value={logText}
              onChange={e => setLogText(e.target.value)}
              placeholder="Enter mission log..."
              rows={4}
              style={{
                width: '100%',
                background: '#000',
                border: `1px solid ${C.border}`,
                color: C.amber,
                fontFamily: "'Inter', system-ui, sans-serif",
                fontSize: 16,
                padding: '8px',
                resize: 'vertical',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <Btn color={C.green} onClick={submitLog} disabled={working || !logText.trim()}>
                [ SUBMIT ]
              </Btn>
              <Btn onClick={() => { setPostLogOpen(false); setLogText(''); }}>
                [ CANCEL ]
              </Btn>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

// Post-mission log button — two-state, rendered above the crew manifest in
// MissionDetail's scrollable body. Pending state pulses a cyan glow to invite
// the click; submitted state dims to muted green with a large ✓ and is
// non-interactive. Keyframes are injected once via an inline <style> tag so
// no global.css edit is required.
function PostMissionLogButton({ status, onClick }) {
  if (status === 'submitted') {
    return (
      <div className="raised" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: '10px 16px', marginBottom: 16,
        borderColor: 'rgba(68,255,136,.2)',
        color: 'rgba(155,230,184,.8)',
        pointerEvents: 'none',
      }}>
        <span style={{ fontSize: 20, color: 'var(--lime)' }}>✓</span>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Post-mission log submitted
        </span>
      </div>
    );
  }
  return (
    <>
      <style>{`
        @keyframes postLogPulse {
          0%, 100% { box-shadow: 0 1px 0 rgba(180,225,255,.25) inset, 0 3px 0 #04101a, 0 0 6px rgba(0,238,255,.35); }
          50%      { box-shadow: 0 1px 0 rgba(180,225,255,.25) inset, 0 3px 0 #04101a, 0 0 20px rgba(0,238,255,.75); }
        }
      `}</style>
      <button
        className="btn"
        onClick={onClick}
        style={{
          width: '100%',
          padding: '11px 18px',
          marginBottom: 16,
          fontSize: 13, letterSpacing: '0.08em',
          borderColor: 'var(--cyan)',
          color: 'var(--cyan)',
          animation: 'postLogPulse 2s ease-in-out infinite',
        }}
      >
        <span style={{ fontSize: 15 }}>✎</span>
        <span>Submit post-mission log</span>
      </button>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// InProgressView — shown in the center panel when a mission is LAUNCHED
// (internal status 'IN PROGRESS'). Replaces the standard MissionDetail view
// with the timer + ship grid + commander/crew actions layout.
// ───────────────────────────────────────────────────────────────────────────

const GRID_COLS_BY_SHIP_COUNT = { 1: 1, 2: 2, 3: 3, 4: 2, 5: 3, 6: 3 };

function formatHMS(totalSecs) {
  const s = Math.max(0, Math.floor(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatLaunchDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = String(dt.getDate()).padStart(2, '0');
  const hr  = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  return `${MONTHS[dt.getMonth()]} ${day}, ${hr}:${min}`;
}

function ShipInProgressCard({ ship, isPrimary, shipThumbs }) {
  const thumbUrl = findShipThumb(ship, shipThumbs);
  const rows = [];
  for (const [roleName, roleData] of Object.entries(ship.crew_roles || {})) {
    const slots = roleData.slots || 0;
    const filled = roleData.filled || [];
    for (let i = 0; i < slots; i++) {
      rows.push({ roleName, occupant: filled[i] });
    }
  }
  return (
    <div className="raised" style={{
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
    }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <span className={isPrimary ? 'badge b-amber' : 'badge b-blue'}>
          {isPrimary ? '★ Primary' : 'Support'}
        </span>
      </div>
      <div style={{
        fontSize: 14, color: 'var(--fg0)', fontWeight: 700,
        textAlign: 'center',
      }}>
        {ship.ship_name || '—'}
      </div>
      <div style={{
        fontSize: 11, color: 'var(--fg3)',
        marginBottom: 10, textAlign: 'center',
      }}>
        {formatModel(ship.ship_model || ship.type) || '—'}
      </div>
      <div style={{
        width: '100%', height: 110,
        border: '1px solid var(--rim0)', borderRadius: 4,
        background: '#02080e', overflow: 'hidden',
        marginBottom: 12,
        padding: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 6px #000 inset',
      }}>
        {thumbUrl && (
          <img src={thumbUrl} alt="" style={{
            width: '100%', height: '100%', objectFit: 'contain',
            filter: 'invert(1) sepia(1) saturate(3) hue-rotate(175deg) brightness(0.55) contrast(1.2)',
          }} />
        )}
      </div>
      <div style={{ width: '100%' }}>
        {rows.length === 0 ? (
          <div className="empty" style={{ padding: '6px 0', fontSize: 11 }}>
            No crew roles
          </div>
        ) : rows.map((row, i) => {
          const occ = row.occupant;
          const name = occ && (occ.citizen_name || occ.discord_id) ? (occ.citizen_name || 'Unknown') : null;
          return (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '5px 0', borderBottom: '1px solid rgba(26,58,80,.5)',
              fontSize: 11,
            }}>
              <span style={{ color: 'var(--fg3)', letterSpacing: '0.04em' }}>
                {row.roleName}
              </span>
              {name ? (
                <span style={{ color: 'var(--fg0)', fontWeight: 600 }}>
                  {name}
                </span>
              ) : (
                <span style={{ color: 'var(--lime)' }}>Open</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InProgressView({ mission, me, onRefresh, onFeedRefresh, shipThumbs }) {
  const [elapsed, setElapsed] = useState(0);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [hoverComplete, setHoverComplete] = useState(false);
  const [hoverAbort, setHoverAbort] = useState(false);
  const [working, setWorking] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const launchedAt = mission.launched_at || mission.start_time;
  const status = mission.status;

  useEffect(() => {
    if (!launchedAt || status !== 'IN PROGRESS') return;
    const tick = () => {
      setElapsed(Math.floor((Date.now() - new Date(launchedAt).getTime()) / 1000));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [launchedAt, status]);

  const myMongoId  = me?._id ? String(me._id) : null;
  const creatorId  = mission.created_by?._id ? String(mission.created_by._id) : null;
  const isCreator  = !!(myMongoId && creatorId && myMongoId === creatorId);

  const ships = [mission.primary_ship, ...(mission.supporting_ships ?? [])].filter(Boolean);
  const cols  = GRID_COLS_BY_SHIP_COUNT[Math.min(ships.length, 6)] || 3;

  const handleComplete = async () => {
    if (working) return;
    setWorking(true);
    setErrMsg('');
    try {
      await api.put(`/missions/${mission._id}/complete`);
      setConfirmComplete(false);
      onRefresh();
      onFeedRefresh();
    } catch (err) {
      setErrMsg(err?.response?.data?.error || 'Complete failed');
      setConfirmComplete(false);
    } finally {
      setWorking(false);
    }
  };

  const handleAbort = async () => {
    if (working) return;
    if (!window.confirm('Abort this mission? Crew associations will be reset and no RP will be awarded.')) return;
    setWorking(true);
    setErrMsg('');
    try {
      await api.patch(`/missions/${mission._id}/status`, { status: 'ABORTED' });
      onRefresh();
      onFeedRefresh();
    } catch (err) {
      setErrMsg(err?.response?.data?.error || 'Abort failed');
    } finally {
      setWorking(false);
    }
  };

  const strippedName = stripMissionPrefix(mission.name);
  const commanderName = mission.created_by?.citizen_name || mission.created_by?.username || '—';
  const missionTypeLabel = (mission.mission_type || '').toUpperCase();

  return (
    <div style={{
      fontFamily: "'Inter', system-ui, sans-serif",
      height: '100%', overflowY: 'auto', padding: '30px 30px 40px', color: C.amber,
    }}>
      {/* TIMER BANNER */}
      <div className="raised" style={{
        textAlign: 'center',
        padding: '18px 24px',
        marginBottom: 24,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: 'var(--fg3)',
          letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6,
        }}>
          Mission elapsed time
        </div>
        <div className="lcd" style={{
          display: 'inline-block',
          fontSize: 40, padding: '6px 20px',
          letterSpacing: '0.08em',
        }}>
          {formatHMS(elapsed)}
        </div>
        <div style={{
          fontSize: 16, fontWeight: 700, color: 'var(--fg0)',
          marginTop: 12,
        }}>
          {strippedName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg3)', marginTop: 4 }}>
          {missionTypeLabel || '—'} · Launched {formatLaunchDate(launchedAt)} · Commander {commanderName}
        </div>
      </div>

      {/* SHIP GRID */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 240px)`,
        gap: 16,
        justifyContent: 'center',
      }}>
        {ships.map((ship, i) => (
          <ShipInProgressCard
            key={ship._id || i}
            ship={ship}
            isPrimary={i === 0}
            shipThumbs={shipThumbs}
          />
        ))}
      </div>

      {/* COMMANDER ACTIONS */}
      {isCreator ? (
        <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          {confirmComplete ? (
            <div className="raised" style={{
              padding: 16, minWidth: 320, textAlign: 'center',
              borderColor: 'rgba(68,255,136,.4)',
            }}>
              <div style={{
                fontSize: 11, color: 'var(--lime)', fontWeight: 700,
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6,
              }}>
                Confirm mission complete?
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg2)', marginBottom: 12 }}>
                All crew RP will be distributed.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn go"
                  onClick={handleComplete}
                  disabled={working}
                  style={{ flex: 1, fontSize: 12, padding: '8px 12px' }}
                >✓ Confirm</button>
                <button
                  className="btn"
                  onClick={() => setConfirmComplete(false)}
                  style={{ flex: 1, fontSize: 12, padding: '8px 12px' }}
                >Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
              <button
                className="btn go lg"
                onClick={() => { playClick(); setConfirmComplete(true); }}
                disabled={working}
              >
                ✓ Complete mission
              </button>
              <button
                className="btn warn"
                onClick={handleAbort}
                disabled={working}
              >
                Abort
              </button>
            </div>
          )}
          {errMsg && <div className="err">{errMsg}</div>}
        </div>
      ) : (
        <div className="raised" style={{
          marginTop: 28, padding: '14px 20px', textAlign: 'center',
        }}>
          <div style={{
            fontSize: 11, color: 'var(--amber)', fontWeight: 700,
            letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4,
          }}>
            RP will be distributed to all crew upon mission completion
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg2)' }}>
            Submit your post-mission log afterward to earn an additional <b style={{ color: 'var(--lime)' }}>+3 RP</b>.
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// PostMissionLogModal — fired by 'post_mission_log_prompt' socket event.
// ───────────────────────────────────────────────────────────────────────────

function PostMissionLogModal({ prompt, onClose, onSubmitted }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [textareaFocus, setTextareaFocus] = useState(false);
  const [hoverSubmit, setHoverSubmit] = useState(false);

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && !submitting && !successMsg;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrMsg('');
    try {
      await api.post(`/missions/${prompt.missionId}/post-mission-log`, {
        log_content: trimmed,
      });
      setSuccessMsg('✓ LOG SUBMITTED · +3 RP AWARDED');
      onSubmitted?.();
      setTimeout(() => onClose(), 3000);
    } catch (err) {
      setErrMsg(err?.response?.data?.error || 'Submission failed');
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div className="raised" style={{
        padding: 28,
        maxWidth: 600,
        width: '90%',
        borderColor: 'rgba(68,255,136,.4)',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.14em',
          color: 'var(--lime)', textTransform: 'uppercase', marginBottom: 4,
        }}>
          Post-mission log
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg0)', marginBottom: 16 }}>
          {stripMissionPrefix(prompt.mission_name || '') || 'Mission'}
        </div>

        {successMsg ? (
          <div style={{
            fontSize: 14, color: 'var(--lime)', fontWeight: 600,
            textAlign: 'center', padding: '28px 0',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}>
            <span className="live-dot" />
            {successMsg.replace(/^✓\s*/, '')}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: 'var(--fg2)', marginBottom: 14, lineHeight: 1.6 }}>
              Submit your mission log to earn <b style={{ color: 'var(--lime)' }}>+3 RP</b>. Describe what happened during the operation.
            </div>
            <textarea
              className="inp"
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={1000}
              disabled={submitting}
              placeholder="Enter your mission log here…"
              onFocus={() => setTextareaFocus(true)}
              onBlur={() => setTextareaFocus(false)}
              style={{ minHeight: 160 }}
            />
            <div style={{ fontSize: 11, color: 'var(--fg3)', textAlign: 'right', marginTop: 4 }}>
              {text.length} / 1000
            </div>
            {errMsg && (
              <div className="err" style={{ textAlign: 'center', marginTop: 8 }}>{errMsg}</div>
            )}
            <button
              className="btn go"
              onClick={submit}
              disabled={!canSubmit}
              style={{ width: '100%', fontSize: 14, padding: '12px 0', marginTop: 14 }}
            >
              {submitting ? <><span className="spinner" />Submitting…</> : 'Submit log'}
            </button>
            <button
              onClick={onClose}
              className="btn"
              style={{ width: '100%', fontSize: 12, padding: '7px 0', marginTop: 8 }}
            >
              Skip
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// AI summary gets its own full-width body since its content is long-form
// prose rather than a one-liner. Everything else uses the compact icon-row.
function FeedItem({ item, timezone }) {
  const ts = formatFeedTimestamp(item.timestamp, timezone);
  const cat = FEED_CATEGORY[item.event_type] ?? DEFAULT_FEED_CAT;

  if (item.event_type === 'ai_summary') {
    return (
      <div className="fi">
        <div className="fr">
          <div className={`ico ${cat.tone}`}><FeedIcon type={item.event_type} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="ft" style={{ color: 'var(--purple)' }}>
              Nexus Traffic Authority
            </div>
            <div className="fs">has reviewed recent fleet activity and issued the following summary.</div>
          </div>
          <div className="ftime">{ts}</div>
        </div>
        <div className="fd" style={{ color: 'var(--fg1)', lineHeight: 1.65, marginTop: 6 }}>
          {item.summary_text}
        </div>
      </div>
    );
  }

  if (item.event_type === 'ship_borrowed') {
    return (
      <div className="fi">
        <div className="fr">
          <div className={`ico ${cat.tone}`}><FeedIcon type={item.event_type} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="ft">
              <span className="nm">{item.citizen_name}</span>{' '}added{' '}
              <em style={{ color: 'var(--amber)' }}>{item.ship_name}</em>{' '}to{' '}
              <em style={{ color: 'var(--fg1)' }}>{item.mission_name}</em>
            </div>
          </div>
          <div className="ftime">{ts}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fi">
      <div className="fr">
        <div className={`ico ${cat.tone}`}><FeedIcon type={item.event_type} /></div>
        <div style={{ minWidth: 0 }}>
          <div className="ft">{formatFeedText(item)}</div>
        </div>
        <div className="ftime">{ts}</div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Ship Registry
// ───────────────────────────────────────────────────────────────────────────

import formatModel from '../utils/formatShipModel';

function ShipRegistryCard({ ship, shipThumbs, isOpen, onToggle, me, myRequest, onRequestSent, onRequestCancelled }) {
  const thumbUrl = findShipThumb(ship, shipThumbs);
  const ownerName = ship.owner_id?.citizen_name || ship.owner_id?.username || '—';
  const stats = ship.stats || { lifetime_rp: 0, avg_fill_rate: 0, missions_analyzed: 0 };
  const rawModel = ship.ship_model || ship.type || '';
  const modelDisplay = rawModel ? formatModel(rawModel) : '—';
  const [reqLoading, setReqLoading] = useState(false);

  return (
    <div className="raised" style={{ padding: 12 }}>
      <div style={{
        width: '100%', height: 80, background: '#02080e',
        border: '1px solid var(--rim0)', borderRadius: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 10, overflow: 'hidden',
        padding: 8, boxSizing: 'border-box',
        boxShadow: '0 2px 6px #000 inset',
      }}>
        {thumbUrl ? (
          <img src={thumbUrl} alt="" style={{
            width: '100%', height: '100%', objectFit: 'contain',
            filter: 'invert(1) sepia(1) saturate(3) hue-rotate(175deg) brightness(0.55) contrast(1.2)',
          }} />
        ) : (
          <div style={{ fontSize: 10, color: '#1A3A50', letterSpacing: '0.06em' }}>NO IMAGE</div>
        )}
      </div>

      <div style={{ fontSize: 13, color: '#CCE8FF', fontWeight: 'bold', letterSpacing: '0.06em', marginBottom: 3 }}>
        {ship.ship_name || '—'}
      </div>
      <div style={{ fontSize: 10, color: '#5F87A8', letterSpacing: '0.04em', marginBottom: 6 }}>
        {modelDisplay}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: '#66AADD', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ownerName}
        </div>
        <div style={{ fontSize: 10, fontWeight: 'bold', letterSpacing: '0.06em', flexShrink: 0, color: ship.is_mission ? '#FFBB33' : '#44FF88' }}>
          ● {ship.is_mission ? 'ON MISSION' : 'DOCKED'}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #061018', paddingTop: 8, marginBottom: 8 }}>
        {[['SHIP RP', stats.lifetime_rp], ['AVG FILL', `${stats.avg_fill_rate}%`], ['MISSIONS', stats.missions_analyzed]].map(([label, val]) => (
          <div key={label} style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: 11, color: '#00EEFF', fontWeight: 'bold' }}>{val}</div>
            <div style={{ fontSize: 9, color: '#5F87A8', letterSpacing: '0.06em' }}>{label}</div>
          </div>
        ))}
      </div>

      {(() => {
        const isOwnShip = me && ship.owner_id && (
          ship.owner_id._id === me._id || ship.owner_id._id?.toString() === me._id?.toString()
        );
        if (isOwnShip || ship.is_mission) return null;

        if (myRequest?.status === 'approved') {
          return (
            <div className="badge b-lime" style={{ marginTop: 4 }}>
              ● Vessel borrowed
            </div>
          );
        }

        if (myRequest?.status === 'pending') {
          return (
            <div style={{
              borderTop: '1px solid #FFBB33', padding: '6px 8px',
              background: 'rgba(255,187,51,0.06)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 10, color: '#FFBB33', letterSpacing: '0.06em' }}>
                ⏳ REQUEST PENDING
              </span>
              <span
                style={{ fontSize: 9, color: '#5F87A8', textDecoration: 'underline', cursor: 'pointer' }}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (reqLoading) return;
                  setReqLoading(true);
                  try {
                    await api.post(`/ships/${ship._id}/cancel-request`, { request_id: myRequest._id });
                    onRequestCancelled?.(ship._id);
                  } catch {}
                  setReqLoading(false);
                }}
              >
                {reqLoading ? '...' : 'CANCEL'}
              </span>
            </div>
          );
        }

        return (
          <button
            className="btn"
            disabled={reqLoading}
            onClick={async () => {
              if (reqLoading) return;
              setReqLoading(true);
              try {
                const { data } = await api.post(`/ships/${ship._id}/request-access`);
                onRequestSent?.(ship._id, data.request);
              } catch {}
              setReqLoading(false);
            }}
            style={{ width: '100%', fontSize: 12, padding: '7px 10px', marginTop: 6 }}
          >
            {reqLoading ? <><span className="spinner" />Sending…</> : <>Request access →</>}
          </button>
        );
      })()}

      <button
        className="btn"
        onClick={onToggle}
        style={{ width: '100%', fontSize: 11, padding: '5px 0', marginTop: 6 }}
      >
        Ship history {isOpen ? '▼' : '▶'}
      </button>

      {isOpen && (
        <div style={{
          marginTop: 8, padding: '8px 10px', background: '#040D15', border: '1px solid #061018',
          fontSize: 11, color: '#66AADD', lineHeight: 1.6, letterSpacing: '0.04em',
        }}>
          {ship.description || <span style={{ color: '#1A3A50' }}>NO HISTORY ON FILE</span>}
        </div>
      )}
    </div>
  );
}

// ─── Owner access-request popup ────────────────────────────────────────────

function OwnerAccessPopup({ popup, shipThumbs, onApprove, onDeny, onDismiss }) {
  const [minimized, setMinimized] = useState(false);
  const [loading, setLoading] = useState(false);
  const thumbUrl = findShipThumb({ ship_model: popup.shipModel }, shipThumbs);

  if (minimized) {
    return (
      <div
        className="raised"
        onClick={() => setMinimized(false)}
        style={{
          width: 280, padding: '8px 14px',
          borderColor: 'var(--cyan)',
          boxShadow: '0 1px 0 rgba(150,210,255,.12) inset, 0 3px 0 #050e18, 0 0 20px rgba(0,238,255,.4)',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 600, letterSpacing: '0.06em' }}>
            ⚓ Access request — {popup.shipName}
          </span>
          <span style={{ fontSize: 10, color: 'var(--fg3)' }}>▲</span>
        </div>
      </div>
    );
  }

  return (
    <div className="raised" style={{
      width: 340,
      borderColor: 'var(--cyan)',
      boxShadow: '0 1px 0 rgba(150,210,255,.18) inset, 0 3px 0 #050e18, 0 0 24px rgba(0,238,255,.4), 0 0 48px rgba(0,238,255,.15)',
    }}>
      <div className="sh" style={{ padding: '8px 12px' }}>
        <span style={{ fontSize: 11, color: 'var(--cyan)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Incoming access request
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          <span
            onClick={() => setMinimized(true)}
            style={{ fontSize: 10, color: '#5F87A8', cursor: 'pointer', letterSpacing: '0.06em' }}
          >
            ▼
          </span>
          <span
            onClick={onDismiss}
            style={{ fontSize: 10, color: '#5F87A8', cursor: 'pointer', letterSpacing: '0.06em' }}
          >
            ✕
          </span>
        </div>
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{
          width: 64, height: 48, background: '#040D15', border: '1px solid #061018',
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          padding: 8, boxSizing: 'border-box',
        }}>
          {thumbUrl ? (
            <img src={thumbUrl} alt="" style={{
              width: '100%', height: '100%', objectFit: 'contain',
              filter: 'invert(1) sepia(1) saturate(3) hue-rotate(175deg) brightness(0.55)',
            }} />
          ) : (
            <span style={{ fontSize: 9, color: '#1A3A50' }}>NO IMG</span>
          )}
        </div>
        <div>
          <div style={{ fontSize: 13, color: '#CCE8FF', fontWeight: 'bold' }}>{popup.shipName}</div>
          <div style={{ fontSize: 10, color: '#5F87A8', marginTop: 2 }}>
            {popup.shipModel ? formatModel(popup.shipModel) : '—'}
          </div>
          <div style={{ fontSize: 10, color: '#66AADD', marginTop: 6 }}>
            REQUESTER: <span style={{ color: '#99BBDD' }}>{popup.requesterName}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '0 12px 12px' }}>
        <button
          className="btn go"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            await onApprove(popup);
            setLoading(false);
          }}
          style={{ flex: 1, fontSize: 12, padding: '7px 0' }}
        >
          Approve
        </button>
        <button
          className="btn warn"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            await onDeny(popup);
            setLoading(false);
          }}
          style={{ flex: 1, fontSize: 12, padding: '7px 0' }}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

// ─── Lessee notification bar ────────────────────────────────────────────────

const LESSEE_COLORS = {
  approved: '#44FF88',
  denied:   '#FF5544',
  expired:  '#5F87A8',
  recalled: '#FFBB33',
};
const LESSEE_LABELS = {
  approved: 'ACCESS GRANTED',
  denied:   'ACCESS DENIED',
  expired:  'REQUEST EXPIRED',
  recalled: 'ACCESS RECALLED',
};

function LesseeNotif({ notif, onClose }) {
  const [minimized, setMinimized] = useState(false);
  const color = LESSEE_COLORS[notif.kind] || '#66AADD';
  const label = LESSEE_LABELS[notif.kind] || 'ACCESS UPDATE';

  if (minimized) {
    return (
      <div
        className="raised"
        onClick={() => setMinimized(false)}
        style={{
          width: 280, padding: '7px 12px',
          borderColor: color, cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color, letterSpacing: '0.04em', fontWeight: 600 }}>
            {label}: {notif.shipName}
          </span>
          <span style={{ fontSize: 10, color: 'var(--fg3)' }}>▲</span>
        </div>
      </div>
    );
  }

  return (
    <div className="raised" style={{
      width: 300,
      borderColor: color,
      padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <span onClick={() => setMinimized(true)} style={{ fontSize: 10, color: 'var(--fg3)', cursor: 'pointer' }}>▼</span>
          <span onClick={onClose} style={{ fontSize: 10, color: 'var(--fg3)', cursor: 'pointer' }}>✕</span>
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--fg0)' }}>
        {notif.shipName}
      </div>
      {notif.kind === 'approved' && notif.loanExpiresAt && (
        <div style={{ fontSize: 11, color: 'var(--fg2)', marginTop: 4 }}>
          Loan expires: {new Date(notif.loanExpiresAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

// ─── Ship Registry view ────────────────────────────────────────────────────

function ShipRegistryView({ shipThumbs, me }) {
  const [phase, setPhase]             = useState('boot');
  const [fading, setFading]           = useState(false);
  const [ships, setShips]             = useState([]);
  const [search, setSearch]           = useState('');
  const [openAccordion, setOpenAccordion] = useState(null);
  // Map from ship_id → { _id (request_id), status }
  const [myRequests, setMyRequests]   = useState({});

  // RegistryBoot fetches ships and passes them here, avoiding a double fetch
  function handleBootDone(fetchedShips) {
    if (Array.isArray(fetchedShips)) setShips(fetchedShips);
    setFading(true);
    setTimeout(() => { setPhase('registry'); setFading(false); }, 200);
  }

  const fetchAccessStatus = useCallback(() => {
    api.get('/ships/access-requests/mine')
      .then(({ data }) => {
        const map = {};
        for (const r of data.as_requester || []) {
          map[r.ship_id.toString()] = { _id: r._id, status: r.status };
        }
        setMyRequests(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchAccessStatus();
  }, [fetchAccessStatus]);

  const filtered = ships.filter(s =>
    (s.ship_name || '').toLowerCase().includes(search.toLowerCase())
  );

  // Transition only applied while a fade is actually in flight — leaving
  // the `transition` property declared permanently promotes this div to
  // its own GPU layer in Chromium, which was the main cause of the
  // "burned in" ghost when switching away from Ship Registry.
  return (
    <div style={{ height: '100%', opacity: fading ? 0 : 1, transition: fading ? 'opacity 0.2s ease' : undefined }}>
      {phase === 'boot' && <RegistryBoot onComplete={handleBootDone} />}
      {phase === 'registry' && (
        <div style={{
          fontFamily: 'var(--font)',
          height: '100%', overflowY: 'auto',
          color: 'var(--fg1)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div className="sh">
            <span style={{
              fontSize: 13, fontWeight: 700, color: 'var(--fg0)',
              letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>
              Nexus ship registry
            </span>
            <span className="badge b-blue">
              {ships.length} vessels registered
            </span>
          </div>

          <div style={{ padding: '14px 16px' }}>
            <input
              className="inp"
              type="text"
              placeholder="Search vessels…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ marginBottom: 16 }}
            />

            {filtered.length === 0 ? (
              <div className="empty">No vessels found</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {filtered.map(ship => (
                <ShipRegistryCard
                  key={ship._id}
                  ship={ship}
                  shipThumbs={shipThumbs}
                  isOpen={openAccordion === ship._id}
                  onToggle={() => setOpenAccordion(prev => prev === ship._id ? null : ship._id)}
                  me={me}
                  myRequest={myRequests[ship._id?.toString()]}
                  onRequestSent={(shipId, req) => {
                    setMyRequests(prev => ({
                      ...prev,
                      [shipId.toString()]: { _id: req._id, status: 'pending' },
                    }));
                  }}
                  onRequestCancelled={(shipId) => {
                    setMyRequests(prev => {
                      const next = { ...prev };
                      delete next[shipId.toString()];
                      return next;
                    });
                  }}
                />
              ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { socket } = useSocketContext();

  const [me, setMe]                         = useState(null);
  const [missions, setMissions]             = useState([]);
  const [missionTypes, setMissionTypes]     = useState({});
  const [shipThumbs, setShipThumbs]         = useState({});
  const [selectedId, setSelectedId]         = useState(null);
  const [feedEvents, setFeedEvents]         = useState([]);
  const [feedCollapsed, setFeedCollapsed]   = useState(() => {
    try { return localStorage.getItem('nexus_feed_collapsed') === '1'; } catch { return false; }
  });
  const [showBugReport, setShowBugReport]   = useState(false);
  const [showRadioPicker, setShowRadioPicker] = useState(false);
  const [showCommandRadioPicker, setShowCommandRadioPicker] = useState(false);
  // Mirror of the Electron shell's window state so the Pin / Radio-only
  // Banner buttons reflect reality (user may toggle via keyboard or via
  // another window's control).
  const [winPinned, setWinPinned]           = useState(false);
  const [winMode, setWinMode]               = useState('full');
  useEffect(() => {
    const electron = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!electron?.onWindowState) return;
    return electron.onWindowState((s) => {
      if (s && typeof s.pinned === 'boolean') setWinPinned(s.pinned);
      if (s && typeof s.mode === 'string')   setWinMode(s.mode);
    });
  }, []);
  const [chatOpen, setChatOpen]             = useState(false);
  const chatBtnRef                          = useRef(null);
  // v1.2 — friends system (drawer + id card + accepted banner). Anchored
  // popovers for bug report / disconnect confirmation moved into the
  // nav row (Banner.jsx) so the old TopBar modal path above is only a
  // fallback.
  const [friendsOpen, setFriendsOpen]       = useState(false);
  const [idCard, setIdCard]                 = useState(null); // {userId, rect}
  const [bugPopoverOpen, setBugPopoverOpen] = useState(false);
  const [discPopoverOpen, setDiscPopoverOpen] = useState(false);
  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false);
  const [skinPopoverOpen, setSkinPopoverOpen] = useState(false);
  const [bugText, setBugText]               = useState('');
  const [bugSending, setBugSending]         = useState(false);
  const [preselectBorrowFriendId, setPreselectBorrowFriendId] = useState(null);
  const friendsBtnRef                       = useRef(null);
  const settingsBtnRef                      = useRef(null);
  const skinBtnRef                          = useRef(null);
  const messagesBtnRef                      = useRef(null);
  const [messagesPopoverOpen, setMessagesPopoverOpen] = useState(false);
  const bugBtnRef                           = useRef(null);
  const powerBtnRef                         = useRef(null);
  const friends                             = useFriends();
  const dms                                 = useDMs(me?._id);
  const updateFlow                          = useUpdateFlow();
  const [dmPeer, setDmPeer]                 = useState(null);
  const { count: chatUnread, markSeen: markChatSeen } = useChatUnread();
  const [missionListCollapsed, setMissionListCollapsed] = useState(() => {
    try { return localStorage.getItem('nexus_missionlist_collapsed') === '1'; } catch { return false; }
  });
  const [rightColCollapsed, setRightColCollapsed] = useState(() => {
    try { return localStorage.getItem('nexus_rightcol_collapsed') === '1'; } catch { return false; }
  });
  const [loadingMissions, setLoadingMissions] = useState(true);
  const [loadingFeed, setLoadingFeed]       = useState(true);
  const [timezone, setTimezone]             = useState('UTC');
  const [rankList, setRankList]             = useState([]);
  const [registerMode, setRegisterMode]           = useState(false);
  const [myShipsMode, setMyShipsMode]             = useState(false);
  const [createMissionMode, setCreateMissionMode] = useState(false);
  const [shipRegistryMode, setShipRegistryMode]   = useState(false);
  const [selectedShip, setSelectedShip]     = useState(null);
  const [leftWidth, setLeftWidth]           = useState(380);
  const [rightWidth, setRightWidth]         = useState(300);
  const [logPrompt, setLogPrompt]           = useState(null);
  const [submittedLogs, setSubmittedLogs]   = useState(() => new Set());
  const [accessRequestPopups, setAccessRequestPopups] = useState([]);
  const [lesseeNotifs, setLesseeNotifs]     = useState([]);
  const leftColumnRef                       = useRef(null);
  const rightColumnRef                      = useRef(null);

  // ─── Radio state lifted from RadioPanel ────────────────────────────────────
  // Owning these here (plus the useRadioConnection call) means the WebRTC
  // connection and every UI setting survive view changes within Dashboard.
  // When RadioPanel unmounts (e.g. flipping into MY SHIPS), the hook stays
  // alive because it's hooked at Dashboard scope; radioState / mute /
  // sensitivity / tuned frequency all persist and re-render into the panel
  // on remount without a reconnect.
  const [voiceProfile, setVoiceProfile]     = useState(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [pttKey, setPttKey]                 = useState(() => localStorage.getItem('nexus_ptt_key') || 'v');
  const [radioState, setRadioState]         = useState('standby');
  // Which tuner (if any) has its settings face open. Used to dim the
  // sibling and enforce the single-open invariant.
  const [openSettingsTuner, setOpenSettingsTuner] = useState(null); // 'crew' | 'command' | null
  const [isMuted, setIsMuted]               = useState(false);
  const [micSensitivity, setMicSensitivity] = useState(100);
  // Transport selection — no longer user-toggleable. The UDP sibling build
  // is detected via the UDP Electron shell appending ?udp=1 to the URL, or
  // (in a pure-UDP Vite bundle, if we ever ship one) via VITE_NEXUS_UDP_ONLY.
  // The main app is always WebRTC. Frozen at mount; hooks can't be chosen
  // conditionally mid-render.
  const initialTransportRef = useRef((() => {
    try {
      if (import.meta.env.VITE_NEXUS_UDP_ONLY === '1') return 'udp';
      if (typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('udp') === '1') return 'udp';
    } catch {}
    return 'webrtc';
  })());
  // Global receive-volume (percent 0..150). Governs loudness of every peer's
  // incoming voice on both the Crew and Command tuners — does not touch
  // outgoing audio. Persisted so operators don't retune it per session.
  const [rxVolume, setRxVolume] = useState(() => {
    try {
      const v = Number(localStorage.getItem('nexus_rx_volume'));
      return Number.isFinite(v) && v >= 0 && v <= 150 ? v : 100;
    } catch { return 100; }
  });
  useEffect(() => {
    try { localStorage.setItem('nexus_rx_volume', String(rxVolume)); } catch {}
  }, [rxVolume]);
  // Device selection — persisted per-browser so the operator's mic/output
  // choice sticks across sessions. `null` means "use OS default".
  const [micDeviceId, setMicDeviceIdInternal]       = useState(() => localStorage.getItem('nexus_mic_device_id') || null);
  const [outputDeviceId, setOutputDeviceIdInternal] = useState(() => localStorage.getItem('nexus_output_device_id') || null);
  const setMicDeviceId = useCallback((id) => {
    setMicDeviceIdInternal(id);
    try {
      if (id) localStorage.setItem('nexus_mic_device_id', id);
      else localStorage.removeItem('nexus_mic_device_id');
    } catch {}
  }, []);
  const setOutputDeviceId = useCallback((id) => {
    setOutputDeviceIdInternal(id);
    try {
      if (id) localStorage.setItem('nexus_output_device_id', id);
      else localStorage.removeItem('nexus_output_device_id');
    } catch {}
  }, []);

  const {
    tunedFrequency,
    peers: radioPeers,
    transmittingPeerIds,
    isPTTActive,
    micPermission,
    requestMicPermission,
    joinFrequency,
    leaveFrequency,
    getInputLevel,
    startPTT,
    stopPTT,
    setMicSensitivity: setHookMicSensitivity,
    setMuted: setHookMuted,
    setRxVolume: setHookRxVolume,
    setSrsRadioSpec,
    setSrsRadioBand,
  } = (initialTransportRef.current === 'udp' ? useRadioConnectionUDP : useRadioConnection)({
    voiceProfile,
    voiceProfileVersion: profileVersion,
    pttKey,
    micDeviceId,
    outputDeviceId,
    // Only consumed by the UDP hook; harmless for the WebRTC one.
    me,
  });

  // Player's assigned SRS radio-model DSP preset + squelch band.
  const { radio: myRadio } = useMyRadio();
  useEffect(() => { setSrsRadioSpec(myRadio?.spec || null); }, [myRadio, setSrsRadioSpec]);
  useEffect(() => { setSrsRadioBand(myRadio?.band || 'VHF'); }, [myRadio, setSrsRadioBand]);

  useEffect(() => { setHookMuted(isMuted); }, [isMuted, setHookMuted]);
  useEffect(() => { setHookMicSensitivity(micSensitivity); }, [micSensitivity, setHookMicSensitivity]);
  useEffect(() => { setHookRxVolume(rxVolume / 100); }, [rxVolume, setHookRxVolume]);

  // Auto-tune state machine: transitions standby→tuned when the hook lands
  // on a frequency, and reverts to standby if the underlying connection drops
  // mid-tuned/retuning so the panel doesn't render a stale editor.
  useEffect(() => {
    if (tunedFrequency && radioState === 'standby') setRadioState('tuned');
    if (!tunedFrequency && (radioState === 'tuned' || radioState === 'retuning')) {
      setRadioState('standby');
    }
  }, [tunedFrequency, radioState]);

  // Load voice profile from server once at Dashboard mount. PTT key: server
  // value wins, else keep the localStorage-derived default. Mirror server
  // value back into localStorage so the next init hits the same value even
  // before the fetch completes.
  useEffect(() => {
    let cancelled = false;
    api.get('/users/voice-profile').then(({ data }) => {
      if (cancelled) return;
      if (data?.ptt_key != null && data.ptt_key !== '') {
        setPttKey(data.ptt_key);
        try { localStorage.setItem('nexus_ptt_key', data.ptt_key); } catch {}
      }
      if (data?.needs_generation) {
        setVoiceProfile(randomVoiceProfile());
      } else {
        const cleaned = {};
        for (const f of RADIO_PROFILE_FIELDS) {
          cleaned[f] = data?.[f] != null ? Number(data[f]) : null;
        }
        const coreFields = ['highpass', 'lowpass', 'resonance_freq', 'resonance_q', 'distortion', 'static_level'];
        const allSet = coreFields.every(f => cleaned[f] != null);
        if (allSet) {
          if (cleaned.pitch_shift == null) cleaned.pitch_shift = 0;
          if (cleaned.bit_crush == null)   cleaned.bit_crush = 16;
          setVoiceProfile(cleaned);
        } else {
          setVoiceProfile(randomVoiceProfile());
        }
      }
    }).catch(() => {
      if (!cancelled) setVoiceProfile(randomVoiceProfile());
    });
    return () => { cancelled = true; };
  }, []);

  // Refs so the socket listener can read latest `me` and dedup set without
  // triggering listener re-registration on every state change.
  const meRef = useRef(me);
  const submittedLogsRef = useRef(submittedLogs);
  useEffect(() => { meRef.current = me; }, [me]);
  useEffect(() => { submittedLogsRef.current = submittedLogs; }, [submittedLogs]);

  const dots     = useDots(loadingMissions);
  const feedDots = useDots(loadingFeed);

  const fetchMe = useCallback(async () => {
    try { const { data } = await api.get('/auth/me'); setMe(data); } catch {}
  }, []);

  const fetchMissions = useCallback(async () => {
    try { const { data } = await api.get('/missions'); setMissions(data); }
    catch {} finally { setLoadingMissions(false); }
  }, []);

  const fetchFeed = useCallback(async () => {
    try { const { data } = await api.get('/logs?limit=50'); setFeedEvents(Array.isArray(data) ? data : []); }
    catch {} finally { setLoadingFeed(false); }
  }, []);

  const prependEvent = useCallback((event) => {
    if (!event || !event.event_type) return;
    const stamped = { ...event, timestamp: event.timestamp || new Date().toISOString() };
    setFeedEvents(prev => [stamped, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    fetchMe();
    fetchMissions();
    fetchFeed();
    api.get('/admin/config')
      .then(({ data }) => { if (data?.display_timezone) setTimezone(data.display_timezone); })
      .catch(() => {});
    api.get('/missions/types')
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(t => { map[t.name] = { description: t.description, emoji: t.emoji }; });
        setMissionTypes(map);
      })
      .catch(() => {});
    fetch('/images/ships/ship_index.json')
      .then(r => r.json()).then(idx => setShipThumbs(idx)).catch(() => {});
    api.get('/rp/ranks')
      .then(({ data }) => setRankList(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [fetchMe, fetchMissions, fetchFeed]);

  useEffect(() => {
    if (!socket) return;
    const refreshMissions = () => fetchMissions();
    const refreshMe       = () => fetchMe();

    const onSlotReserved      = (data) => { refreshMissions(); prependEvent({ ...data, event_type: 'slot_filled' }); };
    const onSlotWithdrawn     = (data) => { refreshMissions(); prependEvent({ ...data, event_type: 'slot_withdrawn' }); };
    const onMissionLaunched   = (data) => { refreshMissions(); prependEvent({ ...data, event_type: 'mission_launched' }); };
    const onMissionComplete   = (data) => { refreshMissions(); prependEvent({ ...data, event_type: 'mission_complete' }); };
    const onMissionAborted    = (data) => { refreshMissions(); prependEvent({ ...data, event_type: 'mission_aborted' }); };
    const onMissionFinalized  = (data) => { refreshMissions(); prependEvent({ ...data, event_type: 'mission_prep' }); };
    const onRankAdvanced      = (data) => { refreshMe();       prependEvent({ ...data, event_type: 'rank_advanced' }); };
    const onPostMissionLog    = (data) => prependEvent({ ...data, event_type: 'post_mission_log' });
    const onShipBorrowed      = (data) => prependEvent({ ...data, event_type: 'ship_borrowed' });
    const onPlayerConnected   = (data) => { new Audio('/sounds/user_arrival.mp3').play().catch(() => {}); prependEvent({ ...data, event_type: 'player_connected' }); };
    const onPlayerDisconnected = (data) => { new Audio('/sounds/user_departure.mp3').play().catch(() => {}); prependEvent({ ...data, event_type: 'player_disconnected' }); };

    const onPostMissionLogPrompt = (data) => {
      if (!data || !Array.isArray(data.crew)) return;
      const myMongoId = meRef.current?._id ? String(meRef.current._id) : null;
      if (!myMongoId) return;
      const inCrew = data.crew.some(c => String(c.userId) === myMongoId);
      if (!inCrew) return;
      if (submittedLogsRef.current.has(String(data.missionId))) return;
      setLogPrompt(data);
    };

    const onRpEarned = (data) => {
      refreshMe();
      const reason = (data?.reason || '').toLowerCase();
      let event_type = null;
      if (reason.includes('slot') || reason.includes('crew'))        event_type = 'slot_filled';
      else if (reason.includes('post') || reason.includes('aftermath')) event_type = 'post_mission_log';
      else if (reason.includes('launch'))                              event_type = 'mission_launched';
      else if (reason.includes('fill') || reason.includes('bonus'))    event_type = 'ship_fill_bonus';
      if (event_type) prependEvent({ ...data, event_type });
    };

    socket.on('slot_reserved',              onSlotReserved);
    socket.on('slot_withdrawn',             onSlotWithdrawn);
    socket.on('mission_launched',           onMissionLaunched);
    socket.on('mission_complete',           onMissionComplete);
    socket.on('mission_aborted',            onMissionAborted);
    socket.on('mission_finalized',          onMissionFinalized);
    socket.on('rp_earned',                  onRpEarned);
    socket.on('rank_advanced',              onRankAdvanced);
    socket.on('post_mission_log_submitted', onPostMissionLog);
    socket.on('ship_borrowed',              onShipBorrowed);
    socket.on('activity_event',             prependEvent);
    socket.on('crew_fill_updated',          refreshMissions);
    socket.on('mission_created',            refreshMissions);
    socket.on('player_connected',           onPlayerConnected);
    socket.on('player_disconnected',        onPlayerDisconnected);
    socket.on('post_mission_log_prompt',    onPostMissionLogPrompt);

    const onAccessRequested = (data) => {
      setAccessRequestPopups(prev => [...prev, { id: Date.now(), ...data }]);
    };
    const addLesseeNotif = (kind) => (data) => {
      setLesseeNotifs(prev => [...prev, { id: Date.now(), kind, ...data }]);
    };
    socket.on('ship:access_requested', onAccessRequested);
    socket.on('ship:access_approved',  addLesseeNotif('approved'));
    socket.on('ship:access_denied',    addLesseeNotif('denied'));
    socket.on('ship:access_expired',   addLesseeNotif('expired'));
    socket.on('ship:access_recalled',  addLesseeNotif('recalled'));

    return () => {
      socket.off('slot_reserved',              onSlotReserved);
      socket.off('slot_withdrawn',             onSlotWithdrawn);
      socket.off('mission_launched',           onMissionLaunched);
      socket.off('mission_complete',           onMissionComplete);
      socket.off('mission_aborted',            onMissionAborted);
      socket.off('mission_finalized',          onMissionFinalized);
      socket.off('rp_earned',                  onRpEarned);
      socket.off('rank_advanced',              onRankAdvanced);
      socket.off('post_mission_log_submitted', onPostMissionLog);
      socket.off('ship_borrowed',              onShipBorrowed);
      socket.off('activity_event',             prependEvent);
      socket.off('crew_fill_updated',          refreshMissions);
      socket.off('mission_created',            refreshMissions);
      socket.off('player_connected',           onPlayerConnected);
      socket.off('player_disconnected',        onPlayerDisconnected);
      socket.off('post_mission_log_prompt',    onPostMissionLogPrompt);
      socket.off('ship:access_requested',      onAccessRequested);
    };
  }, [socket, fetchMissions, fetchMe, prependEvent]);

  // Center-panel view routing — mission detail and mode views (MY SHIPS /
  // REGISTER SHIP / CREATE MISSION / SHIP REGISTRY) are mutually exclusive.
  // All entry points route through these two helpers so stale state cannot
  // linger (e.g. clicking a mission while SHIP REGISTRY is open must close
  // the registry; entering any mode must drop the mission selection).
  const selectMission = (id) => {
    setSelectedId(id);
    setMyShipsMode(false);
    setRegisterMode(false);
    setCreateMissionMode(false);
    setShipRegistryMode(false);
    setSelectedShip(null);
  };
  const enterMode = (mode) => {
    setSelectedId(null);
    setSelectedShip(null);
    setMyShipsMode(mode === 'myShips');
    setRegisterMode(mode === 'register');
    setCreateMissionMode(mode === 'create');
    setShipRegistryMode(mode === 'registry');
  };

  const selectedMission = missions.find(m => m._id === selectedId) ?? null;

  const availableCount = missions.filter(m =>
    m.status === 'WAITING FOR CREW' || m.status === 'FINALIZED'
  ).length;

  const myMissionId = me?.current_mission_assignment?.mission_id ?? null;
  const myMission   = myMissionId
    ? missions.find(m => String(m._id) === String(myMissionId))
    : null;
  const myMissionFrequency = myMission?.frequency ?? null;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#000',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Inter', system-ui, sans-serif",
      color: C.amber,
      overflow: 'hidden',
    }}>
      <TitleBar title="NEXUS" subtitle="Dashboard" />
      <BugReportModal open={showBugReport} onClose={() => setShowBugReport(false)} />
      <RadioPickerModal open={showRadioPicker} onClose={() => setShowRadioPicker(false)} tunerId="right" />
      <RadioPickerModal open={showCommandRadioPicker} onClose={() => setShowCommandRadioPicker(false)} tunerId="left" />
      <UpdateCard flow={updateFlow} />
      <GlobalChat
        open={chatOpen}
        onOpenChange={setChatOpen}
        anchorRef={chatBtnRef}
        markSeen={markChatSeen}
        friendIds={new Set(friends.friends.map(f => String(f.userId)))}
        presenceById={(() => { const m = {}; for (const f of friends.friends) m[String(f.userId)] = { online: !!f.online, on_mission: !!f.on_mission }; return m; })()}
        onAvatarClick={(userId, ref) => {
          setIdCard({ userId, rect: ref?.current ? ref.current.getBoundingClientRect() : null });
        }}
      />

      {/* Owner access-request popups — fixed bottom-right, stacked */}
      {accessRequestPopups.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9000,
          display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end',
        }}>
          {accessRequestPopups.map(popup => (
            <OwnerAccessPopup
              key={popup.id}
              popup={popup}
              shipThumbs={shipThumbs}
              onApprove={async (p) => {
                try {
                  await api.post(`/ships/${p.shipId}/approve-access`, { request_id: p.requestId });
                } catch {}
                setAccessRequestPopups(prev => prev.filter(x => x.id !== p.id));
              }}
              onDeny={async (p) => {
                try {
                  await api.post(`/ships/${p.shipId}/deny-access`, { request_id: p.requestId });
                } catch {}
                setAccessRequestPopups(prev => prev.filter(x => x.id !== p.id));
              }}
              onDismiss={() => setAccessRequestPopups(prev => prev.filter(x => x.id !== popup.id))}
            />
          ))}
        </div>
      )}

      {/* Lessee notifications — fixed bottom-left, stacked */}
      {lesseeNotifs.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, left: 24, zIndex: 9000,
          display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start',
        }}>
          {lesseeNotifs.map(notif => (
            <LesseeNotif
              key={notif.id}
              notif={notif}
              onClose={() => setLesseeNotifs(prev => prev.filter(x => x.id !== notif.id))}
            />
          ))}
        </div>
      )}

      {logPrompt && (
        <PostMissionLogModal
          prompt={logPrompt}
          onClose={() => setLogPrompt(null)}
          onSubmitted={() => {
            setSubmittedLogs(prev => {
              const next = new Set(prev);
              next.add(String(logPrompt.missionId));
              return next;
            });
          }}
        />
      )}

      <TopBar
        me={me}
        rankList={rankList}
        missions={missions}
        onSelectMission={(id) => selectMission(id)}
        onMissionBoard={() => enterMode('dashboard')}
        onRefresh={fetchMe}
        onRegisterShip={() => enterMode('register')}
        onMyShips={() => enterMode('myShips')}
        onCreateMission={() => enterMode('create')}
        onShipRegistry={() => enterMode('registry')}
        myShipsMode={myShipsMode}
        registerMode={registerMode}
        createMissionMode={createMissionMode}
        shipRegistryMode={shipRegistryMode}
        navigate={navigate}
        chatBtnRef={chatBtnRef}
        chatOpen={chatOpen}
        setChatOpen={setChatOpen}
        chatUnread={chatUnread}
        setShowBugReport={setShowBugReport}
        setShowRadioPicker={setShowRadioPicker}
        hideNav
      />

      {/* New nav row (Layout A). Everything that used to live in TopBar's
          nav row now lives here. */}
      <Banner
        page={
          createMissionMode ? 'missions' :
          myShipsMode       ? 'myships'  :
          registerMode      ? 'register' :
          shipRegistryMode  ? 'registry' :
          selectedMission   ? 'mymission' :
                              'missions'
        }
        canMyMission={!!myMission}
        onMissions={() => enterMode('dashboard')}
        onMyMission={() => myMission && selectMission(myMission._id)}
        onMyShips={() => enterMode('myShips')}
        onRegistry={() => enterMode('registry')}
        onRegister={() => enterMode('register')}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(o => !o)}
        chatUnread={chatUnread}
        friendsOpen={friendsOpen}
        onToggleFriends={() => setFriendsOpen(o => !o)}
        friendsUnread={friends.incomingCount}
        friendsOnline={friends.friends.filter(f => f.online).length}
        friendsBtnRef={friendsBtnRef}
        hasElectron={!!(typeof window !== 'undefined' && window.electronAPI)}
        pinned={winPinned}
        onTogglePin={async () => { try { await window.electronAPI?.togglePin?.(); } catch {} }}
        onCompanion={() => window.electronAPI?.setMode?.('companion')}
        radioOnly={winMode === 'radio'}
        onToggleRadio={() => window.electronAPI?.setMode?.('radio')}
        settingsBtnRef={settingsBtnRef}
        skinBtnRef={skinBtnRef}
        bugBtnRef={bugBtnRef}
        powerBtnRef={powerBtnRef}
        messagesBtnRef={messagesBtnRef}
        messagesUnread={dms.unreadCount}
        onOpenMessages={() => { dms.refresh(); dms.markAllSeen(); setMessagesPopoverOpen(o => !o); }}
        onOpenSkin={() => setSkinPopoverOpen(o => !o)}
        onOpenSettings={() => setSettingsPopoverOpen(o => !o)}
        onOpenBug={() => setBugPopoverOpen(true)}
        onOpenDisconnect={() => setDiscPopoverOpen(true)}
      />

      {messagesPopoverOpen && (
        <MessagesPopover
          anchorRef={messagesBtnRef}
          threads={dms.threads}
          meId={me?._id}
          presenceById={(() => { const m = {}; for (const f of friends.friends) m[String(f.userId)] = { online: !!f.online, on_mission: !!f.on_mission }; return m; })()}
          onClose={() => setMessagesPopoverOpen(false)}
          onPick={(t) => {
            const peer = { userId: String(t.peerId), name: t.name, avatar: t.avatar };
            setDmPeer(peer);
            dms.fetchMessages(peer.userId);
          }}
        />
      )}

      {skinPopoverOpen && (
        <SkinPopover
          anchorRef={skinBtnRef}
          onClose={() => setSkinPopoverOpen(false)}
        />
      )}

      {settingsPopoverOpen && (
        <SettingsPopover
          anchorRef={settingsBtnRef}
          onClose={() => setSettingsPopoverOpen(false)}
          onOpenRadioPicker={() => setShowRadioPicker(true)}
          onOpenCommandRadioPicker={() => setShowCommandRadioPicker(true)}
        />
      )}

      {bugPopoverOpen && (
        <AnchoredPopover anchorRef={bugBtnRef} width={300} onClose={() => setBugPopoverOpen(false)} label="Report a bug">
          <h4>Report a bug</h4>
          <div className="nxp-body">
            <textarea
              autoFocus
              placeholder="What went wrong?"
              value={bugText}
              onChange={e => setBugText(e.target.value)}
              aria-label="Bug description"
              maxLength={600}
            />
          </div>
          <div className="nxp-acts">
            <button className="nxp-link" onClick={() => { setBugPopoverOpen(false); setBugText(''); }}>Cancel</button>
            <button className="nxp-btn" disabled={bugSending || !bugText.trim()}
              onClick={async () => {
                setBugSending(true);
                let ok = false;
                try {
                  await api.post('/bug-report', { description: bugText.trim(), screenshots: [] });
                  ok = true;
                } catch {}
                setBugSending(false);
                setBugText('');
                setBugPopoverOpen(false);
                if (ok) toast.success('Bug report sent. Thanks.');
                else    toast.error('Bug report failed to send.');
              }}
            >{bugSending ? 'Sending…' : 'Send'}</button>
          </div>
        </AnchoredPopover>
      )}

      {discPopoverOpen && (
        <AnchoredPopover anchorRef={powerBtnRef} width={280} onClose={() => setDiscPopoverOpen(false)} label="Disconnect">
          <h4>Disconnect?</h4>
          <div className="nxp-body">
            <p>You will leave your radio frequencies and stop receiving mission updates.</p>
          </div>
          <div className="nxp-acts">
            <button className="nxp-link" onClick={() => setDiscPopoverOpen(false)}>Stay connected</button>
            <button className="nxp-btn danger" onClick={() => { setDiscPopoverOpen(false); navigate('/disconnect'); }}>Disconnect</button>
          </div>
        </AnchoredPopover>
      )}

      <FriendsDrawer
        open={friendsOpen}
        onClose={() => setFriendsOpen(false)}
        friends={friends.friends}
        received={friends.received}
        sent={friends.sent}
        onSend={friends.sendRequest}
        onAccept={friends.accept}
        onDecline={friends.decline}
        onCancel={friends.cancel}
        onRemove={friends.remove}
        onBorrow={(f) => {
          setFriendsOpen(false);
          setIdCard(null);
          // If we're not already viewing a mission, bounce to the dashboard
          // so MissionShipsStrip has a mission to mount against.
          if (!selectedMission && myMission) selectMission(myMission._id);
          setPreselectBorrowFriendId(String(f.userId || f.id));
        }}
        onMessage={(f) => {
          setDmPeer(f);
          dms.fetchMessages(f.userId);
        }}
        onOpenCard={(userId, ref) => {
          setIdCard({ userId, rect: ref?.current ? ref.current.getBoundingClientRect() : null });
        }}
        returnFocusRef={friendsBtnRef}
      />

      {dmPeer && (
        <DMPane
          meId={me?._id}
          peer={dmPeer}
          presenceById={(() => { const m = {}; for (const f of friends.friends) m[String(f.userId)] = { online: !!f.online, on_mission: !!f.on_mission }; return m; })()}
          messages={dms.messagesByPeer[String(dmPeer.userId)] || []}
          onOpen={(p) => { dms.setOpenPeer(p.userId); dms.markSeen(p.userId); }}
          onClose={() => { dms.setOpenPeer(null); setDmPeer(null); }}
          onSend={(peerId, body) => dms.send(peerId, body)}
        />
      )}

      {idCard?.userId && (
        <IdCardPopover
          anchorRect={idCard.rect}
          userId={idCard.userId}
          friends={friends.friends}
          onClose={() => setIdCard(null)}
          onBorrow={(card) => {
            setIdCard(null);
            setFriendsOpen(false);
            if (!selectedMission && myMission) selectMission(myMission._id);
            setPreselectBorrowFriendId(String(card.id));
          }}
          onMessage={(card) => {
            const peer = { userId: String(card.id), name: card.name, avatar: card.avatar, online: card.online, on_mission: card.on_mission };
            setDmPeer(peer);
            dms.fetchMessages(peer.userId);
            setIdCard(null);
          }}
        />
      )}

      <FriendAcceptedBanner event={friends.lastAccepted} onDismiss={friends.clearLastAccepted} />

      {/* 3-panel grid (or MY SHIPS panel when myShipsMode) */}
      <div style={{
        flex: 1,
        display: myShipsMode ? 'block' : 'grid',
        gridTemplateColumns: `${missionListCollapsed ? 44 : leftWidth}px 1fr ${rightColCollapsed ? 44 : rightWidth}px`,
        minHeight: 0,
        zIndex: 1,
        overflow: 'hidden',
        animation: myShipsMode ? 'fadeInCols 0.25s ease-out' : 'none',
      }}>
        {myShipsMode ? (
          <MyShips
            selectedShip={selectedShip}
            setSelectedShip={setSelectedShip}
            onBack={() => { setMyShipsMode(false); setSelectedShip(null); }}
            onRegisterShip={() => enterMode('register')}
            onViewLiveMission={(missionId) => selectMission(missionId)}
            leftWidth={leftWidth}
            setLeftWidth={setLeftWidth}
            rightWidth={rightWidth}
            setRightWidth={setRightWidth}
          />
        ) : (
          <>

        {/* Left: Mission list */}
        <div ref={leftColumnRef} style={{
          position: 'relative',
          borderRight: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {!missionListCollapsed && (
            <ColumnResizeHandle side="right" columnRef={leftColumnRef} setWidth={setLeftWidth} />
          )}
          <div className="sh" style={missionListCollapsed ? { padding: '7px 4px', justifyContent: 'center' } : undefined}>
            {!missionListCollapsed && <span>Mission Board</span>}
            {!missionListCollapsed && <span className="badge b-blue">{availableCount} open</span>}
            <button
              className="btn"
              onClick={() => {
                const next = !missionListCollapsed;
                setMissionListCollapsed(next);
                try { localStorage.setItem('nexus_missionlist_collapsed', next ? '1' : '0'); } catch {}
              }}
              title={missionListCollapsed ? 'Expand mission board' : 'Collapse mission board'}
              aria-label={missionListCollapsed ? 'Expand mission board' : 'Collapse mission board'}
              style={{
                padding: '3px 8px',
                fontSize: 12,
                letterSpacing: 0,
                minWidth: 32,
                marginLeft: missionListCollapsed ? 0 : 'auto',
              }}
            >
              {missionListCollapsed ? '»' : '«'}
            </button>
          </div>

          {missionListCollapsed ? (
            // Collapsed rail — stays visibly present so the player always
            // knows the mission board is still there. Vertical label +
            // open-count badge + clickable column to re-expand.
            <div
              onClick={() => {
                setMissionListCollapsed(false);
                try { localStorage.setItem('nexus_missionlist_collapsed', '0'); } catch {}
              }}
              title="Click to expand mission board"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '14px 0',
                gap: 12,
                cursor: 'pointer',
                transition: 'background .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(102,170,221,.06)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span className="badge b-blue" style={{ fontSize: 11 }}>{availableCount}</span>
              <div style={{
                writingMode: 'vertical-rl',
                transform: 'rotate(180deg)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.22em',
                color: 'var(--blue)',
                textTransform: 'uppercase',
                textShadow: '0 0 6px color-mix(in srgb, var(--blue) 45%, transparent)',
                userSelect: 'none',
              }}>
                Mission Board
              </div>
              <div style={{
                fontSize: 10, color: 'var(--fg3)',
                writingMode: 'vertical-rl',
                transform: 'rotate(180deg)',
                letterSpacing: '0.12em',
                userSelect: 'none',
              }}>
                click to open
              </div>
            </div>
          ) : (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loadingMissions ? (
                <div className="empty">Scanning{dots}</div>
              ) : missions.length === 0 ? (
                <div className="empty">No active missions</div>
              ) : (
                <MissionBoardV2
                  missions={missions}
                  selectedMissionId={selectedMission?._id ?? null}
                  onSelect={selectMission}
                  missionTypes={missionTypes}
                  shipThumbs={shipThumbs}
                  onNewMission={() => enterMode('create')}
                />
              )}
            </div>
          )}
        </div>

        {/* Center: Mission detail OR Ship Registration */}
        {/* isolation:isolate gives each mounted child its own compositor
            scope so Chromium tears down the GPU layer cleanly on tab
            swap — fixes the "ship registry stays faded behind the
            mission view" ghost. */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, isolation: 'isolate' }}>
          {createMissionMode ? (
            <CreateMission
              me={me}
              onClose={() => setCreateMissionMode(false)}
              onSuccess={() => { setCreateMissionMode(false); fetchMissions(); }}
            />
          ) : registerMode ? (
            <ShipRegistration
              me={me}
              onClose={() => setRegisterMode(false)}
              onSuccess={() => setRegisterMode(false)}
            />
          ) : shipRegistryMode ? (
            <ShipRegistryView shipThumbs={shipThumbs} me={me} />
          ) : selectedMission ? (
            selectedMission.status === 'IN PROGRESS' ? (
              <InProgressView
                key={selectedMission._id}
                mission={selectedMission}
                me={me}
                onRefresh={fetchMissions}
                onFeedRefresh={fetchFeed}
                shipThumbs={shipThumbs}
              />
            ) : (
              <MissionDetail
                key={selectedMission._id}
                mission={selectedMission}
                me={me}
                timezone={timezone}
                onRefresh={fetchMissions}
                onFeedRefresh={fetchFeed}
                missionTypes={missionTypes}
                preselectBorrowFriendId={preselectBorrowFriendId}
                onBorrowFriendConsumed={() => setPreselectBorrowFriendId(null)}
              />
            )
          ) : !loadingMissions ? (
            <div className="empty" style={{ padding: '48px 24px', fontSize: 13 }}>
              Select a mission to view details.
            </div>
          ) : null}
        </div>

        {/* Right: Activity feed + persistent radio panel. Entire column
            collapsible to a 44 px rail (same pattern as the mission
            board column on the left). State persists in localStorage. */}
        <div ref={rightColumnRef} style={{
          position: 'relative',
          borderLeft: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
        }}>
          {!rightColCollapsed && (
            <ColumnResizeHandle side="left" columnRef={rightColumnRef} setWidth={setRightWidth} />
          )}

          {rightColCollapsed ? (
            // Collapsed rail — stays visibly present so the player
            // never loses the radio/feed. Vertical label + unread
            // feed-event hint + clickable area to re-expand.
            <div
              onClick={() => {
                setRightColCollapsed(false);
                try { localStorage.setItem('nexus_rightcol_collapsed', '0'); } catch {}
              }}
              title="Click to expand activity feed + radio"
              style={{
                flex: 1,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', padding: '14px 0', gap: 12,
                cursor: 'pointer', transition: 'background .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(102,170,221,.06)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setRightColCollapsed(false);
                  try { localStorage.setItem('nexus_rightcol_collapsed', '0'); } catch {}
                }}
                title="Expand"
                style={{ padding: '3px 8px', fontSize: 12, minWidth: 32 }}
              >
                «
              </button>
              <div style={{
                writingMode: 'vertical-rl',
                transform: 'rotate(180deg)',
                fontSize: 11, fontWeight: 700,
                letterSpacing: '0.22em', textTransform: 'uppercase',
                color: 'var(--blue)',
                textShadow: '0 0 6px color-mix(in srgb, var(--blue) 45%, transparent)',
                userSelect: 'none',
              }}>
                Activity · Radio
              </div>
              <div style={{
                fontSize: 10, color: 'var(--fg3)',
                writingMode: 'vertical-rl',
                transform: 'rotate(180deg)',
                letterSpacing: '0.12em', userSelect: 'none',
              }}>
                click to open
              </div>
            </div>
          ) : (
            <>
          <div className="sh" style={{
            borderBottom: '1px solid var(--rim0)',
            padding: '7px 10px',
            display: 'flex', alignItems: 'center',
          }}>
            <button
              className="btn"
              onClick={() => {
                setRightColCollapsed(true);
                try { localStorage.setItem('nexus_rightcol_collapsed', '1'); } catch {}
              }}
              title="Collapse column"
              aria-label="Collapse right column"
              style={{ padding: '3px 8px', fontSize: 12, minWidth: 32 }}
            >
              »
            </button>
          </div>
          <div style={{ flex: feedCollapsed ? '0 0 auto' : 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="sh">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="live-dot" />
                Activity feed
              </span>
              <button
                className="btn"
                onClick={() => {
                  const next = !feedCollapsed;
                  setFeedCollapsed(next);
                  try { localStorage.setItem('nexus_feed_collapsed', next ? '1' : '0'); } catch {}
                }}
                title={feedCollapsed ? 'Expand activity feed' : 'Collapse activity feed'}
                aria-label={feedCollapsed ? 'Expand activity feed' : 'Collapse activity feed'}
                style={{
                  padding: '3px 8px',
                  fontSize: 12,
                  letterSpacing: 0,
                  minWidth: 32,
                }}
              >
                {feedCollapsed ? '«' : '»'}
              </button>
            </div>
            {!feedCollapsed && (
              <ActivityFeed
                events={feedEvents}
                loading={loadingFeed}
                loadingHint={feedDots}
              />
            )}
          </div>
          {/* v0.9.8 — Mirrored radio layout per the Radio Mirror Layouts
              spec. One shared mic strip, two identical modules below. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <SharedMicStrip
              getLevel={getInputLevel}
              sensitivity={micSensitivity}
              setSensitivity={setMicSensitivity}
              rxVolume={rxVolume}
              setRxVolume={setRxVolume}
              isActive={micPermission === 'granted'}
            />
            <CrewRadioCard
              tunedFrequency={tunedFrequency}
              peers={radioPeers}
              transmittingPeerIds={transmittingPeerIds}
              isPTTActive={isPTTActive}
              joinFrequency={joinFrequency}
              leaveFrequency={leaveFrequency}
              startPTT={startPTT}
              stopPTT={stopPTT}
              pttKey={pttKey}
              setPttKey={setPttKey}
              onOpenSettings={() => setRadioState('settings')}
              siblingSettingsOpen={openSettingsTuner === 'command'}
              onSettingsOpenChange={(open) => setOpenSettingsTuner(open ? 'crew' : (prev => prev === 'crew' ? null : prev)(openSettingsTuner))}
            />
            <CommandRadioCard
              voiceProfile={voiceProfile}
              srsSpec={myRadio?.spec || null}
              micDeviceId={micDeviceId}
              outputDeviceId={outputDeviceId}
              otherPttKey={pttKey}
              rxVolume={rxVolume}
              onOpenSettings={() => setRadioState('settings')}
              siblingSettingsOpen={openSettingsTuner === 'crew'}
              onSettingsOpenChange={(open) => setOpenSettingsTuner(open ? 'command' : (prev => prev === 'command' ? null : prev)(openSettingsTuner))}
            />
          </div>
          {radioState === 'settings' && (
            <div style={{ marginTop: 8 }}>
              <RadioPanel
                missionFrequency={myMissionFrequency}
                missionId={myMissionId}
                voiceProfile={voiceProfile}
                setVoiceProfile={setVoiceProfile}
                profileVersion={profileVersion}
                setProfileVersion={setProfileVersion}
                pttKey={pttKey}
                setPttKey={setPttKey}
                radioState={radioState}
                setRadioState={setRadioState}
                isMuted={isMuted}
                setIsMuted={(fn) => {
                  const next = typeof fn === 'function' ? fn(isMuted) : !!fn;
                  if (next !== isMuted) {
                    try {
                      new Audio(next ? '/sounds/mute_mic.mp3' : '/sounds/unmute_mic.mp3').play().catch(() => {});
                    } catch {}
                  }
                  setIsMuted(fn);
                }}
                micSensitivity={micSensitivity}
                setMicSensitivity={setMicSensitivity}
                tunedFrequency={tunedFrequency}
                peers={radioPeers}
                transmittingPeerIds={transmittingPeerIds}
                isPTTActive={isPTTActive}
                joinFrequency={joinFrequency}
                leaveFrequency={leaveFrequency}
                getInputLevel={getInputLevel}
                startPTT={startPTT}
                stopPTT={stopPTT}
                micDeviceId={micDeviceId}
                setMicDeviceId={setMicDeviceId}
                outputDeviceId={outputDeviceId}
                setOutputDeviceId={setOutputDeviceId}
                micPermission={micPermission}
                requestMicPermission={requestMicPermission}
              />
            </div>
          )}
            </>
          )}
        </div>

          </>
        )}
      </div>
    </div>
  );
}
