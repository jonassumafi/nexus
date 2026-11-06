import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import api from '../services/api';
import ColumnResizeHandle from './ColumnResizeHandle';
import useSavePulse from '../hooks/useSavePulse';
import { useSocketContext } from '../context/SocketContext';
import formatModel from '../utils/formatShipModel';

const playClick = () => {
  const file = Math.random() > 0.5 ? '/sounds/click.mp3' : '/sounds/click2.mp3';
  const snd = new Audio(file);
  snd.volume = 0.7;
  snd.play().catch(() => {});
};

const ROLE_CATEGORIES = [
  { name: 'COMBAT',     roles: ['PILOT', 'CO-PILOT', 'TURRET OPERATOR', 'REMOTE TURRET OPERATOR', 'GUNNER', 'MARINE', 'BOARDING SPECIALIST'] },
  { name: 'SUPPORT',    roles: ['ENGINEER', 'SUPPORT ENGINEER', 'MEDIC', 'NAVIGATOR'] },
  { name: 'OPERATIONS', roles: ['CARGO MANAGER', 'MINING LASER OPERATOR', 'SALVAGE OPERATOR', 'SCIENCE OFFICER', 'SENSOR OPERATOR'] },
  { name: 'COMMAND',    roles: ['EXECUTIVE OFFICER', 'TACTICAL OFFICER'] },
];

function toTitleCase(s) {
  return s.split(' ').map(w =>
    w.split('-').map(p => (p[0] || '') + p.slice(1).toLowerCase()).join('-')
  ).join(' ');
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

// Counts up from 0 → target over duration ms. Returns the current display value.
// Reduced-motion jumps straight to the target.
function useCountUp(target, duration = 420, deps = []) {
  const [val, setVal] = useState(target);
  const raf = useRef(0);
  useEffect(() => {
    if (typeof target !== 'number' || Number.isNaN(target)) { setVal(target); return; }
    const prm = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prm || duration <= 0) { setVal(target); return; }
    const start = performance.now();
    const from = 0;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(from + (target - from) * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration, ...deps]);
  return val;
}

// ─── Motion CSS injected once ───────────────────────────────────────────────

const MS_STYLE_ID = 'ms-ships-style';
function ensureMsStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(MS_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = MS_STYLE_ID;
  el.textContent = `
.ms-root {
  --sw-out: 90ms;
  --sw-stagger: 40ms;
  --cfg-height: 420ms;
  --cfg-swap: 420ms;
  --cfg-fade: 280ms;
  --cfg-front-out: -26px;
  --cfg-back-in: 26px;
  --cfg-blur: 2px;
  --row-stagger: 38ms;
  --row-offset: 120ms;
  --row-rise: 8px;
  --del-arm: 8000ms;
  display: flex;
  flex-direction: row;
  height: 100%;
  min-height: 0;
  background: var(--bg0);
  color: var(--fg0);
  font-family: var(--font);
  transition: opacity 160ms var(--out);
}
.ms-root.ms-dim { opacity: .15; }

.ms-left {
  width: 100%;
  position: relative;
  border-right: 1px solid var(--rim0);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg1);
}
.ms-panelh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--rim0);
  background: var(--bg2);
  flex-shrink: 0;
}
.ms-panelh .ms-title {
  font-size: 11px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase;
  color: var(--fg1);
}
.ms-list {
  flex: 1; min-height: 0;
  overflow-y: auto;
  position: relative;
}
.ms-reg {
  padding: 10px 12px;
  border-top: 1px solid var(--rim0);
  background: var(--bg2);
  flex-shrink: 0;
}
.ms-reg .btn {
  width: 100%;
  height: 30px;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ms-reg.ms-empty .btn {
  outline: 1px solid var(--cyan);
  outline-offset: -1px;
}

.ms-grp {
  display: flex;
  flex-direction: column;
}
.ms-gh {
  position: sticky; top: 0; z-index: 2;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--inset);
  border: 0;
  border-bottom: 1px solid var(--rim0);
  color: var(--fg2);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
  cursor: pointer;
  font-family: var(--font);
  text-align: left;
}
.ms-gh:focus-visible { outline: 2px solid var(--cyan); outline-offset: -2px; }
.ms-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: currentColor; display: inline-block; flex: none;
}
.ms-gh.ms-on  { color: var(--amber); }
.ms-gh.ms-av  { color: var(--lime); }
.ms-gh.ms-bw  { color: var(--cyan); }
.ms-gh.ms-on .ms-dot { animation: ms-beat 2s var(--inout) infinite; }
@keyframes ms-beat {
  0%,100% { opacity: 1; transform: scale(1); }
  50%     { opacity: .4; transform: scale(.72); }
}
.ms-gh .ms-count {
  color: var(--fg2);
  letter-spacing: .04em;
  font-weight: 600;
}
.ms-chev {
  display: inline-block;
  width: 10px; height: 10px;
  transform-origin: center;
  transition: transform var(--d3) var(--out);
  color: var(--fg2);
}
.ms-grp.ms-shut .ms-chev { transform: rotate(-90deg); }

.ms-gb {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows var(--d3) var(--inout);
}
.ms-grp.ms-shut .ms-gb { grid-template-rows: 0fr; }
.ms-gb > .ms-gb-inner {
  overflow: hidden;
  min-height: 0;
}

.ms-card {
  position: relative;
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 10px;
  padding: 9px 12px 9px 15px;
  border: 0;
  border-bottom: 1px solid var(--rim0);
  background: transparent;
  color: inherit;
  text-align: left;
  width: 100%;
  cursor: pointer;
  font-family: var(--font);
  transition:
    background var(--d2) var(--out),
    box-shadow var(--d2) var(--out);
}
.ms-card::before {
  content: "";
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: transparent;
  transition: background var(--d2) var(--out);
}
.ms-card.ms-g-on::before,
.ms-card.ms-g-on.ms-sel::before { background: var(--amber); }
.ms-card.ms-g-av::before,
.ms-card.ms-g-av.ms-sel::before { background: var(--lime); }
.ms-card.ms-g-bw::before,
.ms-card.ms-g-bw.ms-sel::before { background: var(--cyan); }
.ms-card:not(.ms-sel)::before { background: transparent; }
.ms-card.ms-g-on.ms-sel::before { background: var(--amber); }
.ms-card.ms-g-av.ms-sel::before { background: var(--lime); }
.ms-card.ms-sel {
  background: color-mix(in srgb, var(--cyan) 5%, transparent);
}
.ms-card:hover:not(.ms-sel) {
  background: color-mix(in srgb, var(--bg2) 70%, transparent);
}
.ms-card:focus-visible { outline: 2px solid var(--cyan); outline-offset: -2px; }
.ms-card.ms-new { animation: ms-cardin 280ms var(--out) both, ms-newwash 700ms var(--out) both; }
@keyframes ms-cardin {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}
@keyframes ms-newwash {
  from { background: color-mix(in srgb, var(--lime) 18%, transparent); }
  to   { background: transparent; }
}
.ms-card.ms-exit { animation: ms-cardout 240ms var(--inout) forwards; pointer-events: none; }
@keyframes ms-cardout {
  to { opacity: 0; transform: translateX(12px); max-height: 0; padding-block: 0; border-bottom-width: 0; }
}

.ms-sil {
  width: 56px; height: 36px;
  border: 1px solid var(--rim0);
  background: var(--inset);
  display: block;
  object-fit: contain;
  filter: grayscale(1) brightness(1.35) contrast(1.05);
  transition: border-color var(--d2) var(--out);
}
.ms-sil.ms-ph {
  display: grid; place-items: center;
  font-size: 9px; color: var(--fg3); letter-spacing: .1em;
}
.ms-card.ms-sel .ms-sil { border-color: var(--blue); }

.ms-body { min-width: 0; display: flex; flex-direction: column; }
.ms-name {
  font-size: 13px; font-weight: 700;
  color: var(--cyan);
  letter-spacing: .02em;
  text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ms-model {
  font-size: 11px; font-weight: 500;
  color: var(--fg2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ms-stat {
  font-size: 11px; font-weight: 500;
  color: var(--fg3);
  margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* Empty state */
.ms-empty-fleet {
  padding: 24px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--fg3);
  letter-spacing: .04em;
}

/* ============ MAIN PANE ============ */
.ms-main {
  flex: 1;
  min-width: 0;
  padding: 16px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ms-faces {
  position: relative;
  transition: height var(--cfg-height) var(--inout);
}
.ms-face {
  transition:
    transform var(--cfg-swap) var(--out),
    opacity   var(--cfg-fade) var(--out),
    filter    var(--cfg-fade) var(--out);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ms-face.ms-front { position: relative; }
.ms-face.ms-back {
  position: absolute;
  left: 0; right: 0; top: 0;
  opacity: 0;
  transform: translateX(var(--cfg-back-in));
  pointer-events: none;
  visibility: hidden;
  filter: blur(var(--cfg-blur));
}
.ms-root.ms-live .ms-face.ms-front {
  position: absolute;
  left: 0; right: 0; top: 0;
  opacity: 0;
  transform: translateX(var(--cfg-front-out));
  pointer-events: none;
  filter: blur(var(--cfg-blur));
}
.ms-root.ms-live .ms-face.ms-back {
  position: relative;
  opacity: 1;
  transform: none;
  pointer-events: auto;
  visibility: visible;
  filter: none;
}

/* Blocks that fade out on ship switch then rise in with stagger */
.ms-blk {
  --k: 0;
  animation: ms-rise var(--d3) var(--out) both;
  animation-delay: calc(var(--k) * var(--sw-stagger));
}
@keyframes ms-rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}

.ms-top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.ms-backbtn {
  width: 30px; height: 30px;
  flex: none;
  display: inline-grid; place-items: center;
  background: var(--bg1);
  border: 1px solid var(--rim0);
  color: var(--fg1);
  cursor: pointer;
  border-radius: 3px;
  transition:
    border-color var(--d2) var(--out),
    color var(--d2) var(--out),
    background var(--d2) var(--out);
}
.ms-backbtn:hover { border-color: var(--cyan); color: var(--cyan); }
.ms-id { flex: 1; min-width: 0; }
.ms-id h1 {
  font-size: 22px; font-weight: 700;
  line-height: 1.15;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: .02em;
  margin: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ms-id .ms-mdl {
  font-size: 12px; color: var(--fg2);
  margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ms-id .ms-meta {
  display: flex; flex-wrap: wrap;
  column-gap: 14px; row-gap: 4px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--fg3);
}
.ms-id .ms-meta b { color: var(--fg1); font-weight: 600; }
.ms-status {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 10px; font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  margin-top: 8px;
}
.ms-status.ms-s-on { color: var(--amber); }
.ms-status.ms-s-av { color: var(--lime); }
.ms-status.ms-s-on .ms-dot { animation: ms-beat 2s var(--inout) infinite; }
.ms-status.ms-glow { animation: ms-statusglow 700ms var(--out); }
@keyframes ms-statusglow {
  0%   { text-shadow: 0 0 10px currentColor; }
  100% { text-shadow: none; }
}

.ms-actions {
  display: flex; align-items: center;
  gap: 6px;
  flex: none;
}
.ms-abtn {
  height: 30px;
  min-width: 30px;
  padding: 0 10px;
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--bg1);
  border: 1px solid var(--rim0);
  color: var(--fg1);
  font-size: 11px; font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  font-family: var(--font);
  cursor: pointer;
  border-radius: 3px;
  transition:
    border-color var(--d2) var(--out),
    color var(--d2) var(--out),
    background var(--d2) var(--out),
    width var(--d3) var(--out);
}
.ms-abtn:hover:not(:disabled) { border-color: var(--cyan); color: var(--cyan); }
.ms-abtn:disabled { opacity: .45; cursor: not-allowed; }
.ms-abtn.ms-save { border-color: var(--lime); color: var(--lime); }
.ms-abtn.ms-cancel { border-color: var(--rim1); color: var(--fg1); }
.ms-del {
  position: relative;
  width: 30px;
  overflow: hidden;
  border-color: var(--red);
  color: var(--red);
  padding: 0;
  justify-content: center;
  transition: width var(--d3) var(--out), background var(--d3) var(--out);
}
.ms-del.ms-armed {
  width: 184px;
  background: color-mix(in srgb, var(--red) 15%, var(--bg1));
  padding: 0 10px;
  justify-content: flex-start;
  gap: 6px;
}
.ms-del .ms-del-bar {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 2px;
  background: var(--red);
  transform: scaleX(0);
  transform-origin: left;
}
.ms-del.ms-armed .ms-del-bar {
  transform: scaleX(1);
  animation: ms-delbar var(--del-arm) linear forwards;
}
@keyframes ms-delbar {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}
.ms-del.ms-shake { animation: ms-shake 300ms linear; }
@keyframes ms-shake {
  0%,100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}

.ms-stage {
  display: flex; justify-content: center;
  position: relative;
}
.ms-stage-inner {
  position: relative;
  width: 100%;
  max-width: 520px;
  border: 1px solid var(--rim0);
  background: #040D15;
  padding: 8px;
  box-sizing: border-box;
  animation: ms-stage-settle var(--d4) var(--out) both;
}
@keyframes ms-stage-settle {
  from { transform: scale(.985); }
  to   { transform: none; }
}

.ms-perf-wrap, .ms-hist-wrap {
  background: var(--bg1);
  border: 1px solid var(--rim0);
  border-radius: 4px;
  padding: 12px 14px;
}
.ms-h3 {
  font-size: 10px; font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--fg2);
  margin: 0 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ms-tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.ms-tile {
  background: var(--inset);
  border: 1px solid var(--rim0);
  border-radius: 3px;
  padding: 10px 10px;
  text-align: center;
}
.ms-tile .ms-tv {
  font-size: 18px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--fg0);
  line-height: 1.1;
}
.ms-tile.ms-tv-lime .ms-tv { color: var(--lime); }
.ms-tile .ms-tl {
  font-size: 9px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--fg3);
  margin-top: 4px;
  font-weight: 600;
}

.ms-hist-body {
  font-size: 12px;
  line-height: 1.55;
  color: var(--fg1);
  white-space: pre-wrap;
}
.ms-hist-empty {
  font-size: 12px;
  color: var(--fg3);
  font-style: italic;
}

/* Live face */
.ms-live-head {
  display: flex; align-items: center; gap: 12px;
}
.ms-live-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 8px;
  border: 1px solid var(--amber);
  color: var(--amber);
  font-size: 10px; font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  border-radius: 3px;
  background: color-mix(in srgb, var(--amber) 10%, transparent);
}
.ms-live-chip .ms-dot { animation: ms-beat 2s var(--inout) infinite; }
.ms-live-rows { display: flex; flex-direction: column; }
.ms-live-row {
  --i: 0;
  display: grid;
  grid-template-columns: 28px 1fr auto;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 6px 2px;
  border-bottom: 1px solid var(--rim0);
  animation: ms-rowin var(--cfg-swap) var(--out) both;
  animation-delay: calc(var(--i) * var(--row-stagger) + var(--row-offset));
}
@keyframes ms-rowin {
  from { opacity: 0; transform: translateY(var(--row-rise)); }
  to   { opacity: 1; transform: none; }
}

/* Node edit overlay — grid fade + ring pop */
.ms-edit-grid {
  position: absolute;
  inset: 8px;
  pointer-events: none;
  background-image:
    linear-gradient(to right, color-mix(in srgb, var(--cyan) 12%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--cyan) 12%, transparent) 1px, transparent 1px);
  background-size: 52px 31px;
  animation: ms-fadein var(--d3) var(--out) both;
}
@keyframes ms-fadein {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.ms-edit-ring {
  --k: 0;
  animation: ms-ringpop var(--d4) var(--snap) both;
  animation-delay: calc(var(--k) * 40ms);
}
@keyframes ms-ringpop {
  from { transform: translate(-50%, -50%) scale(.4); opacity: 0; }
  to   { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .ms-root *, .ms-root *::before, .ms-root *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
}
`;
  document.head.appendChild(el);
}

// ─── Icons ──────────────────────────────────────────────────────────────────
const IconBack = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const IconChev = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const IconEdit = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);
const IconLive = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);
const IconTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </svg>
);

// ─── Fleet list ─────────────────────────────────────────────────────────────

function FleetList({
  owned,
  borrowed,
  loading,
  specs,
  shipImages,
  selectedId,
  onSelect,
  onSelectBorrowed,
  onRegister,
  setLeftWidth,
  groupState,
  setGroupState,
  loanedShipIds,
  recentIds,
  newId,
  exitingId,
}) {
  const dots = useDots(loading);
  const colRef = useRef(null);

  const totalCount = owned.length + borrowed.length;

  const sortBy = useCallback((list) => {
    const idx = (id) => {
      const i = recentIds.indexOf(id);
      return i < 0 ? Infinity : i;
    };
    return [...list].sort((a, b) => {
      const ra = idx(a._id); const rb = idx(b._id);
      if (ra !== rb) return ra - rb;
      return (a.ship_name || '').localeCompare(b.ship_name || '');
    });
  }, [recentIds]);

  const onMission = useMemo(() => sortBy(owned.filter(s => s.is_mission)), [owned, sortBy]);
  const available = useMemo(() => sortBy(owned.filter(s => !s.is_mission)), [owned, sortBy]);
  const borrowedSorted = useMemo(() => sortBy(borrowed), [borrowed, sortBy]);

  const groups = [
    { key: 'on', label: 'On mission', tone: 'ms-on', cardTone: 'ms-g-on', ships: onMission, borrowed: false },
    { key: 'av', label: 'Available',  tone: 'ms-av', cardTone: 'ms-g-av', ships: available, borrowed: false },
    { key: 'bw', label: 'Borrowed',   tone: 'ms-bw', cardTone: 'ms-g-bw', ships: borrowedSorted, borrowed: true },
  ].filter(g => g.ships.length > 0);

  const toggleGroup = (k) => {
    setGroupState(prev => ({ ...prev, [k]: !prev[k] }));
  };

  if (!loading && totalCount === 0) {
    return (
      <div ref={colRef} className="ms-left">
        {setLeftWidth && (
          <ColumnResizeHandle side="right" columnRef={colRef} setWidth={setLeftWidth} />
        )}
        <div className="ms-panelh">
          <span className="ms-title">Your fleet</span>
          <span className="badge b-blue">0</span>
        </div>
        <div className="ms-list">
          <div className="ms-empty-fleet">No ships registered yet.</div>
        </div>
        <div className="ms-reg ms-empty">
          <button className="btn go" onClick={() => { playClick(); onRegister?.(); }}>
            + Register ship
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={colRef} className="ms-left">
      {setLeftWidth && (
        <ColumnResizeHandle side="right" columnRef={colRef} setWidth={setLeftWidth} />
      )}
      <div className="ms-panelh">
        <span className="ms-title">Your fleet</span>
        <span className="badge b-blue">{totalCount}</span>
      </div>

      <div className="ms-list">
        {loading ? (
          <div className="empty" style={{ padding: 20 }}>Scanning{dots}</div>
        ) : groups.map(g => {
          const shut = !!groupState[g.key];
          return (
            <div key={g.key} className={`ms-grp ${shut ? 'ms-shut' : ''}`}>
              <button
                className={`ms-gh ${g.tone}`}
                aria-expanded={!shut}
                onClick={() => { playClick(); toggleGroup(g.key); }}
                type="button"
              >
                <span className="ms-dot" />
                <span>{g.label}</span>
                <span className="ms-count">{g.ships.length}</span>
                <span className="ms-chev"><IconChev /></span>
              </button>
              <div className="ms-gb">
                <div className="ms-gb-inner">
                  {g.ships.map(ship => {
                    const id = g.borrowed ? `borrowed-${ship._id}` : ship._id;
                    const selected = selectedId === id;
                    const spec = specs?.[ship.ship_model] || {};
                    const displayName = spec.display_name || formatModel(ship.ship_model);
                    const img = shipImages?.[ship.ship_model] || null;
                    const done = ship.missions_completed || 0;
                    const fill = ship.crew_fill_percentage;
                    const stat = done > 0
                      ? (typeof fill === 'number' && fill > 0
                          ? `${done} missions · ${Math.round(fill)}% avg fill`
                          : `${done} missions`)
                      : 'No missions yet';
                    const onLoan = !g.borrowed && loanedShipIds?.includes(String(ship._id));
                    const isNew = newId === String(ship._id);
                    const isExiting = exitingId === String(ship._id);
                    return (
                      <button
                        key={ship._id}
                        type="button"
                        className={`ms-card ${g.cardTone} ${selected ? 'ms-sel' : ''} ${isNew ? 'ms-new' : ''} ${isExiting ? 'ms-exit' : ''}`}
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => {
                          playClick();
                          if (g.borrowed) onSelectBorrowed?.(ship);
                          else onSelect?.(ship);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            playClick();
                            if (g.borrowed) onSelectBorrowed?.(ship);
                            else onSelect?.(ship);
                          }
                        }}
                        ref={selected ? (el) => el?.scrollIntoView({ block: 'nearest' }) : null}
                      >
                        {img ? (
                          <img src={img} alt="" className="ms-sil" />
                        ) : (
                          <div className="ms-sil ms-ph">—</div>
                        )}
                        <div className="ms-body">
                          <div className="ms-name" title={ship.ship_name}>{ship.ship_name}</div>
                          {displayName && <div className="ms-model" title={displayName}>{displayName}</div>}
                          <div className="ms-stat">
                            {stat}
                            {onLoan && <span style={{ marginLeft: 6, color: 'var(--cyan)' }}>· on loan</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="ms-reg">
        <button className="btn go" onClick={() => { playClick(); onRegister?.(); }}>
          + Register ship
        </button>
      </div>
    </div>
  );
}

// ─── Read-only schematic ────────────────────────────────────────────────────

function ReadOnlySchematic({ ship, schemImg }) {
  const [hoveredId, setHoveredId] = useState(null);
  const nodes = ship.node_positions || [];

  if (!schemImg) {
    return (
      <div className="ms-stage-inner" style={{ padding: 40, textAlign: 'center', color: 'var(--fg3)', fontSize: 11, letterSpacing: '.1em' }}>
        [ NO SCHEMATIC IMAGE ]
      </div>
    );
  }

  return (
    <div className="ms-stage-inner">
      <img
        src={schemImg}
        alt=""
        style={{
          width: '100%', height: 'auto', display: 'block',
          objectFit: 'contain',
          filter: 'invert(1) sepia(1) saturate(4) hue-rotate(170deg) brightness(0.5) contrast(1.3)',
        }}
      />
      <div style={{ position: 'absolute', inset: 8, pointerEvents: 'none' }}>
        {nodes.map((n, i) => (
          <div
            key={i}
            className="nexus-node"
            onMouseEnter={() => setHoveredId(i)}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              position: 'absolute',
              left: `${n.x}%`, top: `${n.y}%`,
              width: 48, height: 48,
              border: '2px solid var(--lime)',
              background: 'color-mix(in srgb, var(--lime) 20%, transparent)',
              transform: 'translate(-50%, -50%)',
              animation: 'nodePulse 1.8s ease-in-out infinite',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--lime)',
              fontSize: 14,
              pointerEvents: 'auto',
              userSelect: 'none',
            }}
          >
            {hoveredId === i && (
              <div style={{
                position: 'absolute',
                transform: 'translate(-50%, -140%)',
                left: '50%',
                background: 'var(--bg0)',
                border: '1px solid var(--rim0)',
                color: 'var(--fg1)',
                fontSize: 11,
                padding: '3px 7px',
                whiteSpace: 'nowrap',
                letterSpacing: '.06em',
                zIndex: 10,
              }}>
                {n.role}
              </div>
            )}
          </div>
        ))}
      </div>
      {nodes.length === 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg3)', letterSpacing: '.06em', textAlign: 'center' }}>
          NO CREW CONFIGURATION — EDIT TO ADD NODES
        </div>
      )}
    </div>
  );
}

// ─── Node editor (reused, visuals upgraded per spec) ────────────────────────

function NodeEditor({ ship, schemImg, nodes, setNodes, nextNodeIdRef }) {
  const [activeRole, setActiveRole] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);

  const schematicRef = useRef(null);
  const dragState = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const isInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (e.key === 'Delete' && selectedNodeId !== null) {
        if (isInput) return;
        e.preventDefault();
        setNodes(prev => prev.filter(n => n.id !== selectedNodeId));
        setSelectedNodeId(null);
      } else if (e.key === 'Escape') {
        if (isInput) return;
        setActiveRole(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, setNodes]);

  function placeNode(e) {
    e.preventDefault();
    if (!activeRole) return;
    if (!schematicRef.current) return;
    const rect = schematicRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    const id = nextNodeIdRef.current++;
    setNodes(prev => [...prev, { id, role: activeRole, x: +x.toFixed(1), y: +y.toFixed(1) }]);
  }

  function onNodeMouseDown(e, node) {
    e.stopPropagation();
    if (e.button === 2) return;
    const rect = schematicRef.current.getBoundingClientRect();
    dragState.current = {
      nodeId: node.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      rect,
      moved: false,
    };
    const onMove = (ev) => {
      const ds = dragState.current;
      if (!ds) return;
      const dx = ev.clientX - ds.startClientX;
      const dy = ev.clientY - ds.startClientY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ds.moved = true;
      if (ds.moved) {
        const x = ((ev.clientX - ds.rect.left) / ds.rect.width) * 100;
        const y = ((ev.clientY - ds.rect.top) / ds.rect.height) * 100;
        const cx = Math.max(0, Math.min(100, x));
        const cy = Math.max(0, Math.min(100, y));
        setNodes(prev => prev.map(n => n.id === ds.nodeId
          ? { ...n, x: +cx.toFixed(1), y: +cy.toFixed(1) }
          : n
        ));
      }
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function nodeLabel(node) {
    const sameRole = nodes.filter(n => n.role === node.role);
    return String(sameRole.findIndex(n => n.id === node.id) + 1);
  }

  return (
    <>
      <div style={{
        background: 'color-mix(in srgb, var(--amber) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--amber) 30%, transparent)',
        padding: '8px 12px', fontSize: 11, color: 'var(--fg1)',
        lineHeight: 1.7, letterSpacing: '.04em',
        marginBottom: 8,
      }}>
        <div style={{ color: 'var(--fg0)', marginBottom: 2, fontWeight: 600 }}>HOW TO CONFIGURE YOUR CREW</div>
        <div>1. Select a role · 2. Right-click schematic to place · 3. Left-click node to select · 4. Drag to move · 5. DELETE key to remove</div>
      </div>
      <div
        ref={schematicRef}
        onContextMenu={placeNode}
        onClick={() => setSelectedNodeId(null)}
        className="ms-stage-inner"
        style={{ cursor: activeRole ? 'crosshair' : 'default' }}
      >
        <div className="ms-edit-grid" />
        {schemImg ? (
          <img
            src={schemImg}
            alt=""
            style={{
              width: '100%', height: 'auto', display: 'block',
              pointerEvents: 'none',
              filter: 'invert(1) sepia(1) saturate(4) hue-rotate(170deg) brightness(0.5) contrast(1.3)',
            }}
          />
        ) : (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--fg3)', fontSize: 11 }}>
            [ NO SCHEMATIC IMAGE ]
          </div>
        )}
        <div style={{ position: 'absolute', inset: 8, pointerEvents: 'none' }}>
          {nodes.map((n, i) => {
            const isSelected = selectedNodeId === n.id;
            return (
              <div
                key={n.id}
                className="nexus-node ms-edit-ring"
                onMouseDown={e => onNodeMouseDown(e, n)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedNodeId(prev => prev === n.id ? null : n.id);
                }}
                onMouseEnter={() => setHoveredId(n.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  '--k': i,
                  position: 'absolute',
                  left: `${n.x}%`, top: `${n.y}%`,
                  width: 48, height: 48,
                  border: `2px solid ${isSelected ? 'var(--cyan)' : 'var(--lime)'}`,
                  background: isSelected ? 'color-mix(in srgb, var(--cyan) 15%, transparent)' : 'color-mix(in srgb, var(--lime) 20%, transparent)',
                  boxShadow: isSelected ? '0 0 0 3px color-mix(in srgb, var(--cyan) 30%, transparent)' : undefined,
                  transform: 'translate(-50%, -50%)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: isSelected ? 'var(--cyan)' : 'var(--lime)',
                  fontSize: 14,
                  pointerEvents: 'auto',
                  userSelect: 'none',
                  zIndex: 5,
                }}
              >
                {nodeLabel(n)}
                {hoveredId === n.id && (
                  <div style={{
                    position: 'absolute',
                    transform: 'translate(-50%, -140%)',
                    left: '50%',
                    background: 'var(--bg0)',
                    border: '1px solid var(--rim0)',
                    color: 'var(--fg1)',
                    fontSize: 11,
                    padding: '3px 7px',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    letterSpacing: '.06em',
                    zIndex: 10,
                  }}>
                    {n.role}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{
          fontSize: 10, color: 'var(--fg2)', letterSpacing: '.14em',
          marginBottom: 6, textTransform: 'uppercase', fontWeight: 700,
        }}>
          Crew role palette
        </div>
        {ROLE_CATEGORIES.map(cat => (
          <div key={cat.name} style={{ marginBottom: 8 }}>
            <div style={{
              fontSize: 10, color: 'var(--fg3)', letterSpacing: '.14em',
              borderBottom: '1px solid var(--rim0)', paddingBottom: 2,
              margin: '4px 0 3px', textTransform: 'uppercase', fontWeight: 700,
            }}>
              {cat.name}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 4 }}>
              {cat.roles.map(role => {
                const active = activeRole === role;
                const placed = nodes.some(n => n.role === role);
                return (
                  <button
                    key={role}
                    onClick={() => { playClick(); setActiveRole(prev => prev === role ? null : role); }}
                    style={{
                      padding: '5px 8px',
                      background: active ? 'color-mix(in srgb, var(--cyan) 8%, var(--bg0))' : 'var(--bg0)',
                      border: `1px solid ${active ? 'var(--cyan)' : placed ? 'var(--lime)' : 'var(--rim0)'}`,
                      color: active ? 'var(--cyan)' : placed ? 'var(--lime)' : 'var(--fg1)',
                      fontFamily: 'var(--font)', fontSize: 11, textAlign: 'left',
                      cursor: 'pointer', letterSpacing: '.06em',
                      borderRadius: 3,
                    }}
                  >
                    {placed ? `✓ ${role}` : role}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Mission history (right column — preserved from old impl) ───────────────

function MissionHistory({ ship, setRightWidth }) {
  const colRef = useRef(null);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const dots = useDots(loading);

  useEffect(() => {
    if (!ship?._id) { setRows(null); return; }
    setLoading(true);
    api.get(`/ships/${ship._id}/missions`)
      .then(({ data }) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [ship?._id]);

  return (
    <div ref={colRef} style={{
      width: '100%',
      position: 'relative',
      overflowY: 'auto',
      height: '100%',
      fontFamily: 'var(--font)',
      display: 'flex',
      flexDirection: 'column',
      borderLeft: '1px solid var(--rim0)',
      background: 'var(--bg1)',
    }}>
      {setRightWidth && (
        <ColumnResizeHandle side="left" columnRef={colRef} setWidth={setRightWidth} />
      )}
      <div className="sh">
        <span>Mission history</span>
        {rows && rows.length > 0 && <span className="badge b-blue">{rows.length}</span>}
      </div>

      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto' }}>
        {!ship ? (
          <div className="empty">Select a vessel to view history</div>
        ) : loading ? (
          <div className="empty" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span className="spinner" />Scanning{dots}
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="empty">No mission records</div>
        ) : (
          rows.map(r => {
            const isAbort = r.status === 'ABORT';
            return (
              <div key={r._id} className="raised" style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span className={isAbort ? 'badge b-red' : 'badge b-lime'}>{r.status}</span>
                  <span style={{ fontSize: 10, color: 'var(--fg3)', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                    {r.role}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--fg0)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg2)', marginTop: 2 }}>{r.mission_type}</div>
                <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                  {formatDate(r.completed_at)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Ship detail (front face) ───────────────────────────────────────────────

function ShipDetail({
  ship,
  specs,
  shipImages,
  isBorrowed,
  loanInfo,
  onChanged,
  onDeleted,
  onDeleteFailed,
  onBack,
  onViewLive,
  onLoanAction,
  liveOpen,
}) {
  const [stats, setStats] = useState(null);
  const [editing, setEditing] = useState(false);
  const [delArmed, setDelArmed] = useState(false);
  const [delRemain, setDelRemain] = useState(8);
  const [delShake, setDelShake] = useState(false);
  const [editorNodes, setEditorNodes] = useState([]);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState('');
  const editorNextNodeId = useRef(1);

  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [descSaving, setDescSaving] = useState(false);
  const descPulse = useSavePulse();
  const [descError, setDescError] = useState('');

  const [announce, setAnnounce] = useState('');
  const [statusGlow, setStatusGlow] = useState(false);
  const prevMissionRef = useRef(ship?.is_mission);

  const delTimerRef = useRef(null);
  const delIntervalRef = useRef(null);
  const rootRef = useRef(null);
  const delBtnRef = useRef(null);
  const backBtnRef = useRef(null);
  const liveBtnRef = useRef(null);

  // Status flip glow
  useEffect(() => {
    if (!ship) return;
    if (prevMissionRef.current !== ship.is_mission && prevMissionRef.current !== undefined) {
      setStatusGlow(true);
      const id = setTimeout(() => setStatusGlow(false), 700);
      prevMissionRef.current = ship.is_mission;
      return () => clearTimeout(id);
    }
    prevMissionRef.current = ship.is_mission;
  }, [ship?.is_mission]);

  // Load stats + reset per-ship state
  useEffect(() => {
    setEditing(false);
    disarmDelete(true);
    setStats(null);
    setEditorNodes([]);
    setEditorSaving(false);
    setEditorError('');
    setDescEditing(false);
    setDescDraft(ship?.description || '');
    setDescError('');
    if (!ship?._id) return;
    api.get(`/ships/${ship._id}/stats`).then(({ data }) => setStats(data)).catch(() => setStats(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ship?._id]);

  // Disarm on various triggers
  useEffect(() => {
    if (!delArmed) return;
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        disarmDelete();
        if (editing) cancelEdit();
      }
    };
    const onDoc = (e) => {
      if (delBtnRef.current && !delBtnRef.current.contains(e.target)) {
        disarmDelete();
      }
    };
    window.addEventListener('keydown', onEsc);
    window.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('keydown', onEsc);
      window.removeEventListener('mousedown', onDoc);
    };
  }, [delArmed, editing]);

  function disarmDelete(silent = false) {
    if (delTimerRef.current) { clearTimeout(delTimerRef.current); delTimerRef.current = null; }
    if (delIntervalRef.current) { clearInterval(delIntervalRef.current); delIntervalRef.current = null; }
    if (delArmed && !silent) setAnnounce('Delete cancelled');
    setDelArmed(false);
    setDelRemain(8);
  }

  function armDelete() {
    const armMs = (() => {
      if (!rootRef.current) return 8000;
      const v = getComputedStyle(rootRef.current).getPropertyValue('--del-arm').trim();
      const n = parseFloat(v);
      if (v.endsWith('ms')) return n;
      if (v.endsWith('s')) return n * 1000;
      return n || 8000;
    })();
    setDelArmed(true);
    setDelRemain(Math.round(armMs / 1000));
    setAnnounce('Delete vessel. Press again within 8 seconds to confirm.');
    if (delTimerRef.current) clearTimeout(delTimerRef.current);
    delTimerRef.current = setTimeout(() => disarmDelete(), armMs);
    if (delIntervalRef.current) clearInterval(delIntervalRef.current);
    delIntervalRef.current = setInterval(() => {
      setDelRemain(r => Math.max(0, r - 1));
    }, 1000);
  }

  async function doDelete() {
    if (!ship?._id) return;
    try {
      await api.delete(`/ships/${ship._id}`);
      disarmDelete(true);
      onDeleted?.(ship._id);
    } catch (err) {
      setDelShake(true);
      setTimeout(() => setDelShake(false), 320);
      disarmDelete(true);
      onDeleteFailed?.(err?.response?.data?.error || 'DELETE FAILED');
    }
  }

  function onDeleteClick() {
    if (!delArmed) armDelete();
    else doDelete();
  }

  function enterEdit() {
    disarmDelete();
    const init = (ship.node_positions || []).map((n, i) => ({
      id: i + 1,
      role: (n.role || '').toUpperCase(),
      x: n.x,
      y: n.y,
    }));
    setEditorNodes(init);
    editorNextNodeId.current = init.length + 1;
    setEditorSaving(false);
    setEditorError('');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditorError('');
  }

  async function saveNodes() {
    setEditorSaving(true);
    setEditorError('');
    try {
      const payload = {
        node_positions: editorNodes.map(n => ({ role: toTitleCase(n.role), x: n.x, y: n.y })),
      };
      await api.put(`/ships/${ship._id}/nodes`, payload);
      await onChanged?.();
      setEditing(false);
    } catch (err) {
      setEditorError(err?.response?.data?.error || 'NODE POSITIONS COULD NOT BE WRITTEN. TRY AGAIN.');
    } finally {
      setEditorSaving(false);
    }
  }

  // Count-up for the stat tiles
  const done = ship?.missions_completed || 0;
  const doneCount = useCountUp(done, 420, [ship?._id]);
  const fillTarget = typeof stats?.avg_fill_rate === 'number' && stats?.missions_analyzed > 0 ? stats.avg_fill_rate : 0;
  const fillCount = useCountUp(fillTarget, 420, [ship?._id, stats]);
  const rpTarget = typeof stats?.lifetime_rp === 'number' ? stats.lifetime_rp : 0;
  const rpCount = useCountUp(rpTarget, 420, [ship?._id, stats]);

  if (!ship) {
    return (
      <div className="ms-main">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 16, color: 'var(--fg3)' }}>
          <div>Select a vessel from your fleet</div>
          <button
            type="button"
            className="ms-abtn"
            onClick={() => { playClick(); onBack?.(); }}
          >
            <IconBack /> Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  const spec = specs?.[ship.ship_model] || {};
  const displayName = spec.display_name || formatModel(ship.ship_model);
  const ownerName = ship.owner_id?.citizen_name || ship.owner_id?.username || '—';
  const schemImg = shipImages?.[ship.ship_model] || null;
  const isOn = !!ship.is_mission;

  const canDelete = !isBorrowed && !loanInfo?.request_id;

  return (
    <div ref={rootRef} className="ms-main">
      {/* polite live region for delete announcements */}
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {announce}
      </div>

      {/* TOP */}
      <div className="ms-top ms-blk" style={{ '--k': 0 }}>
        <button
          type="button"
          ref={backBtnRef}
          className="ms-backbtn"
          aria-label="Back to dashboard"
          title="Back to dashboard"
          onClick={() => { playClick(); onBack?.(); }}
        >
          <IconBack />
        </button>
        <div className="ms-id">
          <h1 title={ship.ship_name}>{ship.ship_name}</h1>
          {displayName && <div className="ms-mdl" title={displayName}>{displayName}</div>}
          <div className="ms-meta">
            <span>Type · <b>{ship.type || '—'}</b></span>
            <span>Registered <b>{formatDate(ship.created_at)}</b></span>
            <span>Owner <b>{ownerName}</b></span>
          </div>
          <div className={`ms-status ${isOn ? 'ms-s-on' : 'ms-s-av'} ${statusGlow ? 'ms-glow' : ''}`}>
            <span className="ms-dot" />
            {isOn ? 'On mission' : 'Available'}
          </div>
        </div>

        <div className="ms-actions">
          {!editing ? (
            <>
              {!isBorrowed && (
                <button
                  type="button"
                  className="ms-abtn"
                  onClick={() => { playClick(); enterEdit(); }}
                  aria-label="Edit nodes"
                  title="Edit nodes"
                >
                  <IconEdit /> Edit nodes
                </button>
              )}
              <button
                type="button"
                ref={liveBtnRef}
                className="ms-abtn"
                disabled={!isOn}
                aria-label="View live mission"
                title={isOn ? 'View live mission' : 'Not on a mission'}
                onClick={() => {
                  if (!isOn) return;
                  playClick();
                  disarmDelete();
                  onViewLive?.(ship.current_mission_id);
                }}
              >
                <IconLive /> Live mission
              </button>
              {isBorrowed && loanInfo?.request_id ? (
                <button
                  type="button"
                  className="ms-abtn ms-save"
                  onClick={() => { playClick(); onLoanAction?.('return', loanInfo); }}
                >
                  Return ship
                </button>
              ) : loanInfo?.request_id ? (
                <button
                  type="button"
                  className="ms-abtn"
                  style={{ borderColor: 'var(--cyan)', color: 'var(--cyan)' }}
                  onClick={() => { playClick(); onLoanAction?.('withdraw', loanInfo); }}
                >
                  Withdraw access
                </button>
              ) : canDelete ? (
                <button
                  type="button"
                  ref={delBtnRef}
                  className={`ms-abtn ms-del ${delArmed ? 'ms-armed' : ''} ${delShake ? 'ms-shake' : ''}`}
                  aria-label={delArmed ? `Confirm delete in ${delRemain} seconds` : 'Delete vessel'}
                  title={delArmed ? 'Confirm delete' : 'Delete vessel'}
                  disabled={isOn}
                  onClick={(e) => { e.stopPropagation(); playClick(); if (!isOn) onDeleteClick(); }}
                >
                  {delArmed ? (
                    <>
                      <IconTrash />
                      <span style={{ fontSize: 11 }}>Confirm delete · {delRemain}</span>
                    </>
                  ) : (
                    <IconTrash />
                  )}
                  <span className="ms-del-bar" />
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                className="ms-abtn ms-save"
                disabled={editorSaving}
                onClick={() => { playClick(); saveNodes(); }}
              >
                {editorSaving ? 'Saving…' : 'Save nodes'}
              </button>
              <button
                type="button"
                className="ms-abtn ms-cancel"
                disabled={editorSaving}
                onClick={() => { playClick(); cancelEdit(); }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {editorError && (
        <div className="ms-blk" style={{
          '--k': 1,
          background: 'color-mix(in srgb, var(--red) 10%, transparent)',
          border: '1px solid var(--red)',
          color: 'var(--red)',
          padding: '8px 12px',
          fontSize: 11,
          letterSpacing: '.08em',
        }}>
          SAVE FAILED — {editorError}
        </div>
      )}

      {/* STAGE */}
      <div className="ms-stage ms-blk" style={{ '--k': 1 }} key={`stage-${ship._id}-${editing ? 'ed' : 'ro'}`}>
        {editing ? (
          <NodeEditor
            ship={ship}
            schemImg={schemImg}
            nodes={editorNodes}
            setNodes={setEditorNodes}
            nextNodeIdRef={editorNextNodeId}
          />
        ) : (
          <ReadOnlySchematic ship={ship} schemImg={schemImg} />
        )}
      </div>

      {/* PERFORMANCE */}
      <div className="ms-perf-wrap ms-blk" style={{ '--k': 2 }}>
        <div className="ms-h3">Vessel performance</div>
        <div className="ms-tiles">
          <div className="ms-tile">
            <div className="ms-tv">{doneCount}</div>
            <div className="ms-tl">Missions completed</div>
          </div>
          <div className="ms-tile">
            <div className="ms-tv">
              {stats?.missions_analyzed > 0 ? `${fillCount}%` : '—'}
            </div>
            <div className="ms-tl">Avg fill rate</div>
          </div>
          <div className="ms-tile ms-tv-lime">
            <div className="ms-tv">{stats ? rpCount : 0}</div>
            <div className="ms-tl">Lifetime RP</div>
          </div>
        </div>
      </div>

      {/* HISTORY */}
      <div className="ms-hist-wrap ms-blk" style={{ '--k': 3 }}>
        <div className="ms-h3">
          <span>Ship history</span>
          {!descEditing && (
            <button
              type="button"
              className="btn"
              onClick={() => { playClick(); setDescDraft(ship.description || ''); setDescError(''); setDescEditing(true); }}
              style={{ fontSize: 10, padding: '3px 10px', height: 24 }}
              title="Edit history"
              aria-label="Edit history"
            >
              <IconEdit />
            </button>
          )}
        </div>
        {descEditing ? (
          <>
            <textarea
              value={descDraft}
              onChange={e => setDescDraft(e.target.value.slice(0, 1000))}
              rows={8}
              placeholder="Write the ship's history — origin, notable missions, quirks, lore."
              style={{
                width: '100%',
                background: 'var(--bg0)',
                color: 'var(--fg0)',
                border: '1px solid var(--rim0)',
                borderRadius: 3,
                padding: 10,
                fontSize: 12,
                lineHeight: 1.55,
                fontFamily: 'var(--font)',
                resize: 'vertical',
                minHeight: 120,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--fg3)', letterSpacing: '.08em' }}>
                {descDraft.length}/1000
              </span>
              {descError && <span style={{ fontSize: 11, color: 'var(--red)' }}>{descError}</span>}
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="btn"
                onClick={() => { setDescEditing(false); setDescError(''); setDescDraft(ship.description || ''); }}
                disabled={descSaving}
                style={{ fontSize: 11, padding: '4px 10px' }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn go ${descPulse.className}`}
                disabled={descSaving || descDraft === (ship.description || '')}
                onClick={async () => {
                  setDescSaving(true); setDescError('');
                  try {
                    await api.put(`/ships/${ship._id}`, { description: descDraft });
                    setDescEditing(false);
                    onChanged?.();
                    descPulse.trigger();
                  } catch (err) {
                    setDescError(err?.response?.data?.error || 'save failed');
                  } finally {
                    setDescSaving(false);
                  }
                }}
                style={{ fontSize: 11, padding: '4px 12px' }}
              >
                {descSaving ? 'Saving…' : 'Save history'}
              </button>
            </div>
          </>
        ) : ship.description ? (
          <div className="ms-hist-body">{ship.description}</div>
        ) : (
          <div className="ms-hist-empty">No history yet.</div>
        )}
      </div>
    </div>
  );
}

// ─── Live face ──────────────────────────────────────────────────────────────

function LiveFace({ ship, onBack }) {
  if (!ship) return null;
  const roles = ship.node_positions || [];
  return (
    <div className="ms-main">
      <div className="ms-live-head">
        <button
          type="button"
          className="ms-backbtn"
          aria-label="Back to ship"
          title="Back to ship"
          onClick={() => { playClick(); onBack?.(); }}
        >
          <IconBack />
        </button>
        <div className="ms-id" style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 22, color: '#fff', textTransform: 'uppercase' }}>{ship.ship_name}</h1>
          <div className="ms-mdl" style={{ fontSize: 12, color: 'var(--fg2)', marginTop: 2 }}>
            Live mission
          </div>
        </div>
        <span className="ms-live-chip">
          <span className="ms-dot" /> Live
        </span>
      </div>
      <div className="ms-live-rows">
        {roles.length === 0 ? (
          <div className="empty" style={{ padding: 16 }}>No crew configuration.</div>
        ) : roles.map((r, i) => (
          <div key={i} className="ms-live-row" style={{ '--i': i }}>
            <span style={{ color: 'var(--fg3)', fontSize: 11, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
            <span style={{ fontSize: 12, color: 'var(--fg1)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{r.role}</span>
            <span style={{ fontSize: 10, color: 'var(--fg3)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Slot {i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Top-level ──────────────────────────────────────────────────────────────

export default function MyShips({
  selectedShip,
  setSelectedShip,
  onBack,
  onRegisterShip,
  onViewLiveMission,
  leftWidth = 300,
  setLeftWidth,
  rightWidth = 200,
  setRightWidth,
}) {
  ensureMsStyle();

  const [ships, setShips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [specs, setSpecs] = useState({});
  const [shipImages, setShipImages] = useState({});
  const [borrowedShips, setBorrowedShips] = useState([]);
  const [accessStatus, setAccessStatus] = useState({ as_owner_approved: [] });
  const [selectedBorrowed, setSelectedBorrowed] = useState(null);
  const [recentIds, setRecentIds] = useState([]);
  const [newId, setNewId] = useState(null);
  const [exitingId, setExitingId] = useState(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [dimmed, setDimmed] = useState(false);
  const [toast, setToast] = useState('');
  const prevShipIdsRef = useRef(new Set());

  // Per-user group collapse persistence
  const storageKey = useMemo(() => 'ms:groupState:v1', []);
  const [groupState, setGroupStateRaw] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });
  const setGroupState = useCallback((updater) => {
    setGroupStateRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [storageKey]);

  const fetchShips = useCallback(async () => {
    try {
      const { data } = await api.get('/ships/mine');
      const list = Array.isArray(data) ? data : [];
      // detect new ship arrivals
      const prev = prevShipIdsRef.current;
      const newcomer = list.find(s => !prev.has(String(s._id)));
      prevShipIdsRef.current = new Set(list.map(s => String(s._id)));
      if (prev.size > 0 && newcomer) {
        setNewId(String(newcomer._id));
        setTimeout(() => setNewId(null), 800);
        // auto-select the new ship
        setSelectedBorrowed(null);
        setSelectedShip(newcomer);
        setRecentIds(ids => [newcomer._id, ...ids.filter(x => x !== newcomer._id)]);
      }
      setShips(list);
      setSelectedShip(curr => {
        if (!curr) return curr;
        return list.find(s => s._id === curr._id) || null;
      });
    } catch {
      setShips([]);
    } finally {
      setLoading(false);
    }
  }, [setSelectedShip]);

  const fetchAccessStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/ships/access-requests/mine');
      setAccessStatus(data || { as_owner_approved: [] });
    } catch {}
  }, []);

  const fetchBorrowed = useCallback(async () => {
    try {
      const { data } = await api.get('/ships/borrowed');
      setBorrowedShips(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchShips();
    fetchAccessStatus();
    fetchBorrowed();
    fetch('/images/ships/ship_specs.json')
      .then(r => r.json()).then(setSpecs).catch(() => setSpecs({}));
    fetch('/images/ships/ship_index_large.json')
      .then(r => r.json()).then(setShipImages).catch(() => setShipImages({}));
    // seed previous IDs so first load doesn't fire the "new ship" wash for every card
  }, [fetchShips, fetchAccessStatus, fetchBorrowed]);

  useEffect(() => {
    if (prevShipIdsRef.current.size === 0 && ships.length > 0) {
      prevShipIdsRef.current = new Set(ships.map(s => String(s._id)));
    }
  }, [ships]);

  // ── Realtime mission-status updates ───────────────────────────────────
  // Server emits mission_launched / mission_complete / mission_aborted
  // whenever a ship's is_mission state flips. Subscribe and refetch so the
  // card moves between "On mission" and "Available" groups without the
  // user having to reload the view. Debounced so a burst of events (e.g.,
  // multi-ship launch) collapses into one request.
  const socketCtx = useSocketContext();
  useEffect(() => {
    const socket = socketCtx?.socket;
    if (!socket) return;
    let timer = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; fetchShips(); }, 200);
    };
    const events = [
      'mission_launched',
      'mission_complete',
      'mission_aborted',
      'mission_finalized',
      'crew_fill_updated',
      'ship_borrowed',
    ];
    for (const ev of events) socket.on(ev, refresh);
    return () => {
      if (timer) clearTimeout(timer);
      for (const ev of events) socket.off(ev, refresh);
    };
  }, [socketCtx?.socket, fetchShips]);

  // Escape closes live view
  useEffect(() => {
    if (!liveOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setLiveOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [liveOpen]);

  const loanedShipIds = (accessStatus.as_owner_approved || []).map(l => String(l.ship_id));

  const loanInfoForShip = (ship) => {
    if (!ship) return null;
    return (accessStatus.as_owner_approved || []).find(
      l => String(l.ship_id) === String(ship._id)
    ) || null;
  };
  const loanInfoForBorrowed = (ship) => {
    if (!ship) return null;
    return borrowedShips.find(b => String(b._id) === String(ship._id)) || null;
  };

  const displayShip = selectedBorrowed || selectedShip;
  const isBorrowed = !!selectedBorrowed;
  const loanInfo = isBorrowed ? loanInfoForBorrowed(selectedBorrowed) : loanInfoForShip(selectedShip);
  const selectedId = selectedBorrowed ? `borrowed-${selectedBorrowed._id}` : selectedShip?._id;

  async function handleLoanAction(action, info) {
    try {
      if (action === 'return') {
        await api.post(`/ships/${info._id || info.ship_id}/return-ship`, { request_id: info.request_id });
        setSelectedBorrowed(null);
        fetchBorrowed();
        fetchAccessStatus();
      } else if (action === 'withdraw') {
        await api.post(`/ships/${info.ship_id || selectedShip._id}/withdraw-access`, { request_id: info.request_id });
        fetchAccessStatus();
      }
    } catch {}
  }

  function handleSelect(ship) {
    setLiveOpen(false);
    setSelectedBorrowed(null);
    setSelectedShip(ship);
    setRecentIds(ids => [ship._id, ...ids.filter(x => x !== ship._id)]);
  }
  function handleSelectBorrowed(ship) {
    setLiveOpen(false);
    setSelectedShip(null);
    setSelectedBorrowed(ship);
    setRecentIds(ids => [ship._id, ...ids.filter(x => x !== ship._id)]);
  }

  function handleDeleted(deletedId) {
    const idStr = String(deletedId);
    setExitingId(idStr);
    setTimeout(() => {
      setShips(prev => {
        const next = prev.filter(s => String(s._id) !== idStr);
        // pick next-in-group selection
        const wasOnMission = prev.find(s => String(s._id) === idStr)?.is_mission;
        const remaining = next.filter(s => !!s.is_mission === !!wasOnMission);
        const pick = remaining[0] || next[0] || null;
        setSelectedShip(pick);
        return next;
      });
      setExitingId(null);
    }, 240);
  }

  function handleBackToDashboard() {
    setDimmed(true);
    setTimeout(() => {
      onBack?.();
    }, 160);
  }

  function handleViewLive(missionId) {
    // Slide to live face first, then navigate (route change), so the slide is visible.
    setLiveOpen(true);
    setTimeout(() => {
      onViewLiveMission?.(missionId);
    }, 420);
  }

  return (
    <div className={`ms-root ${liveOpen ? 'ms-live' : ''} ${dimmed ? 'ms-dim' : ''}`} style={{
      // Give the left panel its own width so the right MissionHistory column can keep its resize.
      display: 'grid',
      gridTemplateColumns: `${leftWidth}px 1fr ${rightWidth}px`,
    }}>
      <FleetList
        owned={ships}
        borrowed={borrowedShips}
        loading={loading}
        specs={specs}
        shipImages={shipImages}
        selectedId={selectedId}
        onSelect={handleSelect}
        onSelectBorrowed={handleSelectBorrowed}
        onRegister={onRegisterShip}
        setLeftWidth={setLeftWidth}
        groupState={groupState}
        setGroupState={setGroupState}
        loanedShipIds={loanedShipIds}
        recentIds={recentIds}
        newId={newId}
        exitingId={exitingId}
      />

      <div style={{ position: 'relative', minWidth: 0, overflow: 'hidden' }} key={`detail-${displayShip?._id || 'none'}`}>
        {!liveOpen ? (
          <ShipDetail
            ship={displayShip}
            specs={specs}
            shipImages={shipImages}
            isBorrowed={isBorrowed}
            loanInfo={loanInfo}
            onChanged={fetchShips}
            onDeleted={handleDeleted}
            onDeleteFailed={(msg) => setToast(msg)}
            onBack={handleBackToDashboard}
            onViewLive={handleViewLive}
            onLoanAction={handleLoanAction}
            liveOpen={liveOpen}
          />
        ) : (
          <LiveFace ship={displayShip} onBack={() => setLiveOpen(false)} />
        )}
        {toast && (
          <div style={{
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--bg1)', border: '1px solid var(--red)', color: 'var(--red)',
            padding: '8px 14px', fontSize: 12, letterSpacing: '.06em', zIndex: 5,
            borderRadius: 3,
          }}
          onAnimationEnd={() => setToast('')}>
            {toast}
            <button
              onClick={() => setToast('')}
              style={{ marginLeft: 10, background: 'transparent', border: 0, color: 'var(--red)', cursor: 'pointer' }}
            >×</button>
          </div>
        )}
      </div>

      <MissionHistory ship={displayShip} setRightWidth={setRightWidth} />
    </div>
  );
}
