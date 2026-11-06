// Relationship-aware ID card popover. Opened by clicking an avatar in
// global chat or in the friends drawer. Flips above the anchor when it
// would overflow the viewport bottom. Updates in place as the server
// pushes friend:* events through the parent.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import api from '../services/api';

const STYLE_ID = 'id-card-popover-styles';
function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
@keyframes idc-in { from { opacity:0; transform:translateY(-4px) scale(.96) } to { opacity:1; transform:none } }
.idc{position:fixed;z-index:9998;width:292px;background:var(--bg1);border:1px solid var(--rim1);
  box-shadow:0 20px 50px rgba(0,0,0,.65);color:var(--fg1);font:12px/1.45 Inter,system-ui,sans-serif;
  animation:idc-in 160ms cubic-bezier(.2,.8,.2,1)}
.idc .idc-hd{display:flex;gap:10px;align-items:center;padding:12px;border-bottom:1px solid var(--rim0);background:var(--bg2)}
.idc .idc-av{width:56px;height:56px;border:1px solid var(--rim1);background:var(--bg0);overflow:hidden;position:relative;flex:none}
.idc .idc-av img{width:100%;height:100%;object-fit:cover}
.idc .idc-dot{position:absolute;right:-3px;bottom:-3px;width:12px;height:12px;border-radius:50%;background:var(--amber);border:2px solid var(--bg1)}
.idc .idc-dot.on{background:var(--lime)}
.idc .idc-nm{min-width:0}
.idc .idc-nm b{display:block;font:700 13px Inter;color:var(--fg0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.idc .idc-nm small{display:block;color:var(--fg3);font-size:11px}
.idc .idc-nm .idc-rank{display:inline-block;margin-top:3px;font:700 9px Inter;letter-spacing:.12em;text-transform:uppercase;
  color:var(--cyan);border:1px solid color-mix(in srgb,var(--cyan) 55%,transparent);padding:1px 5px}
.idc .idc-x{margin-left:auto;background:none;border:0;color:var(--fg3);cursor:pointer;width:22px;height:22px;display:grid;place-items:center}
.idc .idc-x:hover{color:var(--fg0)}
.idc .idc-rows{padding:10px 12px;display:flex;flex-direction:column;gap:5px}
.idc .idc-row{display:flex;justify-content:space-between;gap:10px;color:var(--fg2);font-size:11.5px;align-items:flex-start}
.idc .idc-row>span:first-child{flex:none;white-space:nowrap}
.idc .idc-row b{color:var(--fg1);font-weight:600;text-align:right;min-width:0;word-break:break-word;overflow-wrap:anywhere}
.idc .idc-acts{padding:10px 12px;border-top:1px solid var(--rim0);display:flex;flex-direction:column;gap:8px}
.idc .idc-hint{color:var(--fg3);font-size:11px}
.idc .idc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;
  height:30px;padding:0 12px;border:1px solid var(--rim1);
  background:linear-gradient(180deg,var(--bg3),var(--bg2));
  color:var(--cyan);font:700 11px Inter;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.idc .idc-btn:hover{border-color:var(--cyan)}
.idc .idc-btn[disabled]{opacity:.5;cursor:default}
.idc .idc-btn.primary{background:linear-gradient(180deg,#2fbd7c,#1e9a5e);border-color:#43d88f;color:#04140b}
.idc .idc-btn.danger{color:var(--red);border-color:color-mix(in srgb,var(--red) 55%,transparent)}
.idc .idc-btn.danger:hover{border-color:var(--red)}
.idc .idc-ghost{background:none;border:0;color:var(--fg3);font:600 11px Inter;cursor:pointer;padding:4px}
.idc .idc-ghost:hover{color:var(--fg0)}
.idc .idc-row-actions{display:flex;gap:8px;align-items:center}
.idc .idc-chip{display:inline-flex;align-items:center;gap:6px;color:var(--lime);
  font:700 10px Inter;letter-spacing:.1em;text-transform:uppercase}
.idc .idc-icon{width:32px;height:32px;display:grid;place-items:center;border:1px solid var(--rim1);background:var(--bg2);color:var(--fg2);cursor:pointer}
.idc .idc-icon:hover{color:var(--cyan);border-color:var(--cyan)}
.idc .idc-icon svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
@media (prefers-reduced-motion:reduce){ .idc{animation:none} }
`;
  document.head.appendChild(s);
}

function formatMemberSince(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  } catch { return '—'; }
}

export default function IdCardPopover({ anchorRect, userId, onClose, onBorrow, onMessage, friends, onAction }) {
  const [card, setCard] = useState(null);
  const [pos, setPos] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const panelRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => { injectStyles(); }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await api.get(`/friends/${userId}/card`);
      setCard(data);
    } catch {
      setCard({ error: true });
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Refresh card when the local friend list changes so relationship flips
  // reflect instantly without a manual reload.
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [friends?.length]);

  useLayoutEffect(() => {
    if (!anchorRect || !panelRef.current) return;
    const PAD = 8;
    const W = 292;
    const H = panelRef.current.offsetHeight || 320;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top  = anchorRect.bottom + 6;
    let left = Math.min(Math.max(PAD, anchorRect.left), vw - W - PAD);
    if (top + H > vh - PAD) top = Math.max(PAD, anchorRect.top - H - 6);
    setPos({ top, left });
  }, [anchorRect, card]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  if (!userId) return null;

  const style = { top: pos?.top ?? -9999, left: pos?.left ?? -9999 };

  const doAction = async (fn) => {
    try { await fn(); await load(); onAction?.(); } catch {}
  };

  return (
    <div className="idc" ref={panelRef} role="dialog" aria-label="ID card" style={style}>
      {!card && <div style={{ padding: 18, color: 'var(--fg3)' }}>Loading…</div>}
      {card?.error && (
        <div style={{ padding: 18 }}>
          <div style={{ marginBottom: 8 }}>Couldn't load this pilot.</div>
          <button className="idc-ghost" onClick={onClose}>Close</button>
        </div>
      )}
      {card && !card.error && (
        <>
          <div className="idc-hd">
            <div className="idc-av">
              {card.avatar ? <img src={card.avatar} alt="" /> : null}
              <i className={`idc-dot${card.online ? ' on' : ''}`} />
            </div>
            <div className="idc-nm">
              <b>{card.name}</b>
              <small>@{card.handle || '—'}</small>
              {card.rank && <span className="idc-rank">{card.rank}</span>}
            </div>
            <button className="idc-x" aria-label="Close" onClick={onClose}>×</button>
          </div>

          <div className="idc-rows">
            <div className="idc-row"><span>Status</span>
              <b style={{ color: card.online ? 'var(--lime)' : 'var(--fg3)' }}>
                {card.online ? (card.on_mission ? 'On a mission' : 'Online') : 'Offline'}
              </b></div>
            <div className="idc-row"><span>Organization</span><b>{card.organization || '—'}</b></div>
            <div className="idc-row"><span>Ships</span>
              <b>{card.ships_total > 0 ? `${card.ships_available} available of ${card.ships_total}` : 'None registered'}</b>
            </div>
            <div className="idc-row"><span>Member since</span><b>{formatMemberSince(card.member_since)}</b></div>
          </div>

          <div className="idc-acts">
            {card.relationship === 'self' && <div className="idc-hint">This is you.</div>}

            {card.relationship === 'none' && (
              <>
                <button
                  className="idc-btn"
                  onClick={() => doAction(() => api.post('/friends/request', { handle: card.handle || card.name }))}
                >+ Add friend</button>
                <div className="idc-hint">{card.name} will get a request to accept.</div>
              </>
            )}

            {card.relationship === 'request_sent' && (
              <>
                <button className="idc-btn" disabled>✓ Request sent</button>
                <div className="idc-hint">Waiting for {card.name}.</div>
                <button className="idc-ghost"
                  onClick={() => doAction(() => api.post(`/friends/cancel/${card.requestId}`))}
                >Cancel request</button>
              </>
            )}

            {card.relationship === 'request_received' && (
              <>
                <div className="idc-hint">{card.name} wants to be your friend.</div>
                <div className="idc-row-actions">
                  <button className="idc-btn primary" onClick={() => doAction(() => api.post(`/friends/accept/${card.requestId}`))}>Accept</button>
                  <button className="idc-btn danger"  onClick={() => doAction(() => api.post(`/friends/decline/${card.requestId}`))}>Decline</button>
                </div>
              </>
            )}

            {card.relationship === 'friends' && (
              <>
                <div className="idc-row-actions" style={{ justifyContent: 'space-between' }}>
                  <span className="idc-chip">✓ Friends</span>
                  {!confirmRemove ? (
                    <button className="idc-ghost" onClick={() => setConfirmRemove(true)}>Remove</button>
                  ) : (
                    <span className="idc-row-actions">
                      <button className="idc-btn danger" onClick={() => doAction(() => api.delete(`/friends/${card.id}`))}>Remove</button>
                      <button className="idc-ghost" onClick={() => setConfirmRemove(false)}>Keep</button>
                    </span>
                  )}
                </div>
                <div className="idc-row-actions">
                  <button className="idc-btn primary" style={{ flex: 1 }}
                    onClick={() => { onMessage?.(card); }}>✉ Message</button>
                  <button
                    className="idc-icon"
                    aria-label="Borrow a ship"
                    title={card.ships_available > 0 ? 'Borrow a ship' : 'No ships to borrow'}
                    disabled={card.ships_available === 0}
                    style={card.ships_available === 0 ? { opacity: .4, cursor: 'default' } : undefined}
                    onClick={() => { if (card.ships_available > 0) onBorrow?.(card); }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 10h13l-3-3" />
                      <path d="M20 14H7l3 3" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
