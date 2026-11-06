// Right-side friends drawer: Add-by-handle, tabs (Friends | Requests),
// filter field, rows with Message + Borrow + kebab (Remove only).
// Overlays — does not push layout.
import { useEffect, useMemo, useRef, useState } from 'react';
import FriendMarkerIcon from './FriendMarkerIcon';

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
.fd-add{padding:10px 14px;border-bottom:1px solid var(--rim0);display:flex;gap:6px}
.fd-add input{flex:1;background:var(--bg0);border:1px solid var(--rim1);color:var(--fg1);padding:7px 10px;font:12px Inter}
.fd-add input.shake{animation:fd-shake 320ms ease-out;border-color:var(--red)}
@keyframes fd-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
.fd-add button{padding:0 12px;background:linear-gradient(180deg,var(--bg3),var(--bg2));border:1px solid var(--rim1);color:var(--cyan);font:700 11px Inter;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.fd-add button:hover{border-color:var(--cyan)}
.fd-msg{padding:4px 14px 10px;color:var(--fg3);font-size:11px}
.fd-msg.err{color:var(--red)}
.fd-tabs{display:flex;border-bottom:1px solid var(--rim0);background:var(--bg0)}
.fd-tab{flex:1;padding:10px;background:none;border:0;color:var(--fg3);font:700 10px Inter;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;border-bottom:2px solid transparent}
.fd-tab:hover{color:var(--fg0)}
.fd-tab[aria-selected=true]{color:var(--cyan);border-bottom-color:var(--cyan)}
.fd-tab .fd-badge{display:inline-block;margin-left:5px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--cyan);color:#001418;font:800 10px/16px Inter;text-align:center}
.fd-filter{padding:10px 14px;border-bottom:1px solid var(--rim0)}
.fd-filter input{width:100%;background:var(--bg0);border:1px solid var(--rim0);color:var(--fg1);padding:6px 9px;font:12px Inter}
.fd-body{flex:1;overflow-y:auto}
.fd-group{padding:6px 14px 2px;color:var(--fg3);font:700 10px Inter;letter-spacing:.14em;text-transform:uppercase}
.fd-row{display:flex;gap:10px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--rim0)}
.fd-row:hover{background:color-mix(in srgb,var(--bg2) 60%,transparent)}
.fd-av{position:relative;width:32px;height:32px;border:1px solid var(--rim1);background:var(--bg0);overflow:hidden;flex:none;padding:0;cursor:pointer}
.fd-av img{width:100%;height:100%;object-fit:cover;display:block}
.fd-dot{position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;border-radius:50%;background:var(--amber);border:2px solid var(--bg1)}
.fd-dot.on{background:var(--lime)}
.fd-nm{min-width:0;flex:1}
.fd-nm b{display:block;font:600 12px Inter;color:var(--fg0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fd-nm small{display:block;color:var(--fg3);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fd-act{display:flex;gap:6px;align-items:center}
.fd-pm{height:26px;padding:0 11px;background:linear-gradient(180deg,var(--bg3),var(--bg2));border:1px solid var(--rim1);color:var(--cyan);font:700 10px Inter;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.fd-pm:hover{border-color:var(--cyan)}
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

export default function FriendsDrawer({
  open, onClose,
  friends, received, sent,
  onSend, onAccept, onDecline, onCancel, onRemove,
  onBorrow, onMessage, onOpenCard,
  returnFocusRef,
}) {
  const [tab, setTab] = useState('friends');
  const [handle, setHandle] = useState('');
  const [err, setErr] = useState(null);
  const [shake, setShake] = useState(false);
  const [filter, setFilter] = useState('');
  const [menuFor, setMenuFor] = useState(null);
  const [confirmFor, setConfirmFor] = useState(null);
  const inputRef = useRef(null);
  const addRef   = useRef(null);

  useEffect(() => { injectStyles(); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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

  const submitAdd = async (e) => {
    e?.preventDefault?.();
    const h = handle.trim();
    if (!h) { setErr('Enter a handle.'); triggerShake(); return; }
    setErr(null);
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

  return (
    <aside className="fd" role="region" aria-label="Friends">
      <div className="fd-hd">
        <b>Friends</b>
        <button ref={inputRef} className="fd-x" aria-label="Close friends drawer" onClick={onClose}>×</button>
      </div>

      <form className="fd-add" onSubmit={submitAdd}>
        <input
          ref={addRef}
          className={shake ? 'shake' : ''}
          placeholder="Add by handle…"
          value={handle}
          onChange={e => { setHandle(e.target.value); setErr(null); }}
          aria-label="Friend handle"
        />
        <button type="submit">Send request</button>
      </form>
      {err && <div className="fd-msg err" role="alert">{err}</div>}

      <div className="fd-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'friends'} className="fd-tab" onClick={() => setTab('friends')}>
          Friends <span className="fd-badge" style={{ background: 'var(--bg3)', color: 'var(--fg2)' }}>{Math.min(friendsCount, 99)}</span>
        </button>
        <button role="tab" aria-selected={tab === 'requests'} className="fd-tab" onClick={() => setTab('requests')}>
          Requests{requestCount > 0 && <span className="fd-badge">{requestCount > 9 ? '9+' : requestCount}</span>}
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
              <button className="fd-av" onClick={() => onOpenCard?.(r.userId, r.ref)} aria-label={`Open ${r.name}'s ID card`}>
                {r.avatar ? <img src={r.avatar} alt="" /> : null}
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
              <button className="fd-av" onClick={() => onOpenCard?.(r.userId)} aria-label={`Open ${r.name}'s ID card`}>
                {r.avatar ? <img src={r.avatar} alt="" /> : null}
              </button>
              <div className="fd-nm">
                <b>{r.name}</b>
                <small>Request sent · waiting</small>
              </div>
              <div className="fd-act">
                <button className="fd-req-btn" onClick={() => onCancel?.(r.requestId)}>Cancel</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function FriendRow({ f, menuOpen, onToggleMenu, confirming, onBeginRemove, onCancelRemove, onDoRemove, onMessage, onBorrow, onOpenCard }) {
  const avRef = useRef(null);
  const canBorrow = (f.ships_available ?? 1) > 0; // default true unless we know otherwise
  return (
    <div className="fd-row">
      <button className="fd-av" ref={avRef}
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
