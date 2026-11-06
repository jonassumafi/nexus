// 1:1 direct message pane — slide-in right-side panel. Plain text,
// no attachments, no read receipts. Sends via useDMs hook.
import { useEffect, useMemo, useRef, useState } from 'react';
import { initialsOf, resolveAvatar } from '../utils/avatar';
import { playDmSend } from '../utils/audioFx';

const STYLE_ID = 'dm-pane-styles';
function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
@keyframes dmp-in { from { transform:translateX(100%) } to { transform:none } }
.dmp{position:fixed;top:0;right:0;bottom:0;width:384px;max-width:100vw;z-index:9100;
  background:var(--bg1);border-left:1px solid var(--rim1);color:var(--fg1);
  font:12px/1.45 Inter,system-ui,sans-serif;display:flex;flex-direction:column;
  box-shadow:-20px 0 40px rgba(0,0,0,.45);
  animation:dmp-in 260ms cubic-bezier(.2,.8,.2,1)}
.dmp-hd{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--rim0);background:var(--bg2)}
.dmp-av{width:32px;height:32px;border:1px solid var(--rim1);background:var(--bg0);overflow:hidden;flex:none;display:grid;place-items:center;font:700 11px Inter;color:var(--cyan)}
.dmp-av img{width:100%;height:100%;object-fit:cover;display:block}
.dmp-nm{min-width:0;flex:1}
.dmp-nm b{display:block;font:700 12px Inter;color:var(--fg0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmp-nm small{display:block;color:var(--fg3);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}
.dmp-x{background:none;border:0;color:var(--fg3);cursor:pointer;width:26px;height:26px;display:grid;place-items:center;font-size:18px}
.dmp-x:hover{color:var(--fg0)}
.dmp-body{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.dmp-empty{margin:auto;color:var(--fg3);text-align:center;font-size:12px}
.dmp-row{display:flex}
.dmp-row.me{justify-content:flex-end}
.dmp-bub{max-width:76%;padding:6px 10px;border:1px solid var(--rim0);background:var(--bg2);color:var(--fg1);
  font:12.5px/1.4 Inter;white-space:pre-wrap;word-wrap:break-word}
.dmp-row.me .dmp-bub{background:color-mix(in srgb,var(--cyan) 18%,var(--bg2));border-color:color-mix(in srgb,var(--cyan) 50%,var(--rim1))}
.dmp-ts{display:block;margin-top:3px;color:var(--fg3);font-size:9.5px;letter-spacing:.06em}
.dmp-date{align-self:center;color:var(--fg3);font:600 10px Inter;letter-spacing:.12em;text-transform:uppercase;margin:6px 0}
.dmp-ft{display:flex;gap:6px;padding:10px 14px;border-top:1px solid var(--rim0);background:var(--bg2)}
.dmp-ft textarea{flex:1;height:36px;max-height:120px;resize:none;background:var(--bg0);border:1px solid var(--rim1);
  color:var(--fg1);padding:8px 10px;font:12.5px Inter;line-height:1.3}
.dmp-ft textarea:focus{outline:1px solid var(--cyan);outline-offset:-1px}
.dmp-ft button{padding:0 14px;background:linear-gradient(180deg,var(--bg3),var(--bg2));border:1px solid var(--rim1);
  color:var(--cyan);font:700 11px Inter;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.dmp-ft button:hover{border-color:var(--cyan)}
.dmp-ft button[disabled]{opacity:.4;cursor:default}
@media (prefers-reduced-motion:reduce){ .dmp{animation:none} }
`;
  document.head.appendChild(s);
}

function fmtTime(d) {
  try {
    return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}
function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
}
function dayLabel(d) {
  const x = new Date(d);
  const now = new Date();
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) -
                           new Date(x.getFullYear(), x.getMonth(),  x.getDate())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return x.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function DMPane({ meId, peer, messages = [], onClose, onSend, onOpen, presenceById = {} }) {
  // Live presence — the `peer` object was captured when the pane was
  // opened, so its online/on_mission flags freeze. We re-derive them
  // from the always-live friends map every render so the dot and label
  // update when a friend comes online while the pane is open.
  const livePresence = presenceById[String(peer?.userId)] || {};
  const isOnline = !!(livePresence.online ?? peer?.online);
  const onMission = !!(livePresence.on_mission ?? peer?.on_mission);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { injectStyles(); }, []);
  useEffect(() => { if (peer) onOpen?.(peer); }, [peer, onOpen]);

  // Load / scroll on open.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    inputRef.current?.focus();
  }, [peer?.userId]);

  // Scroll to bottom when new messages append.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // ESC closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const grouped = useMemo(() => {
    const out = [];
    let lastDay = null;
    for (const m of messages) {
      const d = dayKey(m.created_at);
      if (d !== lastDay) { out.push({ date: m.created_at, _sep: true, id: `d-${d}` }); lastDay = d; }
      out.push(m);
    }
    return out;
  }, [messages]);

  const av = resolveAvatar(peer || {});

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend?.(peer.userId, body);
      playDmSend();
      setText('');
    } catch {}
    setSending(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <div className="dmp" role="dialog" aria-label={`Direct messages with ${peer?.name || 'friend'}`}>
      <div className="dmp-hd">
        <div className="dmp-av">
          {av ? <img src={av} alt="" /> : <span>{initialsOf(peer?.name)}</span>}
        </div>
        <div className="dmp-nm">
          <b>{peer?.name || 'Direct message'}</b>
          <small>
            <i style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              marginRight: 6, verticalAlign: 1,
              background: isOnline ? 'var(--lime)' : 'var(--fg3)',
              boxShadow: isOnline ? '0 0 6px var(--lime)' : 'none',
            }} />
            {isOnline ? (onMission ? 'On a mission' : 'Online') : 'Offline'}
          </small>
        </div>
        <button className="dmp-x" aria-label="Close" onClick={onClose}>×</button>
      </div>

      <div className="dmp-body" ref={bodyRef}>
        {grouped.length === 0 && (
          <div className="dmp-empty">
            No messages yet.<br />Say hello.
          </div>
        )}
        {grouped.map(item => {
          if (item._sep) return <div key={item.id} className="dmp-date">{dayLabel(item.date)}</div>;
          const mine = String(item.from) === String(meId);
          return (
            <div key={item.id} className={`dmp-row ${mine ? 'me' : ''}`}>
              <div className="dmp-bub">
                {item.body}
                <span className="dmp-ts">{fmtTime(item.created_at)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="dmp-ft">
        <textarea
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message…"
          maxLength={2000}
          aria-label="Message body"
        />
        <button onClick={submit} disabled={sending || !text.trim()}>Send</button>
      </div>
    </div>
  );
}
