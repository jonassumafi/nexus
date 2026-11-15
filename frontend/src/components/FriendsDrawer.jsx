// Right-side friends drawer. Three tabs: Friends | Requests | Everyone.
// The top box is now a "Find a player" field with a predictive dropdown
// that queries /api/users/directory. The Send request button keeps its
// legacy behavior (exact-handle send). Friend request flow is untouched —
// Add / Accept call the existing hook (onSend / onAccept), so the green
// accepted-friend banner and socket fan-out from backend/routes/friends.js
// still fire exactly as before.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FriendMarkerIcon from './FriendMarkerIcon';
import api from '../services/api';

const STYLE_ID = 'friends-drawer-styles';
function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
@keyframes fd-in { from { transform:translateX(100%) } to { transform:none } }
.fd{position:fixed;top:0;right:0;bottom:0;width:384px;max-width:100vw;z-index:9000;
  background:var(--bg1);border-left:1px solid var(--rim1);
  color:var(--fg1);font:12px/1.45 Inter,system-ui,sans-serif;display:flex;flex-direction:column;
  box-shadow:-20px 0 40px rgba(0,0,0,.45);
  animation:fd-in 280ms cubic-bezier(.2,.8,.2,1)}
.fd-hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--rim0);background:var(--bg2)}
.fd-hd b{font:700 12px Inter;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)}
.fd-x{margin-left:auto;background:none;border:0;color:var(--fg3);cursor:pointer;width:26px;height:26px;display:grid;place-items:center;font-size:18px}
.fd-x:hover{color:var(--fg0)}
.fd-add{position:relative;padding:10px 14px;border-bottom:1px solid var(--rim0);display:flex;gap:6px}
.fd-add input{flex:1;background:var(--bg0);border:1px solid var(--rim1);color:var(--fg1);padding:7px 10px;font:12px Inter}
.fd-add input.shake{animation:fd-shake 320ms ease-out;border-color:var(--red)}
@keyframes fd-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
.fd-add button{padding:0 12px;background:linear-gradient(180deg,var(--bg3),var(--bg2));border:1px solid var(--rim1);color:var(--cyan);font:700 11px Inter;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.fd-add button:hover{border-color:var(--cyan)}
.fd-msg{padding:4px 14px 10px;color:var(--fg3);font-size:11px}
.fd-msg.err{color:var(--red)}
.fd-tabs{display:flex;border-bottom:1px solid var(--rim0);background:var(--bg0)}
.fd-tab{flex:1;padding:10px;background:none;border:0;color:var(--fg3);font:700 10px Inter;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;border-bottom:2px solid transparent;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.fd-tab:hover{color:var(--fg0)}
.fd-tab[aria-selected=true]{color:var(--cyan);border-bottom-color:var(--cyan)}
.fd-tab .fd-badge{display:inline-block;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--cyan);color:#001418;font:800 10px/16px Inter;text-align:center}
.fd-filter{padding:10px 14px;border-bottom:1px solid var(--rim0)}
.fd-filter input{width:100%;background:var(--bg0);border:1px solid var(--rim0);color:var(--fg1);padding:6px 9px;font:12px Inter}
.fd-body{flex:1;overflow-y:auto;min-height:0}
.fd-group{padding:6px 14px 2px;color:var(--fg3);font:700 10px Inter;letter-spacing:.14em;text-transform:uppercase}
.fd-group.stk{position:sticky;top:0;background:var(--bg1);z-index:2;border-bottom:1px solid var(--rim0);padding:5px 14px}
.fd-row{display:flex;gap:10px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--rim0)}
.fd-row:hover{background:color-mix(in srgb,var(--bg2) 60%,transparent)}
.fd-av{position:relative;width:32px;height:32px;border:1px solid var(--rim1);background:var(--bg0);overflow:hidden;flex:none;padding:0;cursor:pointer;display:grid;place-items:center;color:var(--fg2);font:800 11px Inter}
.fd-av img{width:100%;height:100%;object-fit:cover;display:block}
.fd-dot{position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;border-radius:50%;background:var(--red);border:2px solid var(--bg1)}
.fd-dot.on{background:var(--lime);box-shadow:0 0 6px var(--lime)}
.fd-nm{min-width:0;flex:1}
.fd-nm b{display:block;font:600 12px Inter;color:var(--fg0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fd-nm b mark{background:none;color:var(--acc,var(--cyan));padding:0}
.fd-nm small{display:block;color:var(--fg3);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fd-act{display:flex;gap:6px;align-items:center}
.fd-pm{height:26px;padding:0 11px;background:linear-gradient(180deg,var(--bg3),var(--bg2));border:1px solid var(--rim1);color:var(--cyan);font:700 10px Inter;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.fd-pm:hover{border-color:var(--cyan)}
.fd-pm.primary{color:var(--fg0);border-color:var(--cyan);background:linear-gradient(180deg,color-mix(in srgb,var(--cyan) 38%,var(--bg2)),color-mix(in srgb,var(--cyan) 16%,var(--bg1)))}
.fd-pm.lime{color:#04140b;border-color:var(--lime);background:linear-gradient(180deg,#2fbd7c,#1e9a5e)}
.fd-pm[disabled]{opacity:.5;cursor:default}
.fd-ib{position:relative;width:26px;height:26px;display:grid;place-items:center;border:1px solid var(--rim0);background:var(--bg2);color:var(--fg2);cursor:pointer}
.fd-ib:hover{color:var(--cyan);border-color:var(--cyan)}
.fd-ib[disabled]{opacity:.4;cursor:default}
.fd-ib svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.fd-ib:hover::after,.fd-ib:focus-visible::after{content:attr(data-tip);position:absolute;top:calc(100% + 4px);right:0;white-space:nowrap;background:var(--bg3);border:1px solid var(--rim1);color:var(--fg1);font:600 10px Inter;padding:3px 7px;z-index:50;pointer-events:none}
.fd-kebab{position:relative}
.fd-menu{position:absolute;right:0;top:calc(100% + 4px);background:var(--bg2);border:1px solid var(--rim1);min-width:140px;z-index:20}
.fd-menu button{display:block;width:100%;padding:8px 10px;text-align:left;background:none;border:0;color:var(--fg1);font:600 11px Inter;cursor:pointer}
.fd-menu button:hover{background:var(--bg3);color:var(--red)}
.fd-confirm{display:flex;gap:6px;align-items:center;font-size:11px}
.fd-confirm b{color:var(--red);font-weight:700}
.fd-empty{padding:30px 14px;color:var(--fg3);text-align:center;font-size:12px}
.fd-req{padding:10px 14px;border-bottom:1px solid var(--rim0);display:flex;gap:10px;align-items:center}
.fd-req .fd-nm{flex:1}
.fd-req-btn{padding:4px 10px;border:1px solid var(--rim1);background:linear-gradient(180deg,var(--bg3),var(--bg2));color:var(--cyan);font:700 10px Inter;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.fd-req-btn.primary{background:linear-gradient(180deg,#2fbd7c,#1e9a5e);border-color:#43d88f;color:#04140b}
.fd-req-btn.danger{color:var(--red);border-color:color-mix(in srgb,var(--red) 55%,transparent)}
.fd-stat{font:700 10px Inter;letter-spacing:.08em;text-transform:uppercase;color:var(--fg3);padding:0 8px;height:26px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.fd-stat.pend{color:var(--amber,#FFBB33)}
.fd-stat.fr{color:var(--lime)}
.fd-dd{position:absolute;left:14px;right:14px;top:100%;margin-top:-1px;z-index:40;background:var(--bg2);border:1px solid var(--cyan);box-shadow:0 16px 30px rgba(0,0,0,.7)}
.fd-dd .fd-row{padding:7px 10px}
.fd-dd .hint{padding:6px 12px;font:500 10.5px Inter;color:var(--fg3);border-bottom:1px solid var(--rim0)}
.fd-dd .more{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;font:700 11px Inter;letter-spacing:.08em;color:var(--cyan);text-transform:uppercase;width:100%;background:none;border:0;border-top:1px solid var(--rim0);cursor:pointer}
.fd-dd .more:hover{background:var(--bg3)}
.fd-dd .more span{color:var(--fg3);letter-spacing:0;text-transform:none;font-weight:500}
.fd-sentinel{height:1px}
@media (prefers-reduced-motion:reduce){ .fd{animation:none} .fd-add input.shake{animation:none} }
`;
  document.head.appendChild(s);
}

function BorrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10h13l-3-3" />
      <path d="M20 14H7l3 3" />
    </svg>
  );
}

// Initials for the fallback avatar tile when a user has no portrait.
function initials(name) {
  return String(name || '')
    .split(/[\s_0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

// Render a name with the matched substring tinted in var(--acc). We only
// tint the first occurrence — matches the reference spec and keeps the
// rendering cheap. Falls back to plain text when there's no query.
function HighlightedName({ name, query }) {
  if (!query) return <>{name}</>;
  const lower = name.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) return <>{name}</>;
  const end = idx + query.length;
  return (
    <>
      {name.slice(0, idx)}
      <mark>{name.slice(idx, end)}</mark>
      {name.slice(end)}
    </>
  );
}

const PAGE_SIZE = 50;

export default function FriendsDrawer({
  open, onClose,
  friends, received, sent,
  onSend, onAccept, onDecline, onCancel, onRemove,
  onBorrow, onMessage, onOpenCard,
  returnFocusRef,
}) {
  const [tab, setTab] = useState('friends');
  const [handle, setHandle] = useState('');          // top input doubles as search + send-request handle
  const [err, setErr] = useState(null);
  const [shake, setShake] = useState(false);
  const [filter, setFilter] = useState('');          // friends-tab filter
  const [menuFor, setMenuFor] = useState(null);
  const [confirmFor, setConfirmFor] = useState(null);

  // Everyone-tab state
  const [everyoneFilter, setEveryoneFilter] = useState('');
  const [everyoneRows, setEveryoneRows] = useState([]);
  const [everyoneTotal, setEveryoneTotal] = useState(0);
  const [everyoneMatched, setEveryoneMatched] = useState(0);
  const [everyoneOffset, setEveryoneOffset] = useState(0);
  const [everyoneDone, setEveryoneDone] = useState(false);
  const [everyoneLoading, setEveryoneLoading] = useState(false);

  // Predictive-search dropdown state
  const [ddOpen, setDdOpen] = useState(false);
  const [ddRows, setDdRows] = useState([]);
  const [ddTotal, setDdTotal] = useState(0);
  const [ddQuery, setDdQuery] = useState('');        // the query the dropdown was fetched for

  const addRootRef = useRef(null);
  const addInputRef = useRef(null);
  const bodyRef = useRef(null);
  const sentinelRef = useRef(null);
  const debounceRef = useRef(null);
  const closeBtnRef = useRef(null);

  useEffect(() => { injectStyles(); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (ddOpen) {
          e.stopPropagation();
          setDdOpen(false);
          return;
        }
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, ddOpen]);

  // Outside-click closes the predictive dropdown. Clicks inside the add
  // row (input + Send button + dropdown) are preserved.
  useEffect(() => {
    if (!ddOpen) return;
    const onDown = (e) => {
      if (addRootRef.current && !addRootRef.current.contains(e.target)) {
        setDdOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ddOpen]);

  useEffect(() => {
    if (!open) {
      if (returnFocusRef?.current) returnFocusRef.current.focus();
    }
  }, [open, returnFocusRef]);

  const grouped = useMemo(() => {
    const f = (filter || '').toLowerCase();
    const list = (friends || []).filter(x => !f || x.name.toLowerCase().includes(f) || (x.handle || '').toLowerCase().includes(f));
    return {
      online:  list.filter(x => x.online),
      offline: list.filter(x => !x.online),
    };
  }, [friends, filter]);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 340);
  };

  // ── Directory fetch helpers ───────────────────────────────────────────
  const fetchDirectoryPage = useCallback(async (opts) => {
    const { q = '', offset = 0, limit = PAGE_SIZE } = opts || {};
    const params = { limit, offset };
    if (q) params.q = q;
    const { data } = await api.get('/users/directory', { params });
    return data; // { total, matched, users }
  }, []);

  const loadEveryoneFirstPage = useCallback(async (q) => {
    setEveryoneLoading(true);
    try {
      const data = await fetchDirectoryPage({ q: q || '', offset: 0, limit: PAGE_SIZE });
      setEveryoneRows(data.users || []);
      setEveryoneTotal(data.total || 0);
      setEveryoneMatched(data.matched ?? data.total ?? 0);
      setEveryoneOffset((data.users || []).length);
      setEveryoneDone((data.users || []).length >= (data.matched ?? data.total ?? 0));
    } catch {
      setEveryoneRows([]);
      setEveryoneDone(true);
    } finally {
      setEveryoneLoading(false);
    }
  }, [fetchDirectoryPage]);

  const loadEveryoneNextPage = useCallback(async () => {
    if (everyoneLoading || everyoneDone) return;
    setEveryoneLoading(true);
    try {
      const data = await fetchDirectoryPage({ q: everyoneFilter || '', offset: everyoneOffset, limit: PAGE_SIZE });
      const chunk = data.users || [];
      setEveryoneRows(prev => [...prev, ...chunk]);
      const newOffset = everyoneOffset + chunk.length;
      setEveryoneOffset(newOffset);
      const matchedTotal = data.matched ?? data.total ?? 0;
      setEveryoneTotal(data.total || everyoneTotal);
      setEveryoneMatched(matchedTotal);
      if (chunk.length === 0 || newOffset >= matchedTotal) setEveryoneDone(true);
    } catch {
      setEveryoneDone(true);
    } finally {
      setEveryoneLoading(false);
    }
  }, [everyoneLoading, everyoneDone, everyoneOffset, everyoneFilter, everyoneTotal, fetchDirectoryPage]);

  // Prime the Everyone tab the first time the drawer opens so the tab
  // badge count ("Everyone • N") renders without clicking in.
  useEffect(() => {
    if (!open) return;
    loadEveryoneFirstPage('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced refetch when filter changes on Everyone tab.
  useEffect(() => {
    if (!open || tab !== 'everyone') return;
    const t = setTimeout(() => loadEveryoneFirstPage(everyoneFilter.trim()), 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyoneFilter, tab, open]);

  // IntersectionObserver on a sentinel at the bottom of the Everyone list
  // triggers the next page. Disconnects/reconnects on tab change.
  useEffect(() => {
    if (tab !== 'everyone' || !sentinelRef.current) return;
    const el = sentinelRef.current;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) loadEveryoneNextPage();
    }, { root: bodyRef.current || null, rootMargin: '120px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [tab, everyoneRows.length, everyoneDone, loadEveryoneNextPage]);

  // ── Predictive dropdown ───────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const q = handle.trim();
    if (!q) {
      setDdOpen(false);
      setDdRows([]);
      setDdTotal(0);
      setDdQuery('');
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await fetchDirectoryPage({ q, offset: 0, limit: 3 });
        setDdRows(data.users || []);
        setDdTotal(data.matched ?? 0);
        setDdQuery(q);
        setDdOpen(true);
      } catch {
        setDdRows([]);
        setDdTotal(0);
        setDdQuery(q);
        setDdOpen(true);
      }
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [handle, open, fetchDirectoryPage]);

  // Mutate local rows optimistically on Add / Accept so the row's action
  // reflects the new relation immediately. The authoritative state still
  // comes from useFriends' /friends/requests fetch triggered by onSend /
  // onAccept.
  const bumpRelation = useCallback((userId, next) => {
    setEveryoneRows(prev => prev.map(r => String(r.id) === String(userId) ? { ...r, relation: next } : r));
    setDdRows(prev => prev.map(r => String(r.id) === String(userId) ? { ...r, relation: next } : r));
  }, []);

  const addFromDirectory = useCallback(async (row) => {
    // Reuse the existing /friends/request endpoint via the onSend hook.
    const handleToSend = row.handle || row.name;
    if (!handleToSend) return;
    bumpRelation(row.id, 'pending_out');
    const r = await onSend?.(handleToSend);
    if (!r) return;
    if (r.status === 'auto_accepted') bumpRelation(row.id, 'friend');
    else if (r.status === 'sent' || r.status === 'already_sent') bumpRelation(row.id, 'pending_out');
    else if (r.status === 'already_friend') bumpRelation(row.id, 'friend');
    else if (r.status === 'self' || r.status === 'not_found') {
      bumpRelation(row.id, 'none');
    }
  }, [bumpRelation, onSend]);

  const acceptFromDirectory = useCallback(async (row) => {
    // Received-side acceptance. The Friend row exists already; we need its
    // requestId. Easiest reuse: hit the id-card endpoint which returns it.
    try {
      const { data: card } = await api.get(`/friends/${row.id}/card`);
      if (card?.relationship === 'request_received' && card.requestId) {
        bumpRelation(row.id, 'friend');
        await onAccept?.(card.requestId);
      }
    } catch {}
  }, [bumpRelation, onAccept]);

  const submitSendRequest = async (e) => {
    e?.preventDefault?.();
    const h = handle.trim();
    if (!h) { setErr('Enter a handle.'); triggerShake(); return; }
    setErr(null);
    setDdOpen(false);
    const r = await onSend?.(h);
    if (!r) return;
    switch (r.status) {
      case 'sent':
      case 'auto_accepted':
        setHandle(''); setErr(null); break;
      case 'self':           setErr('That is you.'); triggerShake(); break;
      case 'not_found':      setErr('No pilot found with that handle.'); triggerShake(); break;
      case 'already_friend': setErr(`${h} is already your friend.`); triggerShake(); break;
      case 'already_sent':   setErr(`You already sent ${h} a request.`); triggerShake(); break;
      default:               setErr('Something went wrong.'); triggerShake();
    }
  };

  if (!open) return null;

  const friendsCount = (friends || []).length;
  const requestCount = (received || []).length;

  // Dropdown payload: existing friends are filtered OUT of the client-side
  // display (the server still returns them so we can know).
  const ddVisible = ddRows.filter(r => r.relation !== 'friend');

  return (
    <aside className="fd" role="region" aria-label="Friends">
      <div className="fd-hd">
        <b>Friends</b>
        <button ref={closeBtnRef} className="fd-x" aria-label="Close friends drawer" onClick={onClose}>×</button>
      </div>

      <form ref={addRootRef} className="fd-add" onSubmit={submitSendRequest} autoComplete="off">
        <input
          ref={addInputRef}
          className={shake ? 'shake' : ''}
          placeholder="Find a player by name or handle…"
          value={handle}
          onChange={e => { setHandle(e.target.value); setErr(null); }}
          onFocus={() => { if (handle.trim()) setDdOpen(true); }}
          aria-label="Find a player"
        />
        <button type="submit">Send request</button>
        {ddOpen && (
          <div className="fd-dd" role="listbox" onMouseDown={e => e.preventDefault() /* keep input focused on item click */}>
            <div className="hint">Matches in the player registry</div>
            {ddVisible.length === 0 ? (
              <div className="fd-empty" style={{ padding: '14px' }}>
                No players found. Press “Send request” below for an exact handle.
              </div>
            ) : (
              ddVisible.map(r => (
                <DirectoryRow
                  key={r.id}
                  row={r}
                  query={ddQuery}
                  onAdd={() => addFromDirectory(r)}
                  onAccept={() => acceptFromDirectory(r)}
                />
              ))
            )}
            {ddTotal > 3 && (
              <button
                type="button"
                className="more"
                onClick={() => {
                  const q = handle.trim();
                  setDdOpen(false);
                  setTab('everyone');
                  setEveryoneFilter(q);
                  setHandle('');
                }}
              >
                View all {ddTotal} matches <span>›</span>
              </button>
            )}
          </div>
        )}
      </form>
      {err && <div className="fd-msg err" role="alert">{err}</div>}

      <div className="fd-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'friends'} className="fd-tab" onClick={() => setTab('friends')}>
          Friends <span className="fd-badge" style={{ background: 'var(--bg3)', color: 'var(--fg2)' }}>{Math.min(friendsCount, 99)}</span>
        </button>
        <button role="tab" aria-selected={tab === 'requests'} className="fd-tab" onClick={() => setTab('requests')}>
          Requests{requestCount > 0 && <span className="fd-badge">{requestCount > 9 ? '9+' : requestCount}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'everyone'} className="fd-tab" onClick={() => setTab('everyone')}>
          Everyone <span className="fd-badge" style={{ background: 'var(--bg3)', color: 'var(--fg2)' }}>{everyoneTotal > 999 ? '999+' : everyoneTotal}</span>
        </button>
      </div>

      {tab === 'friends' && (
        <>
          <div className="fd-filter">
            <input placeholder="Filter friends…" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter friends" />
          </div>
          <div className="fd-body">
            {friendsCount === 0 && <div className="fd-empty">No friends yet</div>}
            {friendsCount > 0 && grouped.online.length === 0 && grouped.offline.length === 0 && <div className="fd-empty">No friends match.</div>}

            {grouped.online.length > 0 && <div className="fd-group">Online · {grouped.online.length}</div>}
            {grouped.online.map(f => (
              <FriendRow key={f.userId} f={f}
                menuOpen={menuFor === f.userId}
                onToggleMenu={() => setMenuFor(m => m === f.userId ? null : f.userId)}
                confirming={confirmFor === f.userId}
                onBeginRemove={() => { setConfirmFor(f.userId); setMenuFor(null); }}
                onCancelRemove={() => setConfirmFor(null)}
                onDoRemove={() => { onRemove?.(f.userId); setConfirmFor(null); }}
                onMessage={onMessage}
                onBorrow={onBorrow}
                onOpenCard={onOpenCard}
              />
            ))}

            {grouped.offline.length > 0 && <div className="fd-group">Offline · {grouped.offline.length}</div>}
            {grouped.offline.map(f => (
              <FriendRow key={f.userId} f={f}
                menuOpen={menuFor === f.userId}
                onToggleMenu={() => setMenuFor(m => m === f.userId ? null : f.userId)}
                confirming={confirmFor === f.userId}
                onBeginRemove={() => { setConfirmFor(f.userId); setMenuFor(null); }}
                onCancelRemove={() => setConfirmFor(null)}
                onDoRemove={() => { onRemove?.(f.userId); setConfirmFor(null); }}
                onMessage={onMessage}
                onBorrow={onBorrow}
                onOpenCard={onOpenCard}
              />
            ))}
          </div>
        </>
      )}

      {tab === 'requests' && (
        <div className="fd-body">
          {received.length === 0 && sent.length === 0 && <div className="fd-empty">No pending requests</div>}
          {received.length > 0 && <div className="fd-group">Received · {received.length}</div>}
          {received.map(r => (
            <div key={r.requestId} className="fd-req">
              <button className="fd-av nx-tip" data-tip="Click to open profile" onClick={() => onOpenCard?.(r.userId, r.ref)} aria-label={`Open ${r.name}'s ID card`}>
                {r.avatar ? <img src={r.avatar} alt="" /> : initials(r.name)}
              </button>
              <div className="fd-nm">
                <b>{r.name}</b>
                <small>Wants to be your friend</small>
              </div>
              <div className="fd-act">
                <button className="fd-req-btn primary" onClick={() => onAccept?.(r.requestId)}>Accept</button>
                <button className="fd-req-btn danger"  onClick={() => onDecline?.(r.requestId)}>Decline</button>
              </div>
            </div>
          ))}
          {sent.length > 0 && <div className="fd-group">Sent · {sent.length}</div>}
          {sent.map(r => (
            <div key={r.requestId} className="fd-req">
              <button className="fd-av nx-tip" data-tip="Click to open profile" onClick={() => onOpenCard?.(r.userId)} aria-label={`Open ${r.name}'s ID card`}>
                {r.avatar ? <img src={r.avatar} alt="" /> : initials(r.name)}
              </button>
              <div className="fd-nm">
                <b>{r.name}</b>
                <small>Request sent · waiting</small>
              </div>
              <div className="fd-act">
                <span className="fd-stat pend">Pending</span>
                <button className="fd-req-btn" onClick={() => onCancel?.(r.requestId)}>Cancel</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'everyone' && (
        <>
          <div className="fd-filter">
            <input
              placeholder="Filter players…"
              value={everyoneFilter}
              onChange={e => setEveryoneFilter(e.target.value)}
              aria-label="Filter players"
            />
          </div>
          <div className="fd-body" ref={bodyRef}>
            <EveryoneList
              rows={everyoneRows}
              query={everyoneFilter.trim()}
              onAdd={addFromDirectory}
              onAccept={acceptFromDirectory}
              onOpenCard={onOpenCard}
            />
            {!everyoneDone && (
              <div className="fd-sentinel" ref={sentinelRef} />
            )}
            {everyoneLoading && <div className="fd-empty" style={{ padding: '12px' }}>Loading…</div>}
            {!everyoneLoading && everyoneRows.length === 0 && (
              <div className="fd-empty">No players match.</div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function EveryoneList({ rows, query, onAdd, onAccept, onOpenCard }) {
  // Sticky letter headers when no filter is active. When filtering, we skip
  // them (the list is already short + ranked).
  if (!query) {
    const out = [];
    let lastLetter = '';
    for (const r of rows) {
      const letter = (r.name || '?')[0].toUpperCase();
      if (letter !== lastLetter) {
        lastLetter = letter;
        out.push(<div key={`L${letter}`} className="fd-group stk">{letter}</div>);
      }
      out.push(
        <DirectoryRow
          key={r.id}
          row={r}
          query=""
          onAdd={() => onAdd(r)}
          onAccept={() => onAccept(r)}
          onOpenCard={onOpenCard}
        />
      );
    }
    return <>{out}</>;
  }
  return (
    <>
      {rows.map(r => (
        <DirectoryRow
          key={r.id}
          row={r}
          query={query}
          onAdd={() => onAdd(r)}
          onAccept={() => onAccept(r)}
          onOpenCard={onOpenCard}
        />
      ))}
    </>
  );
}

function DirectoryRow({ row, query, onAdd, onAccept, onOpenCard }) {
  const avRef = useRef(null);
  const sub = `${row.org || '—'} · ${row.online ? 'Online' : 'Offline'}`;
  return (
    <div className="fd-row">
      <button
        className="fd-av"
        ref={avRef}
        onClick={() => onOpenCard?.(row.id, avRef)}
        aria-label={`Open ${row.name}'s ID card`}
      >
        {row.avatar ? <img src={row.avatar} alt="" /> : initials(row.name)}
        <i className={`fd-dot${row.online ? ' on' : ''}`} />
      </button>
      <div className="fd-nm">
        <b><HighlightedName name={row.name} query={query} /></b>
        <small>{sub}</small>
      </div>
      <div className="fd-act">
        {row.relation === 'none' && (
          <button className="fd-pm primary" onClick={onAdd}>+ Add</button>
        )}
        {row.relation === 'pending_out' && (
          <span className="fd-stat pend">Pending</span>
        )}
        {row.relation === 'pending_in' && (
          <button className="fd-pm lime" onClick={onAccept}>Accept</button>
        )}
        {row.relation === 'friend' && (
          <span className="fd-stat fr">✓ Friend</span>
        )}
      </div>
    </div>
  );
}

function FriendRow({ f, menuOpen, onToggleMenu, confirming, onBeginRemove, onCancelRemove, onDoRemove, onMessage, onBorrow, onOpenCard }) {
  const avRef = useRef(null);
  const canBorrow = (f.ships_available ?? 1) > 0; // default true unless we know otherwise
  return (
    <div className="fd-row">
      <button className="fd-av nx-tip" data-tip="Click to open profile" ref={avRef}
        onClick={() => onOpenCard?.(f.userId, avRef)}
        aria-label={`Open ${f.name}'s ID card`}
      >
        {f.avatar ? <img src={f.avatar} alt="" /> : null}
        <i className={`fd-dot${f.online ? ' on' : ''}`} />
      </button>
      <div className="fd-nm">
        <b>{f.name} <FriendMarkerIcon size={14} /></b>
        <small>{f.status_line}</small>
      </div>
      {!confirming ? (
        <div className="fd-act">
          <button className="fd-pm" onClick={() => onMessage?.(f)}>✉ Message</button>
          <button
            className="fd-ib"
            data-tip={canBorrow ? 'Borrow a ship' : 'No ships to borrow'}
            aria-label={canBorrow ? 'Borrow a ship' : 'No ships to borrow'}
            disabled={!canBorrow}
            onClick={() => canBorrow && onBorrow?.(f)}
          ><BorrowIcon /></button>
          <div className="fd-kebab">
            <button className="fd-ib" data-tip="More" aria-label="More options" onClick={onToggleMenu}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>
            </button>
            {menuOpen && (
              <div className="fd-menu" role="menu">
                <button role="menuitem" onClick={onBeginRemove}>Remove friend</button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="fd-confirm">
          <b>Remove?</b>
          <button className="fd-req-btn danger" onClick={onDoRemove}>Remove</button>
          <button className="fd-req-btn" onClick={onCancelRemove}>Keep</button>
        </div>
      )}
    </div>
  );
}
