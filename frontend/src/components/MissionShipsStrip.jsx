import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../services/api';
import formatModel from '../utils/formatShipModel';

// ms2- CSS prefix — avoids colliding with the MyShips "ms-" prefix. All styles
// local to this file (injected once), tokens fall back when host app lacks
// --d1..--d4/--out/--snap/--cyan/--lime/etc. The design-ref doc calls for a
// "gold" role which this app routes through --cyan.

const STYLE_ID = 'ms2-styles';
const STYLE = `
.ms2-wrap{--ms2-d1:var(--d1,90ms);--ms2-d2:var(--d2,160ms);--ms2-d3:var(--d3,280ms);--ms2-d4:var(--d4,420ms);--ms2-out:var(--out,cubic-bezier(.2,.8,.2,1));--ms2-snap:var(--snap,cubic-bezier(.34,1.56,.64,1));--ms2-gold:var(--cyan,#7ef0dc);--ms2-loan-hold:1000ms;font-family:'Inter',system-ui,sans-serif}
.ms2-hdr{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;min-height:26px;flex-wrap:wrap}
.ms2-hdr-l{display:flex;gap:10px;align-items:center}
.ms2-hdr-r{display:flex;gap:12px;align-items:center}
.ms2-lbl{font:700 10px Inter;letter-spacing:.14em;text-transform:uppercase;color:var(--fg2)}
.ms2-tot{font:600 11px Inter;color:var(--fg2);font-variant-numeric:tabular-nums}
.ms2-tot b{color:var(--fg1,var(--fg0));display:inline-block}
.ms2-tot b.ms2-tick{animation:ms2-tick 700ms var(--ms2-out)}
@keyframes ms2-tick{0%{color:var(--ms2-gold);transform:scale(1.25)}100%{color:var(--fg1,var(--fg0));transform:none}}
.ms2-addb{padding:4px 10px;border:1px solid var(--rim1);background:var(--bg2);font:700 10px Inter;letter-spacing:.1em;text-transform:uppercase;color:var(--ms2-gold);cursor:pointer;transition:background var(--ms2-d2)}
.ms2-addb:hover,.ms2-addb[aria-expanded=true]{background:var(--bg3)}
.ms2-addb:focus-visible{outline:2px solid var(--ms2-gold);outline-offset:1px}
.ms2-toast{display:flex;align-items:center;gap:8px;font:600 11px Inter;color:var(--lime);position:relative;padding-bottom:3px;animation:ms2-tin var(--ms2-d3) var(--ms2-out)}
.ms2-toast.ms2-bad{color:var(--red)}
.ms2-toast.ms2-neutral{color:var(--fg2)}
.ms2-toast button{color:var(--ms2-gold);font:700 10px Inter;letter-spacing:.1em;text-decoration:underline;background:none;border:0;cursor:pointer}
.ms2-toast i{position:absolute;left:0;bottom:0;height:2px;background:var(--lime);width:100%;transform-origin:left;animation:ms2-cd 6000ms linear forwards}
.ms2-toast.ms2-bad i{background:var(--red)}
.ms2-toast.ms2-out{animation:ms2-tout var(--ms2-d3) var(--ms2-out) forwards}
@keyframes ms2-tin{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@keyframes ms2-tout{to{opacity:0}}
@keyframes ms2-cd{to{transform:scaleX(0)}}
.ms2-pk{display:grid;grid-template-rows:0fr;transition:grid-template-rows var(--ms2-d3) var(--ms2-out);margin-bottom:0}
.ms2-pk[data-open=true]{grid-template-rows:1fr;margin-bottom:8px}
.ms2-pk>div{overflow:hidden;min-height:0}
.ms2-pki{border:1px solid var(--rim1);background:var(--bg1);padding:8px}
.ms2-pkh{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px}
.ms2-pkx{width:22px;height:22px;display:grid;place-items:center;color:var(--fg2);font-size:16px;line-height:1;background:none;border:0;cursor:pointer}
.ms2-pkx:hover{color:var(--ms2-gold)}
.ms2-pkl{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px}
@media(max-width:480px){.ms2-pkl{grid-template-columns:1fr}}
.ms2-pr{display:flex;gap:9px;align-items:center;padding:6px 8px;border:1px solid var(--rim0);background:var(--bg0);transition:background var(--ms2-d2),border-color var(--ms2-d2);cursor:pointer;text-align:left;width:100%}
.ms2-pk[data-open=true] .ms2-pr{animation:ms2-rise var(--ms2-d3) var(--ms2-out) calc(var(--ms2-i)*40ms + 120ms) both}
@keyframes ms2-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.ms2-pr:hover:not(.ms2-off){background:var(--bg3);border-color:var(--rim1)}
.ms2-pr.ms2-off{cursor:default;opacity:.55}
.ms2-pr.ms2-off .ms2-go{color:var(--fg2)}
.ms2-pr.ms2-flash{animation:ms2-flash 160ms var(--ms2-out) both!important;background:color-mix(in srgb,var(--ms2-gold) 28%,var(--bg3))}
@keyframes ms2-flash{0%{opacity:1}50%{opacity:1;transform:scale(.98)}100%{opacity:1;transform:none}}
.ms2-th{position:relative;background:var(--bg0);border:1px solid var(--rim0);display:grid;place-items:center;flex:none;overflow:hidden}
.ms2-th img{width:92%;height:92%;object-fit:contain;filter:grayscale(1) brightness(1.35) contrast(1.05)}
.ms2-th.ms2-pri{border-color:var(--blue);box-shadow:0 0 0 1px color-mix(in srgb,var(--blue) 40%,transparent)}
.ms2-nm{font:600 12px/1.25 Inter;color:var(--ms2-gold);text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms2-ty{font-size:10px;color:var(--fg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ms2-go{font:700 10px Inter;letter-spacing:.1em;text-transform:uppercase;color:var(--lime)}
.ms2-pkb{padding:4px 10px;border:1px solid var(--rim1);background:var(--bg2);font:700 10px Inter;letter-spacing:.1em;text-transform:uppercase;color:var(--ms2-gold);cursor:pointer;transition:background var(--ms2-d2)}
.ms2-pkb:hover{background:var(--bg3)}
.ms2-pke{grid-column:1/-1;color:var(--fg2);padding:8px;text-align:center;font-size:12px}
.ms2-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:12px;scroll-snap-type:x proximity}
.ms2-tab{flex:1 1 0;min-width:116px;max-width:240px;scroll-snap-align:start;display:flex;flex-direction:column;gap:5px;padding:8px 8px 7px;border:1px solid var(--rim0);background:var(--bg1);position:relative;transition:background var(--ms2-d2),border-color var(--ms2-d2);cursor:pointer;font-family:inherit;color:inherit;text-align:left}
.ms2-tab:hover:not([aria-selected=true]){background:var(--bg2)}
.ms2-tab[aria-selected=true]{background:var(--bg3);border-color:var(--rim1);box-shadow:inset 0 2px 0 var(--ms2-gold)}
.ms2-tab:focus-visible{outline:2px solid var(--ms2-gold);outline-offset:1px}
.ms2-tab.ms2-pri{flex-grow:1.35}
.ms2-tab .ms2-t1{display:flex;gap:8px;align-items:center;min-width:0}
.ms2-tab .ms2-th{width:40px;height:28px}
.ms2-tab .ms2-tx{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
.ms2-tab .ms2-t2{display:flex;justify-content:space-between;align-items:center;gap:6px}
.ms2-tab.ms2-pending{border-style:dashed;border-color:var(--rim1)}
.ms2-tab.ms2-enter{overflow:hidden;animation:ms2-tabin var(--ms2-d4) var(--ms2-out) both,ms2-pulse 900ms var(--ms2-out) 120ms}
.ms2-tab.ms2-leave{overflow:hidden;animation:ms2-tabout var(--ms2-d3) var(--ms2-out) forwards}
@keyframes ms2-tabin{from{flex-grow:0;min-width:0;opacity:0;transform:scale(.94)}to{flex-grow:1;min-width:116px;opacity:1;transform:none}}
@keyframes ms2-tabout{to{flex-grow:0;min-width:0;opacity:0;transform:scale(.94);padding-inline:0;border-width:0}}
@keyframes ms2-pulse{0%{box-shadow:inset 0 2px 0 var(--ms2-gold),0 0 0 0 color-mix(in srgb,var(--ms2-gold) 55%,transparent)}100%{box-shadow:inset 0 2px 0 var(--ms2-gold),0 0 0 8px transparent}}
.ms2-fillc{--ms2-fill:var(--red)}.ms2-fillm{--ms2-fill:var(--amber)}.ms2-fillh{--ms2-fill:var(--lime)}
.ms2-pc{font:700 11px Inter;color:var(--ms2-fill);font-variant-numeric:tabular-nums}
.ms2-tab.ms2-pending .ms2-pc{color:var(--fg2)}
.ms2-bar{display:block;height:3px;background:var(--bg0);overflow:hidden}
.ms2-bar u{display:block;height:100%;background:var(--ms2-fill);transition:width var(--ms2-d3) var(--ms2-out)}
.ms2-tab.ms2-pending .ms2-bar u{background:transparent}
.ms2-prl{font:700 9px Inter;letter-spacing:.14em;text-transform:uppercase;color:var(--blue)}
.ms2-sm{font-size:10px;color:var(--fg2)}
.ms2-bor{font:700 9px Inter;letter-spacing:.12em;text-transform:uppercase;color:var(--ms2-gold);border:1px dashed var(--rim1);padding:0 4px;animation:ms2-wt 1600ms ease-in-out infinite}
@keyframes ms2-wt{0%,100%{opacity:1}50%{opacity:.45}}
.ms2-bor.ms2-ok{color:var(--lime);border:1px solid var(--lime);animation:ms2-pop var(--ms2-d2) var(--ms2-snap)}
@keyframes ms2-pop{from{transform:scale(.85);opacity:0}to{transform:none;opacity:1}}
.ms2-pend{display:grid;grid-template-rows:1fr;transition:grid-template-rows var(--ms2-d3) var(--ms2-out);margin-bottom:8px}
.ms2-pend.ms2-gone{grid-template-rows:0fr;margin-bottom:0}
.ms2-pend>div{overflow:hidden;min-height:0}
.ms2-pendi{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border:1px dashed var(--rim1);background:var(--bg1);padding:8px 10px;color:var(--fg2);font-size:12px}
.ms2-pendi b{color:var(--fg0,var(--fg1))}
.ms2-cancel{padding:4px 10px;border:1px solid var(--rim1);background:var(--bg2);font:700 10px Inter;letter-spacing:.1em;text-transform:uppercase;color:var(--fg1,var(--fg0));cursor:pointer}
.ms2-cancel:hover{background:var(--bg3)}
.ms2-swap{animation:ms2-sw var(--ms2-d3) var(--ms2-out)}
@keyframes ms2-sw{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.ms2-soon{padding:18px 10px;text-align:center;color:var(--fg2);font-size:12px;letter-spacing:.06em}
.ms2-soon b{display:block;color:var(--ms2-gold);font:700 11px Inter;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px}
@media(prefers-reduced-motion:reduce){.ms2-wrap *{animation:none!important;transition:none!important}.ms2-pr{opacity:1!important;transform:none!important}}
`;

function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

function fillClass(pct) {
  if (pct < 34) return 'ms2-fillc';
  if (pct < 67) return 'ms2-fillm';
  return 'ms2-fillh';
}

function shipFill(ship) {
  const roles = Object.values(ship?.crew_roles || {});
  const crew = roles.reduce((s, r) => s + (r.slots || 0), 0);
  const filled = roles.reduce((s, r) => s + ((r.filled || []).length), 0);
  const pct = crew > 0 ? Math.min(100, Math.round((filled / crew) * 100)) : 0;
  return { filled, crew, pct };
}

function modelSlug(ship) {
  const src = ship?.ship_model || ship?.type || '';
  return src.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
function findThumb(ship, idx) {
  if (!ship || !idx) return null;
  const k = modelSlug(ship);
  if (idx[k]) return idx[k];
  const bare = (ship.type || '').toLowerCase().replace(/\s+/g, '_');
  if (bare) for (const [kk, v] of Object.entries(idx)) if (kk.endsWith('_' + bare)) return v;
  return null;
}
// formatModel moved to utils/formatShipModel.js — one source of truth.

const LS_KEY = (mid) => `nexus.ms2.pendingLoans.${mid}`;

export default function MissionShipsStrip({
  mission,
  selectedShipId,
  onSelectShip,
  missionId,
  canAdd,
  onMissionRefresh,
  preselectFriendId,
  onPreselectConsumed,
}) {
  ensureStyle();

  const ships = useMemo(
    () => [mission.primary_ship, ...(mission.supporting_ships ?? [])].filter(Boolean),
    [mission]
  );

  const [shipThumbs, setShipThumbs] = useState({});
  useEffect(() => {
    fetch('/images/ships/ship_index_large.json').then(r => r.json()).then(setShipThumbs).catch(() => {});
  }, []);

  // Pending loans persist per-mission so the pending tab survives reload.
  const [pendingLoans, setPendingLoans] = useState([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY(missionId));
      setPendingLoans(raw ? JSON.parse(raw) : []);
    } catch { setPendingLoans([]); }
  }, [missionId]);
  const savePending = useCallback((next) => {
    setPendingLoans(next);
    try { localStorage.setItem(LS_KEY(missionId), JSON.stringify(next)); } catch {}
  }, [missionId]);

  // Prune pending loans whose underlying request resolved — approvals surface
  // as supporting_ships on refresh; declines/withdraws drop from
  // access-requests/mine. We poll /mine when picker opens and on mount.
  const [myRequests, setMyRequests] = useState([]);
  const refreshRequests = useCallback(async () => {
    try {
      const { data } = await api.get('/ships/access-requests/mine');
      setMyRequests(data?.as_requester || []);
    } catch {}
  }, []);
  useEffect(() => { refreshRequests(); }, [refreshRequests]);

  // Clear pending entries for ships now on the mission or whose request is gone.
  useEffect(() => {
    const missionShipIds = new Set(ships.map(s => String(s._id)));
    const pendingReqIds = new Set(
      (myRequests || []).filter(r => r.status === 'pending').map(r => String(r._id))
    );
    const next = pendingLoans.filter(p =>
      !missionShipIds.has(String(p.shipId)) && pendingReqIds.has(String(p.requestId))
    );
    if (next.length !== pendingLoans.length) savePending(next);
  }, [ships, myRequests, pendingLoans, savePending]);

  // Build the ordered tab list: real ships first (primary + supporting), then
  // pending-loan placeholders.
  const tabs = useMemo(() => {
    const real = ships.map((s, i) => ({
      id: String(s._id),
      ship: s,
      isPending: false,
      isPrimary: i === 0,
      borrowedFrom: s.owner_id?.citizen_name || null,
    }));
    const pending = pendingLoans.map(p => ({
      id: 'pending:' + p.shipId,
      ship: p.shipSnapshot,
      isPending: true,
      isPrimary: false,
      borrowedFrom: p.ownerName,
      pendingRef: p,
    }));
    return [...real, ...pending];
  }, [ships, pendingLoans]);

  // Keep selectedShipId valid (falls back to primary).
  useEffect(() => {
    if (!tabs.find(t => t.id === selectedShipId)) {
      onSelectShip?.(tabs[0]?.id || null);
    }
  }, [tabs, selectedShipId, onSelectShip]);

  // Mission total (excludes pending-loan ships entirely).
  const totals = useMemo(() => {
    let f = 0, c = 0;
    for (const s of ships) {
      const { filled, crew } = shipFill(s);
      f += filled; c += crew;
    }
    return { filled: f, crew: c, text: `${f}/${c}` };
  }, [ships]);

  const [totalTick, setTotalTick] = useState(false);
  const prevTotalRef = useRef(totals.text);
  useEffect(() => {
    if (prevTotalRef.current !== totals.text) {
      prevTotalRef.current = totals.text;
      setTotalTick(true);
      const t = setTimeout(() => setTotalTick(false), 720);
      return () => clearTimeout(t);
    }
  }, [totals.text]);

  // Picker state.
  const [pkOpen, setPkOpen] = useState(false);
  const [pkView, setPkView] = useState('mine'); // 'mine' | 'friend'
  const [myShips, setMyShips] = useState([]);
  const [allShips, setAllShips] = useState([]);
  const [pkLoading, setPkLoading] = useState(false);
  const [busyShipId, setBusyShipId] = useState(null);
  const [flashRowId, setFlashRowId] = useState(null);
  const [enterTabId, setEnterTabId] = useState(null);
  const [leaveTabId, setLeaveTabId] = useState(null);
  const addBtnRef = useRef(null);
  const pkRef = useRef(null);

  // v1.2 — borrow-from-friend state (replaces the earlier "coming soon"
  // stub now that /api/friends is live).
  const [friendList, setFriendList]           = useState([]);
  const [friendShips, setFriendShips]         = useState({}); // userId -> ship[]
  const [activeFriendId, setActiveFriendId]   = useState(null);
  const [friendBusy, setFriendBusy]           = useState(false);

  const loadFriends = useCallback(async () => {
    try {
      const { data } = await api.get('/friends');
      setFriendList(Array.isArray(data) ? data : []);
    } catch {}
  }, []);
  const loadFriendShips = useCallback(async (userId) => {
    if (!userId) return;
    setFriendBusy(true);
    try {
      const { data } = await api.get(`/ships?owner_id=${userId}`);
      setFriendShips(prev => ({ ...prev, [userId]: Array.isArray(data) ? data : [] }));
    } catch {
      setFriendShips(prev => ({ ...prev, [userId]: [] }));
    } finally { setFriendBusy(false); }
  }, []);

  const openPicker = useCallback(async (opts = {}) => {
    const view = opts.view === 'friend' ? 'friend' : 'mine';
    setPkView(view);
    setPkOpen(true);
    setPkLoading(true);
    try {
      const [mine, all] = await Promise.all([
        api.get('/ships/all'),
        api.get('/ships'),
      ]);
      setMyShips(mine.data || []);
      setAllShips(all.data || []);
    } catch {} finally { setPkLoading(false); }
    if (view === 'friend') { await loadFriends(); }
    refreshRequests();
  }, [refreshRequests, loadFriends]);

  // Deep-link from the friends drawer / id card: open the picker directly
  // in the Borrow view with the given friend pre-selected.
  useEffect(() => {
    if (!preselectFriendId) return;
    (async () => {
      await openPicker({ view: 'friend' });
      setActiveFriendId(String(preselectFriendId));
      await loadFriendShips(String(preselectFriendId));
      onPreselectConsumed?.();
    })();
    // eslint-disable-next-line
  }, [preselectFriendId]);

  const closePicker = useCallback(() => {
    setPkOpen(false);
    setTimeout(() => addBtnRef.current?.focus(), 0);
  }, []);

  // Close on Esc + outside click.
  useEffect(() => {
    if (!pkOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closePicker(); }
    };
    const onDown = (e) => {
      if (!pkRef.current) return;
      if (!pkRef.current.contains(e.target) && !addBtnRef.current?.contains(e.target)) {
        closePicker();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [pkOpen, closePicker]);

  // Toast state.
  const [toast, setToast] = useState(null); // {msg, kind: 'ok'|'bad'|'neutral', undoShipId?}
  const toastTimerRef = useRef(null);
  const showToast = useCallback((msg, kind = 'ok', undoShipId = null) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, kind, undoShipId });
    toastTimerRef.current = setTimeout(() => setToast(null), 6000);
  }, []);

  // Live region for a11y.
  const [liveMsg, setLiveMsg] = useState('');

  // Tab keyboard nav.
  const tabsRef = useRef(null);
  const onTabsKeyDown = (e) => {
    const list = tabs;
    const i = list.findIndex(t => t.id === selectedShipId);
    if (i < 0) return;
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = list.length - 1;
    else return;
    e.preventDefault();
    onSelectShip?.(list[n].id);
    setTimeout(() => {
      const el = tabsRef.current?.querySelector(`[data-tabid="${CSS.escape(list[n].id)}"]`);
      el?.focus();
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }, 0);
  };

  const missionShipIds = useMemo(() => new Set(ships.map(s => String(s._id))), [ships]);

  const yourShipsForPicker = useMemo(() => {
    return myShips.map(sh => {
      const id = String(sh._id);
      const onThis = missionShipIds.has(id);
      // ships on this mission already won't be "is_mission" blocked separately
      const onOther = sh.is_mission && !onThis;
      const pendingReq = (myRequests || []).some(r =>
        String(r.ship_id) === id && r.status === 'pending'
      );
      let right = 'ADD', disabled = false;
      if (onThis) { right = 'ON THIS MISSION'; disabled = true; }
      else if (onOther) { right = 'ON MISSION'; disabled = true; }
      else if (pendingReq) { right = 'REQUESTED'; disabled = true; }
      return { ship: sh, right, disabled };
    });
  }, [myShips, missionShipIds, myRequests]);

  const anyAddable = yourShipsForPicker.some(r => !r.disabled);

  // Add flow — row flash + add call + tab enter + toast.
  const addShip = useCallback(async (shipId, rowId) => {
    if (busyShipId) return;
    setFlashRowId(rowId);
    setTimeout(() => setFlashRowId(null), 180);
    setBusyShipId(shipId);
    try {
      await api.post(`/missions/${missionId}/add-ship`, { ship_id: shipId });
      setEnterTabId(String(shipId));
      setTimeout(() => setEnterTabId(null), 1400);
      onMissionRefresh?.();
      onSelectShip?.(String(shipId));
      // picker collapse
      setTimeout(() => setPkOpen(false), 120);
      // toast with UNDO (own-fleet only — borrow flow uses a different path)
      const ship = myShips.find(s => String(s._id) === String(shipId));
      const name = (ship?.ship_name || 'SHIP').toUpperCase();
      showToast(`${name} ADDED`, 'ok', shipId);
      setLiveMsg(`${ship?.ship_name || 'Ship'} added to the mission`);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.error || 'FAILED TO ADD SHIP';
      showToast(msg, 'bad');
    } finally {
      setBusyShipId(null);
    }
  }, [busyShipId, missionId, myShips, onMissionRefresh, onSelectShip, showToast]);

  // Undo — no server remove endpoint exists today; best-effort DELETE call
  // keeps the design intact if it is added later, otherwise surfaces a notice.
  const undoAdd = useCallback(async (shipId) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
    setLeaveTabId(String(shipId));
    try {
      await api.delete(`/missions/${missionId}/ship/${shipId}`);
      onMissionRefresh?.();
      setLiveMsg('Ship removed');
    } catch (err) {
      // Backend route may not exist yet — refresh so the UI stays truthful.
      onMissionRefresh?.();
      showToast('UNDO FAILED — REMOVE NOT SUPPORTED', 'bad');
    } finally {
      setTimeout(() => setLeaveTabId(null), 320);
    }
  }, [missionId, onMissionRefresh, showToast]);

  const selectedTab = tabs.find(t => t.id === selectedShipId) || tabs[0];
  const selectedPending = selectedTab?.isPending ? selectedTab.pendingRef : null;

  const cancelPending = useCallback(async (p) => {
    try {
      // The ships route exposes cancel/withdraw via request-access delete-style;
      // fall back silently if unsupported — the UI still clears the tab.
      await api.delete(`/ships/access-requests/${p.requestId}`).catch(() => {});
    } finally {
      savePending(pendingLoans.filter(x => x.requestId !== p.requestId));
      onSelectShip?.(tabs[0]?.id || null);
      showToast('LOAN REQUEST CANCELED', 'neutral');
      refreshRequests();
    }
  }, [pendingLoans, savePending, onSelectShip, tabs, showToast, refreshRequests]);

  const nShips = tabs.length;

  return (
    <div className="ms2-wrap">
      {/* Strip header */}
      <div className="ms2-hdr">
        <div className="ms2-hdr-l">
          <span className="ms2-lbl">Ships on this mission · {nShips}</span>
          {toast && (
            <span className={`ms2-toast ${toast.kind === 'bad' ? 'ms2-bad' : toast.kind === 'neutral' ? 'ms2-neutral' : ''}`}>
              <span>{toast.msg}</span>
              {toast.undoShipId && (
                <button
                  type="button"
                  onClick={() => undoAdd(toast.undoShipId)}
                >UNDO</button>
              )}
              <i />
            </span>
          )}
        </div>
        <div className="ms2-hdr-r">
          <span className="ms2-tot">
            Mission crew <b className={totalTick ? 'ms2-tick' : ''}>{totals.text}</b>
          </span>
          {canAdd && (
            <button
              ref={addBtnRef}
              type="button"
              className="ms2-addb"
              aria-expanded={pkOpen}
              aria-controls="ms2-pk"
              onClick={() => (pkOpen ? closePicker() : openPicker())}
            >+ Add ship</button>
          )}
        </div>
      </div>

      {/* Picker */}
      <div className="ms2-pk" id="ms2-pk" data-open={pkOpen ? 'true' : 'false'} ref={pkRef}>
        <div>
          <div className="ms2-pki">
            <div className="ms2-pkh">
              <span className="ms2-lbl">
                {pkView === 'mine' ? 'Add a ship from your fleet' : 'Borrow a ship from a friend'}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="ms2-pkb"
                  onClick={() => setPkView(pkView === 'mine' ? 'friend' : 'mine')}
                >{pkView === 'mine' ? 'Borrow ship from a friend ›' : '‹ My fleet'}</button>
                <button
                  type="button"
                  className="ms2-pkx"
                  aria-label="Close ship picker"
                  onClick={closePicker}
                >×</button>
              </div>
            </div>

            {pkView === 'mine' ? (
              <div className="ms2-pkl">
                {pkLoading && <div className="ms2-pke">Scanning fleet…</div>}
                {!pkLoading && !anyAddable && yourShipsForPicker.length > 0 && (
                  <div className="ms2-pke">All of your available ships are already on missions.</div>
                )}
                {!pkLoading && yourShipsForPicker.length === 0 && (
                  <div className="ms2-pke">No ships in your fleet.</div>
                )}
                {!pkLoading && yourShipsForPicker.map(({ ship, right, disabled }, i) => {
                  const rowId = 'r-' + ship._id;
                  const thumb = findThumb(ship, shipThumbs);
                  return (
                    <button
                      key={ship._id}
                      type="button"
                      data-i={i}
                      className={`ms2-pr ${disabled ? 'ms2-off' : ''} ${flashRowId === rowId ? 'ms2-flash' : ''}`}
                      style={{ '--ms2-i': i }}
                      disabled={disabled || busyShipId === ship._id}
                      onClick={() => !disabled && addShip(ship._id, rowId)}
                    >
                      <div className="ms2-th" style={{ width: 46, height: 30 }}>
                        {thumb && <img src={thumb} alt="" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <span className="ms2-nm">{ship.ship_name}</span>
                        <span className="ms2-ty">{formatModel(ship.ship_model || ship.type)}</span>
                      </div>
                      <span className="ms2-go">{right}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              friendList.length === 0 ? (
                <div className="ms2-soon">
                  <b>No friends yet</b>
                  Add friends from the Friends drawer to borrow their ships.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {friendList.map(f => (
                      <button
                        key={f.userId}
                        type="button"
                        onClick={() => { setActiveFriendId(f.userId); loadFriendShips(f.userId); }}
                        className="ms2-pkb"
                        aria-pressed={activeFriendId === f.userId || undefined}
                        style={activeFriendId === f.userId ? { background: 'var(--bg3)', borderColor: 'var(--cyan)', color: 'var(--cyan)' } : undefined}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                  {activeFriendId && (
                    <div className="ms2-pkl">
                      {friendBusy && <div className="ms2-pke">Scanning fleet…</div>}
                      {!friendBusy && (friendShips[activeFriendId] || []).length === 0 && (
                        <div className="ms2-pke">No ships available from this friend.</div>
                      )}
                      {!friendBusy && (friendShips[activeFriendId] || []).map(ship => {
                        const thumb = findThumb(ship, shipThumbs);
                        return (
                          <div key={ship._id} className="ms2-pr">
                            <div className="ms2-th" style={{ width: 46, height: 30 }}>
                              {thumb && <img src={thumb} alt="" />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                              <span className="ms2-nm">{ship.ship_name}</span>
                              <span className="ms2-ty">{formatModel(ship.ship_model || ship.type)}</span>
                            </div>
                            <button
                              className="ms2-pkb"
                              onClick={async () => {
                                try {
                                  await api.post('/ships/access-requests', { ship_id: ship._id, mission_id: missionId });
                                  closePicker();
                                  refreshRequests();
                                } catch {}
                              }}
                            >Request →</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!activeFriendId && <div className="ms2-pke">Pick a friend to see their available ships.</div>}
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div
        className="ms2-tabs"
        role="tablist"
        aria-label="Ships on this mission"
        ref={tabsRef}
        onKeyDown={onTabsKeyDown}
      >
        {tabs.map((t) => {
          const selected = t.id === selectedShipId;
          const { filled, crew, pct } = t.isPending ? { filled: 0, crew: 0, pct: 0 } : shipFill(t.ship);
          const fcls = fillClass(pct);
          const thumb = findThumb(t.ship, shipThumbs);
          const className = [
            'ms2-tab',
            t.isPrimary ? 'ms2-pri' : '',
            t.isPending ? 'ms2-pending' : '',
            enterTabId === t.id ? 'ms2-enter' : '',
            leaveTabId === t.id ? 'ms2-leave' : '',
            fcls,
          ].filter(Boolean).join(' ');
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-tabid={t.id}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              title={`${t.ship?.ship_name || ''}${t.borrowedFrom ? ' · Borrowed from ' + t.borrowedFrom : ''}`}
              className={className}
              onClick={() => onSelectShip?.(t.id)}
            >
              <div className="ms2-t1">
                <div className={`ms2-th ${t.isPrimary ? 'ms2-pri' : ''}`}>
                  {thumb && <img src={thumb} alt="" />}
                </div>
                <div className="ms2-tx">
                  <span className="ms2-nm">{t.ship?.ship_name || '—'}</span>
                  <span className="ms2-ty">{formatModel(t.ship?.ship_model || t.ship?.type)}</span>
                </div>
              </div>
              <div className="ms2-t2">
                {t.isPrimary ? (
                  <span className="ms2-prl">Primary</span>
                ) : t.isPending ? (
                  <span className="ms2-bor">Loan requested</span>
                ) : (
                  <span className="ms2-sm">{filled}/{crew} crew</span>
                )}
                <span className="ms2-pc">{t.isPending ? '—' : pct + '%'}</span>
              </div>
              <span className="ms2-bar">
                <u style={{ width: t.isPending ? 0 : pct + '%' }} />
              </span>
            </button>
          );
        })}
      </div>

      {/* Pending-loan notice bar renders in the content region owned by MissionDetail; we expose it via a child slot. */}
      {selectedPending && (
        <div className="ms2-pend">
          <div>
            <div className="ms2-pendi">
              <span>Waiting for <b>{selectedPending.ownerName}</b> to accept the loan. Crew slots unlock once they do.</span>
              <button type="button" className="ms2-cancel" onClick={() => cancelPending(selectedPending)}>Cancel request</button>
            </div>
          </div>
        </div>
      )}

      {/* Polite live region. */}
      <div aria-live="polite" style={{
        position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
        overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0,
      }}>{liveMsg}</div>
    </div>
  );
}
