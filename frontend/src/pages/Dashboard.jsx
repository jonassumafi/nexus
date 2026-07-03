import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocketContext } from '../context/SocketContext';
import api from '../services/api';
import { formatTimestamp, formatFeedTimestamp } from '../utils/time';
import ShipSchematic from '../components/ShipSchematic';
import ShipRegistration from '../components/ShipRegistration';
import MyShips from '../components/MyShips';
import CreateMission from '../components/CreateMission';
import ColumnResizeHandle from '../components/ColumnResizeHandle';
import RadioPanel from '../components/RadioPanel';
import RegistryBoot from '../components/RegistryBoot';
import { useRadioConnection } from '../hooks/useRadioConnection';
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
  amber:  '#66AADD',
  gold:   '#99CCFF',
  dim:    '#2A6A9A',
  border: '#1A3D55',
  green:  '#33DDAA',
  red:    '#FF5544',
  bgSel:  '#050F1A',
  deep:   '#0D2030',
  cyan:   '#00EEFF',
};

const STATUS_COLOR = {
  'WAITING FOR CREW': '#FFBB33',
  'FINALIZED':        '#FFBB33',
  'IN PROGRESS':      '#33DDAA',
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
  'FINALIZED':        { bg: 'rgba(102,170,221,0.15)', border: '#66AADD', text: '#99CCFF', dot: '#66AADD', dotAnim: 'pulse-dot 1.4s ease-in-out infinite', label: 'PREPARING FOR LAUNCH' },
  'IN PROGRESS':      { bg: 'rgba(51,221,170,0.12)',  border: '#33DDAA', text: '#66EEBB', dot: '#33DDAA', dotAnim: 'pulse-dot 0.8s ease-in-out infinite', label: 'IN PROGRESS' },
  'COMPLETE':         { bg: 'rgba(68,136,187,0.12)',  border: '#4488BB', text: '#66AADD', dot: '#4488BB', dotAnim: 'none', label: 'COMPLETE' },
  'ABORT':            { bg: 'rgba(255,85,68,0.12)',   border: '#FF5544', text: '#FF8877', dot: '#FF5544', dotAnim: 'none', label: 'ABORTED' },
};

const EVENT_LABEL = {
  MISSION_LAUNCHED: 'launched mission',
  POST_MISSION_LOG: 'submitted post-log',
  CREW_SLOT_FILLED: 'reserved crew slot',
  SHIP_FILL_BONUS:  'earned ship bonus',
};

// Four-color feed palette:
//   LIME   #44FF88 — positive/earned  (slot fills, mission progress, RP gains)
//   BLUE   #66AADD — neutral/info     (creation, joins, disconnects, borrows)
//   RED    #FF5544 — termination      (abort, queue expiry)
//   PURPLE #AA66DD — AI summaries only
const FEED_LIME = { accent: '#44FF88', bg: 'rgba(68,255,136,0.08)',  text: '#CCFFE0' };
const FEED_BLUE = { accent: '#66AADD', bg: 'rgba(102,170,221,0.08)', text: '#CCE8FF' };
const FEED_RED  = { accent: '#FF5544', bg: 'rgba(255,85,68,0.08)',   text: '#FFD4D0' };
const FEED_PURP = { accent: '#AA66DD', bg: 'rgba(170,102,221,0.08)', text: '#E8D4FF' };
const FEED_CATEGORY = {
  // LIME — earned / positive
  slot_filled:         FEED_LIME,
  mission_launched:    FEED_LIME,
  mission_complete:    FEED_LIME,
  ship_fill_bonus:     FEED_LIME,
  rank_advanced:       FEED_LIME,   // legacy event_type
  rank_advancement:    FEED_LIME,   // new broadcast event_type
  post_mission_log:    FEED_LIME,
  // BLUE — neutral / info
  mission_created:     FEED_BLUE,
  slot_withdrawn:      FEED_BLUE,
  mission_prep:        FEED_BLUE,
  ship_borrowed:       FEED_BLUE,
  player_connected:    FEED_BLUE,
  player_disconnected: FEED_BLUE,
  // RED — termination
  mission_aborted:     FEED_RED,
  queue_expired:       FEED_RED,
  // PURPLE — AI-generated
  ai_summary:          FEED_PURP,
};
const DEFAULT_FEED_CAT = FEED_BLUE;

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
  'Reconnaissance': { bg: 'rgba(102,170,221,0.15)', border: '#66AADD', text: '#99CCFF' },
  'Salvage':        { bg: 'rgba(170,102,221,0.15)', border: '#AA66DD', text: '#CC99FF' },
  'Mining':         { bg: 'rgba(255,170,51,0.12)',  border: '#FFAA33', text: '#FFBB66' },
  'Bounty':         { bg: 'rgba(255,51,102,0.15)',  border: '#FF3366', text: '#FF6688' },
  'Patrol':         { bg: 'rgba(51,221,170,0.12)',  border: '#33DDAA', text: '#66EEBB' },
  'Assassination':  { bg: 'rgba(221,51,51,0.15)',   border: '#DD3333', text: '#FF6666' },
  'Rescue':         { bg: 'rgba(51,187,255,0.12)',  border: '#33BBFF', text: '#66CCFF' },
  'Assault':        { bg: 'rgba(255,102,51,0.15)',  border: '#FF6633', text: '#FF8855' },
};
const DEFAULT_BADGE = { bg: 'rgba(42,106,154,0.15)', border: '#2A6A9A', text: '#99CCFF' };

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
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
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
        border: `1px solid ${disabled ? C.deep : hover ? color : '#4488BB'}`,
        color: disabled ? C.deep : hover ? color : '#66AADD',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
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
  const [hover, setHover] = useState(false);
  const docNo = computeDocNo(me);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 560,
        background: '#FFFFFF',
        border: `1px solid ${hover ? '#00EEFF' : '#2A6A9A'}`,
        boxShadow: hover ? '0 0 8px rgba(0,238,255,0.3)' : 'none',
        cursor: 'pointer',
        display: 'flex',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
      }}
    >
      {/* Left column — portrait strip */}
      <div style={{
        width: 80,
        background: '#1A3A50',
        borderRight: '1px solid #2A6A9A',
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        {me?.portrait_url && (
          <img
            src={me.portrait_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
      </div>
      {/* Right column — card body */}
      <div style={{
        padding: '12px 20px',
        background: '#FFFFFF',
        flex: 1,
        minWidth: 0,
      }}>
        <div style={{ fontSize: 14, color: '#2A3A4A', letterSpacing: '0.14em' }}>
          UEE IDENTIFICATION — NEXUS
        </div>
        <div style={{
          fontSize: 26, color: '#0D1A24', fontWeight: 'bold',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {me?.citizen_name ?? 'UNKNOWN OPERATOR'}
        </div>
        <div style={{
          fontSize: 20, color: '#0D1A24',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {me?.rp_rank?.title ?? 'DRIFTER'}
        </div>
        <div style={{ borderTop: '1px solid #C8B898', margin: '10px 0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 16, color: '#0D1A24', fontWeight: 'bold' }}>RP</span>
          <div style={{
            flex: 1, height: 8,
            background: '#C8B898',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              width: `${rpPct}%`, background: '#1A5A8A',
            }} />
          </div>
          <span style={{ fontSize: 16, color: '#0D1A24', fontWeight: 'bold' }}>
            {rpLabel}
          </span>
        </div>
        <div style={{ fontSize: 14, color: '#2A3A4A', marginTop: 8, letterSpacing: '0.06em' }}>
          DOC NO. {docNo}
        </div>
      </div>
    </div>
  );
}

function IdCardModal({ me, onClose }) {
  const CARD_FONT = "'JetBrains Mono', 'Courier New', Courier, monospace";
  const docNo = computeDocNo(me);
  const regDate = me?.created_at
    ? new Date(me.created_at).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];
  const portraitUrl = me?.portrait_url || me?.profile_url;

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
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9500,
        padding: 20,
      }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close ID card"
        style={{
          position: 'absolute', top: 20, right: 20,
          width: 36, height: 36,
          background: 'none', border: '1px solid #66AADD',
          color: '#66AADD', fontSize: 20, cursor: 'pointer',
          fontFamily: CARD_FONT,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>

      {/* Card — mirrors Onboarding.jsx Step6 styling (lines 452–555) exactly.
          Duplicated verbatim so this modal has no cross-file coupling and
          Step6's card can evolve independently for the preview experience. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 700, margin: '0 auto', width: '100%', fontFamily: CARD_FONT }}
      >
        <div style={{ background: '#06121C', border: '1px solid #2A6A9A' }}>
          {/* Header */}
          <div style={{
            padding: '14px 20px',
            borderBottom: '1px solid #2A6A9A',
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
                border: '1px solid #2A6A9A',
                background: '#11202F',
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
              <div style={{ fontSize: 10, color: '#FFBB33', marginTop: 10, letterSpacing: '0.08em', fontWeight: 'bold' }}>
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
                  <div style={{ fontSize: 11, color: '#66AADD', letterSpacing: '0.12em', marginBottom: 4, fontWeight: 'bold' }}>
                    {field.label}
                  </div>
                  <div style={{ fontSize: 17, color: '#CCE8FF', fontWeight: 'bold', letterSpacing: '0.04em' }}>
                    {field.value || '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '10px 20px',
            borderTop: '1px solid #2A6A9A',
            background: '#0A1A28',
            fontSize: 10,
            color: '#FFBB33',
            letterSpacing: '0.05em',
          }}>
            {'P<UEE<<CITIZEN<RECORD<<<<<<<<<<<<<<<<<<<'}
          </div>
        </div>
      </div>
    </div>
  );
}

function TopBar({ me, rankList, missions, onSelectMission, onRegisterShip, onMyShips, onCreateMission, onShipRegistry, myShipsMode, registerMode, createMissionMode, shipRegistryMode, navigate }) {
  const [hoverBtn, setHoverBtn] = useState(null);
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
    border: '1px solid #4488BB',
    color: h ? '#000' : '#99CCFF',
    background: h ? '#4488BB' : '#000',
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
          color: s.color,
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          fontSize: 18, letterSpacing: '0.12em',
          padding: '6px 16px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          textAlign: 'left',
        }}
      >{label}</button>
    );
  };

  return (
    <>
      {/* Tier 1: system label */}
      <div style={{
        width: '100%',
        padding: '4px 20px 0',
        fontSize: 9,
        color: '#1A3D55',
        letterSpacing: '0.18em',
        background: '#000',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        flexShrink: 0,
      }}>
        NEXUS INTERSTELLAR TRAFFIC SYSTEM
      </div>

      {/* Tier 2: main top bar */}
      <div style={{
        background: '#000',
        borderBottom: '1px solid #1A3D55',
        padding: '10px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        flexShrink: 0,
        zIndex: 1,
      }}>

        {/* LEFT: action buttons (horizontal row) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {btn('create', '[ + CREATE MISSION ]',
            createMissionMode ? activeStyle : idleStyle,
            () => onCreateMission?.()
          )}
          {btn('ships', '[ MY SHIPS ]',
            myShipsMode ? activeStyle : idleStyle,
            () => onMyShips?.()
          )}
          {btn('register', '⊕ REGISTER SHIP',
            registerMode ? activeStyle : idleStyle,
            () => onRegisterShip?.()
          )}
          {btn('registry', '[ SHIP REGISTRY ]',
            shipRegistryMode ? activeStyle : idleStyle,
            () => onShipRegistry?.()
          )}
          {me?.org_id && btn('roster', '[ ORG ROSTER ]',
            idleStyle,
            () => {}
          )}
          {myMission && btn('mymission', '[ MY MISSION ]',
            idleStyle,
            () => onSelectMission(myMission._id)
          )}
          <div style={{ width: 1, height: 28, background: '#1A3D55', flexShrink: 0 }} />
          {btn('disconnect', '[ DISCONNECT ]',
            dangerStyle,
            () => navigate('/disconnect')
          )}
        </div>

        {/* RIGHT: mini UEE ID card widget — click to expand to full modal */}
        <IdCardWidget
          me={me}
          rpPct={rpPct}
          rpLabel={rpLabel}
          onClick={() => setShowIdCard(true)}
        />

      </div>

      {showIdCard && (
        <IdCardModal me={me} onClose={() => setShowIdCard(false)} />
      )}
    </>
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
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
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
          background: '#0D2030',
          border: '1px solid #1A3D55',
          color: '#99CCFF',
          fontSize: 16,
          padding: '6px 12px',
          whiteSpace: 'normal',
          maxWidth: 280,
          lineHeight: 1.6,
          zIndex: 9999,
          pointerEvents: 'none',
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          letterSpacing: '0.06em',
        }}>
          {description}
        </div>
      )}
    </>
  );
}

function MissionCard({ mission, selected, onClick, missionTypes = {}, shipThumbs = {} }) {
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
          color: STATUS_COLOR[mission.status] ?? '#99CCFF',
        }}>
          {STATUS_ABBR[mission.status] ?? mission.status}
        </span>
      </div>

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

      <div style={{ fontSize: 16, color: '#99CCFF', marginTop: 4 }}>
        PRIMARY: {primaryShip?.ship_name ?? primaryShip?.type ?? '—'}
        {extraShips > 0 && (
          <span style={{ color: '#99CCFF' }}> +{extraShips} SHIP{extraShips > 1 ? 'S' : ''}</span>
        )}
      </div>

      {totalSlots > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <div style={{ flex: 1, height: 6, background: '#1A3D55', position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${fillPct}%`, background: C.amber,
            }} />
          </div>
          <span style={{ fontSize: 16, color: '#99CCFF' }}>{fillPct}%</span>
        </div>
      )}
    </div>
  );
}

function MissionDetail({ mission, me, timezone, onRefresh, onFeedRefresh, missionTypes = {} }) {
  const [working, setWorking]           = useState(false);
  const [postLogOpen, setPostLogOpen]   = useState(false);
  const [logText, setLogText]           = useState('');
  const [shipIndex, setShipIndex]       = useState(0);
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

  // Creator control buttons by mission status
  const ctrlBtn = (label, onClick, extraStyle = {}) => (
    <button
      key={label}
      onClick={onClick && !working ? () => { playClick(); onClick(); } : undefined}
      style={{
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        fontSize: 16, letterSpacing: '0.12em',
        padding: '10px 16px',
        display: 'block', width: '100%', textAlign: 'center',
        background: 'none',
        cursor: onClick && !working ? 'pointer' : 'default',
        pointerEvents: onClick && !working ? 'auto' : 'none',
        ...extraStyle,
      }}
    >{label}</button>
  );

  const DIM   = { border: '1px solid #1A3D55', color: '#1A3D55' };
  const FLAT_BLUE  = { border: '1px solid #2A6A9A', color: '#66AADD' };
  const PULSE_BLUE = { border: '1px solid #99CCFF', color: '#CCE8FF', animation: 'pulse-btn-blue 1.2s ease-in-out infinite' };
  const PULSE_GREEN = { border: '1px solid #33DDAA', color: '#66EEBB', animation: 'pulse-btn-green 1.2s ease-in-out infinite' };
  const ACTIVE_RED  = { border: '1px solid #FF5544', color: '#FF8877' };

  const creatorButtons = () => {
    if (s === 'WAITING FOR CREW') return [
      ctrlBtn('[ PREPARE FOR LAUNCH ]', () => handleStatusChange('FINALIZED'), PULSE_BLUE),
      ctrlBtn('[ LAUNCH MISSION ]',     null, DIM),
      ctrlBtn('[ ABORT MISSION ]',      () => handleStatusChange('ABORTED'),   ACTIVE_RED),
    ];
    if (s === 'FINALIZED') return [
      ctrlBtn('[ MISSION LOCKED ]',   null, FLAT_BLUE),
      ctrlBtn('[ LAUNCH MISSION ]',   () => handleStatusChange('IN PROGRESS'), PULSE_GREEN),
      ctrlBtn('[ ABORT MISSION ]',    () => handleStatusChange('ABORTED'),     ACTIVE_RED),
    ];
    if (s === 'IN PROGRESS') {
      if (confirmComplete) {
        return [
          <div key="complete-confirm" style={{
            border: '1px solid #33DDAA', padding: '12px', marginBottom: 4,
            fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          }}>
            <div style={{ fontSize: 12, color: '#33DDAA', letterSpacing: '0.1em', fontWeight: 'bold', marginBottom: 6 }}>
              CONFIRM MISSION COMPLETE?
            </div>
            <div style={{ fontSize: 11, color: '#66AADD', letterSpacing: '0.08em', marginBottom: 10, lineHeight: 1.5 }}>
              This will finalize all crew RP and archive the mission.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={!working ? handleCompleteMission : undefined}
                style={{
                  flex: 1,
                  fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                  fontSize: 12, letterSpacing: '0.1em',
                  padding: '7px 8px', border: '1px solid #33DDAA',
                  color: '#33DDAA', background: '#000', cursor: working ? 'default' : 'pointer',
                }}
              >✓ CONFIRM</button>
              <button
                onClick={() => setConfirmComplete(false)}
                style={{
                  flex: 1,
                  fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                  fontSize: 12, letterSpacing: '0.1em',
                  padding: '7px 8px', border: '1px solid #66AADD',
                  color: '#66AADD', background: '#000', cursor: 'pointer',
                }}
              >CANCEL</button>
            </div>
          </div>,
          ctrlBtn('[ ABORT MISSION ]', () => handleStatusChange('ABORTED'), ACTIVE_RED),
        ];
      }
      return [
        <button
          key="complete-mission"
          onClick={!working ? () => { playClick(); setConfirmComplete(true); } : undefined}
          onMouseEnter={() => setHoverComplete(true)}
          onMouseLeave={() => setHoverComplete(false)}
          style={{
            fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
            fontSize: 15, letterSpacing: '0.1em', fontWeight: 'bold',
            padding: '10px 0',
            display: 'block', width: '100%', textAlign: 'center',
            border: '2px solid #33DDAA',
            color: hoverComplete ? '#000' : '#33DDAA',
            background: hoverComplete ? '#33DDAA' : '#000',
            cursor: working ? 'default' : 'pointer',
            marginBottom: 4,
          }}
        >[ COMPLETE MISSION ]</button>,
        ctrlBtn('[ ABORT MISSION ]', () => handleStatusChange('ABORTED'), ACTIVE_RED),
      ];
    }
    return null;
  };

  return (
    <div style={{
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
      fontSize: 16, color: C.amber,
      height: '100%', display: 'flex', flexDirection: 'column',
      position: 'relative',
    }}>

      {/* Frequency reveal overlay */}
      {freqReveal && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 20,
          background: '#040D15',
          border: '1px solid #00EEFF',
          padding: '24px 32px',
          textAlign: 'center',
          minWidth: 280,
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        }}>
          <div style={{ fontSize: 13, color: '#33DDAA', letterSpacing: '0.14em' }}>
            SLOT RESERVED
          </div>
          <div style={{ fontSize: 11, color: '#66AADD', letterSpacing: '0.14em', marginTop: 12 }}>
            MISSION FREQUENCY
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={{
              fontSize: 32, color: '#00EEFF', letterSpacing: '0.2em',
              animation: 'freqPulse 1s ease-in-out infinite',
            }}>
              {freqReveal}
            </span>
            <span style={{ fontSize: 16, color: '#66AADD', marginLeft: 6 }}>MHz</span>
          </div>
          <div style={{ fontSize: 10, color: '#66AADD', letterSpacing: '0.14em', marginTop: 12 }}>
            NEXUS COMM SYSTEM
          </div>
          <div style={{ fontSize: 10, color: '#1A3D55', letterSpacing: '0.1em', marginTop: 4 }}>
            TUNE IN TO JOIN YOUR CREW
          </div>
        </div>
      )}

      {/* Fixed header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #0D2030', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>

          {/* Left: mission info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 28, color: '#CCE8FF', fontWeight: 'bold', letterSpacing: '0.04em', marginBottom: 8 }}>
              {strippedName}
            </div>
            <StatusBadge status={s} />
            <div style={{ fontSize: 16, color: '#66AADD', marginBottom: 8 }}>
              COMMANDER: <span style={{ color: '#99CCFF' }}>{mission.created_by?.citizen_name ?? '—'}</span>
            </div>
            <div style={{ marginBottom: mission.objectives ? 14 : 0 }}>
              <TypeBadge missionType={mission.mission_type} description={typeInfo.description} />
            </div>
            {mission.objectives && (
              <>
                <div style={{ fontSize: 16, color: '#66AADD', letterSpacing: '0.16em', marginBottom: 6, marginTop: 14 }}>
                  OBJECTIVES
                </div>
                <div style={{ fontSize: 16, color: '#B88000', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
                  {mission.objectives}
                </div>
              </>
            )}
          </div>

          {/* Right: creator controls */}
          {isCreator && s !== 'COMPLETE' && s !== 'ABORT' && (
            <div style={{ minWidth: 220, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
              <div style={{ fontSize: 16, color: '#66AADD', letterSpacing: '0.14em', marginBottom: 4 }}>
                MISSION CONTROLS
              </div>
              {creatorButtons()}
              {crewNote && (
                <div style={{ fontSize: 16, color: '#FF5544', textAlign: 'right', marginTop: 4, letterSpacing: '0.06em' }}>
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
        <div style={{ marginBottom: 16 }}>
          <ShipSchematic
            ships={ships}
            shipIndex={shipIndex}
            onShipIndexChange={setShipIndex}
            currentUserId={myId}
            onSlotClick={handleSlotClick}
            missionStatus={s}
            me={me}
            flashMySlots={flashMySlots}
          />
        </div>

        {mission.mission_time && (
          <div style={{ marginBottom: 8, fontSize: 16, color: '#66AADD' }}>
            MISSION TIME: {formatTimestamp(mission.mission_time, timezone)}
          </div>
        )}
        {mission.start_time && (
          <div style={{ marginBottom: 8, fontSize: 16, color: '#66AADD' }}>
            LAUNCHED: {formatTimestamp(mission.start_time, timezone)}
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
                fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
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
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 12,
        padding: '10px 20px',
        border: '1px solid rgba(51,221,170,0.3)',
        color: 'rgba(51,221,170,0.4)',
        background: 'rgba(51,221,170,0.04)',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
        fontSize: 14, letterSpacing: '0.14em', fontWeight: 'bold',
        marginBottom: 16,
        cursor: 'not-allowed',
        pointerEvents: 'none',
      }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>✓</span>
        <span>POST-MISSION LOG</span>
      </div>
    );
  }
  return (
    <>
      <style>{`
        @keyframes postLogPulse {
          0%, 100% { box-shadow: 0 0 4px rgba(0,238,255,0.35); }
          50%      { box-shadow: 0 0 16px rgba(0,238,255,0.75); }
        }
      `}</style>
      <button
        onClick={onClick}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10,
          width: '100%',
          padding: '12px 20px',
          border: '2px solid #00EEFF',
          color: '#00EEFF',
          background: 'rgba(0,238,255,0.06)',
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          fontSize: 14, letterSpacing: '0.14em', fontWeight: 'bold',
          marginBottom: 16,
          cursor: 'pointer',
          animation: 'postLogPulse 2s ease-in-out infinite',
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>✎</span>
        <span>POST-MISSION LOG</span>
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
    <div style={{
      background: '#06121C',
      border: '1px solid #1A3D55',
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }}>
      <div style={{
        fontSize: 9,
        padding: '1px 6px',
        letterSpacing: '0.08em',
        marginBottom: 8,
        fontWeight: 'bold',
        border: '1px solid',
        color: isPrimary ? '#FFBB33' : '#66AADD',
        borderColor: isPrimary ? '#FFBB33' : '#66AADD',
      }}>
        {isPrimary ? '★ PRIMARY' : 'SUPPORT'}
      </div>
      <div style={{
        fontSize: 12, color: '#CCE8FF', fontWeight: 'bold',
        letterSpacing: '0.06em', marginBottom: 4, textAlign: 'center',
      }}>
        {ship.ship_name || '—'}
      </div>
      <div style={{
        fontSize: 10, color: '#4488BB',
        marginBottom: 10, textAlign: 'center',
      }}>
        {ship.ship_model || ship.type || '—'}
      </div>
      <div style={{
        width: 160, height: 110,
        border: '1px solid #1A3D55',
        background: '#040D15',
        overflow: 'hidden', marginBottom: 12,
        padding: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
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
          <div style={{ fontSize: 10, color: '#4488BB', textAlign: 'center', padding: '4px 0' }}>
            NO CREW ROLES
          </div>
        ) : rows.map((row, i) => {
          const occ = row.occupant;
          const name = occ && (occ.citizen_name || occ.discord_id) ? (occ.citizen_name || 'Unknown') : null;
          return (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '4px 0', borderBottom: '1px solid #0D2030',
            }}>
              <span style={{ fontSize: 10, color: '#4488BB', letterSpacing: '0.06em' }}>
                {String(row.roleName).toUpperCase()}
              </span>
              {name ? (
                <span style={{ fontSize: 11, color: '#CCE8FF', fontWeight: 'bold' }}>
                  {name}
                </span>
              ) : (
                <span style={{ fontSize: 10, color: '#44FF88' }}>
                  — OPEN —
                </span>
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
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
      height: '100%', overflowY: 'auto', padding: '30px 30px 40px', color: C.amber,
    }}>
      {/* TIMER BANNER */}
      <div style={{
        textAlign: 'center',
        padding: '20px 0 10px',
        borderBottom: '1px solid #1A3D55',
        marginBottom: 28,
      }}>
        <div style={{
          fontSize: 11, color: '#4488BB',
          letterSpacing: '0.16em', marginBottom: 6,
        }}>
          MISSION ELAPSED TIME
        </div>
        <div style={{
          fontSize: 48, color: '#00EEFF',
          fontWeight: 'bold', letterSpacing: '0.12em',
        }}>
          {formatHMS(elapsed)}
        </div>
        <div style={{
          fontSize: 14, color: '#99CCFF',
          fontWeight: 'bold', letterSpacing: '0.1em', marginTop: 6,
        }}>
          {strippedName}
        </div>
        <div style={{ fontSize: 11, color: '#4488BB', marginTop: 3 }}>
          {missionTypeLabel || '—'} · LAUNCHED {formatLaunchDate(launchedAt)} · COMMANDER: {commanderName}
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
            <div style={{
              border: '1px solid #33DDAA', padding: 16, minWidth: 320,
              textAlign: 'center', background: '#000',
              fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
            }}>
              <div style={{
                fontSize: 13, color: '#33DDAA', fontWeight: 'bold',
                letterSpacing: '0.1em', marginBottom: 6,
              }}>
                CONFIRM MISSION COMPLETE?
              </div>
              <div style={{ fontSize: 11, color: '#66AADD', marginBottom: 12 }}>
                All crew RP will be distributed.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleComplete}
                  disabled={working}
                  style={{
                    flex: 1, background: '#000', border: '1px solid #33DDAA',
                    color: '#33DDAA', fontSize: 12, padding: '8px 12px',
                    letterSpacing: '0.1em', fontWeight: 'bold',
                    fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                    cursor: working ? 'default' : 'pointer',
                  }}
                >✓ CONFIRM</button>
                <button
                  onClick={() => setConfirmComplete(false)}
                  style={{
                    flex: 1, background: '#000', border: '1px solid #66AADD',
                    color: '#66AADD', fontSize: 12, padding: '8px 12px',
                    letterSpacing: '0.1em',
                    fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                    cursor: 'pointer',
                  }}
                >CANCEL</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
              <button
                onClick={() => { playClick(); setConfirmComplete(true); }}
                onMouseEnter={() => setHoverComplete(true)}
                onMouseLeave={() => setHoverComplete(false)}
                disabled={working}
                style={{
                  fontSize: 14, fontWeight: 'bold', letterSpacing: '0.12em',
                  color: hoverComplete ? '#000' : '#33DDAA',
                  border: '2px solid #33DDAA',
                  background: hoverComplete ? '#33DDAA' : '#000',
                  padding: '12px 36px',
                  cursor: working ? 'default' : 'pointer',
                  fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                }}
              >
                [ ✓ COMPLETE MISSION ]
              </button>
              <button
                onClick={handleAbort}
                onMouseEnter={() => setHoverAbort(true)}
                onMouseLeave={() => setHoverAbort(false)}
                disabled={working}
                style={{
                  fontSize: 12, letterSpacing: '0.1em',
                  color: hoverAbort ? '#000' : '#FF5544',
                  border: '1px solid #FF5544',
                  background: hoverAbort ? '#FF5544' : '#000',
                  padding: '8px 20px',
                  cursor: working ? 'default' : 'pointer',
                  fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                }}
              >
                [ ABORT ]
              </button>
            </div>
          )}
          {errMsg && (
            <div style={{ fontSize: 11, color: '#FF5544' }}>{errMsg}</div>
          )}
        </div>
      ) : (
        <div style={{
          marginTop: 28,
          border: '1px solid #1A3D55',
          background: '#06121C',
          padding: '14px 20px',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: 12, color: '#FFBB33', fontWeight: 'bold',
            letterSpacing: '0.08em', marginBottom: 4,
          }}>
            RP WILL BE DISTRIBUTED TO ALL CREW UPON MISSION COMPLETION
          </div>
          <div style={{ fontSize: 11, color: '#66AADD' }}>
            Submit your post-mission log afterward to earn an additional +3 RP
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
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999,
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    }}>
      <div style={{
        background: '#06121C',
        border: '1px solid #33DDAA',
        padding: 30,
        maxWidth: 600, width: '90%',
      }}>
        <div style={{
          fontSize: 18, color: '#33DDAA',
          fontWeight: 'bold', letterSpacing: '0.12em', marginBottom: 8,
        }}>
          POST-MISSION LOG
        </div>
        <div style={{
          fontSize: 13, color: '#99CCFF', marginBottom: 16,
        }}>
          OPERATION {stripMissionPrefix(prompt.mission_name || '').toUpperCase()}
        </div>

        {successMsg ? (
          <div style={{
            fontSize: 14, color: '#33DDAA', fontWeight: 'bold',
            textAlign: 'center', letterSpacing: '0.1em', padding: '30px 0',
          }}>
            {successMsg}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: '#66AADD', marginBottom: 16, lineHeight: 1.6 }}>
              Submit your mission log to earn +3 RP. Describe what happened during the operation.
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={1000}
              disabled={submitting}
              placeholder="Enter your mission log here..."
              onFocus={() => setTextareaFocus(true)}
              onBlur={() => setTextareaFocus(false)}
              style={{
                width: '100%', minHeight: 160,
                background: '#000',
                border: `1px solid ${textareaFocus ? '#00EEFF' : '#2A6A9A'}`,
                color: '#CCE8FF', fontSize: 14, padding: 10,
                fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                boxSizing: 'border-box', resize: 'vertical', outline: 'none',
              }}
            />
            <div style={{
              fontSize: 10, color: '#4488BB',
              textAlign: 'right', marginTop: 4,
            }}>
              {text.length} / 1000
            </div>
            {errMsg && (
              <div style={{ fontSize: 11, color: '#FF5544', marginTop: 8, textAlign: 'center' }}>
                {errMsg}
              </div>
            )}
            <button
              onClick={submit}
              disabled={!canSubmit}
              onMouseEnter={() => setHoverSubmit(true)}
              onMouseLeave={() => setHoverSubmit(false)}
              style={{
                width: '100%', fontSize: 14, fontWeight: 'bold',
                letterSpacing: '0.1em', padding: '12px 0',
                border: '2px solid #33DDAA',
                color: !canSubmit
                  ? '#1A3D55'
                  : (hoverSubmit ? '#000' : '#33DDAA'),
                background: !canSubmit
                  ? '#000'
                  : (hoverSubmit ? '#33DDAA' : '#000'),
                cursor: canSubmit ? 'pointer' : 'default',
                fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
                marginTop: 16,
                opacity: !canSubmit && !submitting ? 0.6 : 1,
              }}
            >
              [ {submitting ? 'SUBMITTING...' : 'SUBMIT LOG'} ]
            </button>
            <div
              onClick={onClose}
              style={{
                fontSize: 11, color: '#4488BB',
                cursor: 'pointer', textAlign: 'center', marginTop: 10,
                letterSpacing: '0.08em',
              }}
            >
              SKIP
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FeedItem({ item, timezone }) {
  const ts = formatFeedTimestamp(item.timestamp, timezone);
  const cat = FEED_CATEGORY[item.event_type] ?? DEFAULT_FEED_CAT;

  const scanline = (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
      pointerEvents: 'none',
    }} />
  );

  const wrap = {
    background: cat.bg,
    border: `1px solid ${cat.accent}`,
    padding: '10px 14px',
    marginBottom: 8,
    position: 'relative',
    overflow: 'hidden',
    fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
  };

  const tsStyle = {
    fontSize: 10,
    color: cat.accent,
    letterSpacing: '0.06em',
    marginBottom: 4,
    position: 'relative',
  };

  const txtStyle = {
    fontSize: 14,
    color: cat.text,
    lineHeight: 1.6,
    position: 'relative',
  };

  if (item.event_type === 'ship_borrowed') {
    return (
      <div style={wrap}>
        {scanline}
        <div style={tsStyle}>{ts}</div>
        <div style={txtStyle}>
          {item.citizen_name} added{' '}
          <span style={{ color: '#FFBB33', fontWeight: 'bold' }}>{item.ship_name}</span>
          {' '}to {item.mission_name}
        </div>
      </div>
    );
  }

  if (item.event_type === 'ai_summary') {
    return (
      <div style={wrap}>
        {scanline}
        <div style={tsStyle}>{ts}</div>
        <div style={{ fontSize: 14, color: '#CCAAFF', letterSpacing: '0.14em', fontWeight: 'bold', position: 'relative' }}>
          NEXUS TRAFFIC AUTHORITY
        </div>
        <div style={{ fontSize: 14, color: '#AA66DD', marginTop: 2, position: 'relative' }}>
          has reviewed recent fleet activity and issued the following summary:
        </div>
        <div style={{ fontSize: 14, color: '#E8D4FF', lineHeight: 1.7, marginTop: 6, position: 'relative' }}>
          {item.summary_text}
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      {scanline}
      <div style={tsStyle}>{ts}</div>
      <div style={txtStyle}>{formatFeedText(item)}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Ship Registry
// ───────────────────────────────────────────────────────────────────────────

const formatModel = (model) =>
  model.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function ShipRegistryCard({ ship, shipThumbs, isOpen, onToggle, me, myRequest, onRequestSent, onRequestCancelled }) {
  const thumbUrl = findShipThumb(ship, shipThumbs);
  const ownerName = ship.owner_id?.citizen_name || ship.owner_id?.username || '—';
  const stats = ship.stats || { lifetime_rp: 0, avg_fill_rate: 0, missions_analyzed: 0 };
  const rawModel = ship.ship_model || ship.type || '';
  const modelDisplay = rawModel ? formatModel(rawModel) : '—';
  const [reqLoading, setReqLoading] = useState(false);

  return (
    <div style={{
      background: '#06121C', border: '1px solid #1A3D55', padding: 12,
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    }}>
      <div style={{
        width: '100%', height: 80, background: '#040D15', border: '1px solid #0D2030',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 10, overflow: 'hidden',
        padding: 8, boxSizing: 'border-box',
      }}>
        {thumbUrl ? (
          <img src={thumbUrl} alt="" style={{
            width: '100%', height: '100%', objectFit: 'contain',
            filter: 'invert(1) sepia(1) saturate(3) hue-rotate(175deg) brightness(0.55) contrast(1.2)',
          }} />
        ) : (
          <div style={{ fontSize: 10, color: '#1A3D55', letterSpacing: '0.06em' }}>NO IMAGE</div>
        )}
      </div>

      <div style={{ fontSize: 13, color: '#CCE8FF', fontWeight: 'bold', letterSpacing: '0.06em', marginBottom: 3 }}>
        {ship.ship_name || '—'}
      </div>
      <div style={{ fontSize: 10, color: '#4488BB', letterSpacing: '0.04em', marginBottom: 6 }}>
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

      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #0D2030', paddingTop: 8, marginBottom: 8 }}>
        {[['SHIP RP', stats.lifetime_rp], ['AVG FILL', `${stats.avg_fill_rate}%`], ['MISSIONS', stats.missions_analyzed]].map(([label, val]) => (
          <div key={label} style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: 11, color: '#00EEFF', fontWeight: 'bold' }}>{val}</div>
            <div style={{ fontSize: 9, color: '#4488BB', letterSpacing: '0.06em' }}>{label}</div>
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
            <div style={{
              borderTop: '1px solid #1A3D55', padding: '6px 8px', background: '#040D15',
              fontSize: 10, color: '#33DDAA', letterSpacing: '0.06em',
            }}>
              ● VESSEL BORROWED
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
                style={{ fontSize: 9, color: '#4488BB', textDecoration: 'underline', cursor: 'pointer' }}
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
            style={{
              width: '100%', background: '#040D15', border: 'none',
              borderTop: '1px solid #1A3D55',
              color: reqLoading ? '#1A3D55' : '#99CCFF',
              fontSize: 10, letterSpacing: '0.08em', padding: '6px 8px', cursor: reqLoading ? 'not-allowed' : 'pointer',
              fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              textAlign: 'left',
            }}
          >
            <span>{reqLoading ? 'SENDING...' : 'REQUEST ACCESS'}</span>
            <span style={{ color: '#1A3D55' }}>→</span>
          </button>
        );
      })()}

      <button
        onClick={onToggle}
        style={{
          width: '100%', background: 'none', border: '1px solid #1A3D55', color: '#4488BB',
          fontSize: 10, letterSpacing: '0.08em', padding: '5px 0', cursor: 'pointer',
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6,
        }}
      >
        SHIP HISTORY {isOpen ? '▼' : '▶'}
      </button>

      {isOpen && (
        <div style={{
          marginTop: 8, padding: '8px 10px', background: '#040D15', border: '1px solid #0D2030',
          fontSize: 11, color: '#66AADD', lineHeight: 1.6, letterSpacing: '0.04em',
        }}>
          {ship.description || <span style={{ color: '#1A3D55' }}>NO HISTORY ON FILE</span>}
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
        onClick={() => setMinimized(false)}
        style={{
          width: 280, padding: '8px 14px',
          background: '#040D15', border: '2px solid #00EEFF',
          boxShadow: '0 0 16px rgba(0,238,255,0.35)',
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#00EEFF', letterSpacing: '0.08em' }}>
            ⚓ ACCESS REQUEST — {popup.shipName}
          </span>
          <span style={{ fontSize: 10, color: '#4488BB' }}>▲</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: 340, background: '#040D15', border: '2px solid #00EEFF',
      boxShadow: '0 0 20px rgba(0,238,255,0.4), 0 0 48px rgba(0,238,255,0.15)',
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 12px', borderBottom: '1px solid #1A3D55',
      }}>
        <span style={{ fontSize: 11, color: '#00EEFF', letterSpacing: '0.1em' }}>
          INCOMING ACCESS REQUEST
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          <span
            onClick={() => setMinimized(true)}
            style={{ fontSize: 10, color: '#4488BB', cursor: 'pointer', letterSpacing: '0.06em' }}
          >
            ▼
          </span>
          <span
            onClick={onDismiss}
            style={{ fontSize: 10, color: '#4488BB', cursor: 'pointer', letterSpacing: '0.06em' }}
          >
            ✕
          </span>
        </div>
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{
          width: 64, height: 48, background: '#040D15', border: '1px solid #0D2030',
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
            <span style={{ fontSize: 9, color: '#1A3D55' }}>NO IMG</span>
          )}
        </div>
        <div>
          <div style={{ fontSize: 13, color: '#CCE8FF', fontWeight: 'bold' }}>{popup.shipName}</div>
          <div style={{ fontSize: 10, color: '#4488BB', marginTop: 2 }}>
            {popup.shipModel ? formatModel(popup.shipModel) : '—'}
          </div>
          <div style={{ fontSize: 10, color: '#66AADD', marginTop: 6 }}>
            REQUESTER: <span style={{ color: '#99CCFF' }}>{popup.requesterName}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '0 12px 12px' }}>
        <button
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            await onApprove(popup);
            setLoading(false);
          }}
          style={{
            flex: 1, background: loading ? '#0D2030' : '#33DDAA', border: 'none',
            color: '#000', fontSize: 11, fontWeight: 'bold', padding: '7px 0',
            fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
            letterSpacing: '0.1em', cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          APPROVE
        </button>
        <button
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            await onDeny(popup);
            setLoading(false);
          }}
          style={{
            flex: 1, background: 'none', border: '1px solid #FF5544',
            color: '#FF5544', fontSize: 11, padding: '7px 0',
            fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
            letterSpacing: '0.1em', cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          DENY
        </button>
      </div>
    </div>
  );
}

// ─── Lessee notification bar ────────────────────────────────────────────────

const LESSEE_COLORS = {
  approved: '#33DDAA',
  denied:   '#FF5544',
  expired:  '#4488BB',
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
        onClick={() => setMinimized(false)}
        style={{
          width: 280, padding: '7px 12px',
          background: '#040D15', border: `1px solid ${color}`,
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color, letterSpacing: '0.06em' }}>
            {label}: {notif.shipName}
          </span>
          <span style={{ fontSize: 9, color: '#4488BB' }}>▲</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: 300, background: '#040D15', border: `1px solid ${color}`,
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
      padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color, fontWeight: 'bold', letterSpacing: '0.08em' }}>{label}</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <span onClick={() => setMinimized(true)} style={{ fontSize: 10, color: '#4488BB', cursor: 'pointer' }}>▼</span>
          <span onClick={onClose} style={{ fontSize: 10, color: '#4488BB', cursor: 'pointer' }}>✕</span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#99CCFF', letterSpacing: '0.04em' }}>
        {notif.shipName}
      </div>
      {notif.kind === 'approved' && notif.loanExpiresAt && (
        <div style={{ fontSize: 10, color: '#66AADD', marginTop: 4 }}>
          LOAN EXPIRES: {new Date(notif.loanExpiresAt).toLocaleTimeString()}
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

  return (
    <div style={{ height: '100%', opacity: fading ? 0 : 1, transition: 'opacity 0.2s ease' }}>
      {phase === 'boot' && <RegistryBoot onComplete={handleBootDone} />}
      {phase === 'registry' && (
        <div style={{
          fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
          height: '100%', overflowY: 'auto', padding: '20px 24px', color: C.amber,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 18, color: '#CCE8FF', fontWeight: 'bold', letterSpacing: '0.12em' }}>
              NEXUS SHIP REGISTRY
            </div>
            <div style={{ fontSize: 13, color: '#66AADD', letterSpacing: '0.1em' }}>
              {ships.length} VESSELS REGISTERED
            </div>
          </div>

          <input
            type="text"
            placeholder="SEARCH VESSELS..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#000', border: '1px solid #1A3D55',
              color: '#99CCFF', fontSize: 14, padding: '8px 12px',
              fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
              letterSpacing: '0.08em', outline: 'none', marginBottom: 20,
            }}
          />

          {filtered.length === 0 ? (
            <div style={{ color: '#66AADD', fontSize: 16 }}>NO VESSELS FOUND</div>
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
  const [isMuted, setIsMuted]               = useState(false);
  const [micSensitivity, setMicSensitivity] = useState(100);
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
  } = useRadioConnection({
    voiceProfile,
    voiceProfileVersion: profileVersion,
    pttKey,
    micDeviceId,
    outputDeviceId,
  });

  useEffect(() => { setHookMuted(isMuted); }, [isMuted, setHookMuted]);
  useEffect(() => { setHookMicSensitivity(micSensitivity); }, [micSensitivity, setHookMicSensitivity]);

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

  const selectedMission = missions.find(m => m._id === selectedId) ?? missions[0] ?? null;

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
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
      color: C.amber,
      overflow: 'hidden',
    }}>


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
        onSelectMission={(id) => setSelectedId(id)}
        onRegisterShip={() => { setMyShipsMode(false); setCreateMissionMode(false); setShipRegistryMode(false); setRegisterMode(true); }}
        onMyShips={() => { setMyShipsMode(true); setRegisterMode(false); setCreateMissionMode(false); setShipRegistryMode(false); }}
        onCreateMission={() => { setCreateMissionMode(true); setMyShipsMode(false); setRegisterMode(false); setShipRegistryMode(false); }}
        onShipRegistry={() => { setShipRegistryMode(true); setMyShipsMode(false); setRegisterMode(false); setCreateMissionMode(false); }}
        myShipsMode={myShipsMode}
        registerMode={registerMode}
        createMissionMode={createMissionMode}
        shipRegistryMode={shipRegistryMode}
        navigate={navigate}
      />

      {/* 3-panel grid (or MY SHIPS panel when myShipsMode) */}
      <div style={{
        flex: 1,
        display: myShipsMode ? 'block' : 'grid',
        gridTemplateColumns: `${leftWidth}px 1fr ${rightWidth}px`,
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
            onRegisterShip={() => setRegisterMode(true)}
            onViewLiveMission={(missionId) => {
              setMyShipsMode(false);
              setSelectedShip(null);
              if (missionId) setSelectedId(missionId);
            }}
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
          <ColumnResizeHandle side="right" columnRef={leftColumnRef} setWidth={setLeftWidth} />
          <div style={{
            padding: '10px 12px',
            borderBottom: `1px solid ${C.border}`,
            fontSize: 16, color: '#66AADD',
            letterSpacing: '0.14em', flexShrink: 0,
          }}>
            MISSION BOARD — {availableCount} AVAILABLE
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loadingMissions ? (
              <div style={{ padding: 12, color: '#66AADD', fontSize: 16 }}>SCANNING{dots}</div>
            ) : missions.length === 0 ? (
              <div style={{ padding: 12, color: '#66AADD', fontSize: 16 }}>NO ACTIVE MISSIONS</div>
            ) : (
              missions.map(m => (
                <MissionCard
                  key={m._id}
                  mission={m}
                  selected={selectedMission?._id === m._id}
                  onClick={() => setSelectedId(m._id)}
                  missionTypes={missionTypes}
                  shipThumbs={shipThumbs}
                />
              ))
            )}
          </div>
        </div>

        {/* Center: Mission detail OR Ship Registration */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
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
              />
            )
          ) : !loadingMissions ? (
            <div style={{ color: '#66AADD', fontSize: 16, padding: '16px 24px' }}>
              SELECT A MISSION TO VIEW DETAILS
            </div>
          ) : null}
        </div>

        {/* Right: Activity feed + persistent radio panel */}
        <div ref={rightColumnRef} style={{
          position: 'relative',
          borderLeft: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
        }}>
          <ColumnResizeHandle side="left" columnRef={rightColumnRef} setWidth={setRightWidth} />
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <div style={{
              padding: '10px 10px',
              borderBottom: `1px solid ${C.border}`,
              fontSize: 14, color: '#66AADD',
              letterSpacing: '0.14em',
            }}>
              ACTIVITY FEED
            </div>
            {loadingFeed ? (
              <div style={{ padding: 10, color: '#66AADD', fontSize: 14 }}>SCANNING{feedDots}</div>
            ) : feedEvents.length === 0 ? (
              <div style={{ padding: 10, color: '#66AADD', fontSize: 14 }}>NO ACTIVITY</div>
            ) : (
              feedEvents.map((item, i) => (
                <FeedItem key={item._id ?? `${item.event_type}-${item.timestamp}-${i}`} item={item} timezone={timezone} />
              ))
            )}
          </div>
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
            setIsMuted={setIsMuted}
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

          </>
        )}

      </div>
    </div>
  );
}
