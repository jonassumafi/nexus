// Thread list anchored under the Banner's messages icon. Click a row
// to open the DM pane for that peer.
import { useEffect } from 'react';
import { AnchoredPopover } from './Banner';
import { initialsOf, resolveAvatar } from '../utils/avatar';

const STYLE_ID = 'messages-popover-styles';
function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.nxt-list{max-height:380px;overflow-y:auto;margin:-4px 0}
.nxt-row{display:flex;gap:10px;align-items:center;padding:8px 12px;cursor:pointer;
  border-bottom:1px solid var(--rim0);background:none;border-left:0;border-right:0;border-top:0;
  width:100%;text-align:left;color:var(--fg1)}
.nxt-row:hover{background:color-mix(in srgb,var(--bg3) 60%,transparent)}
.nxt-row:last-child{border-bottom:0}
.nxt-av{width:30px;height:30px;border:1px solid var(--rim1);background:var(--bg0);overflow:hidden;flex:none;
  display:grid;place-items:center;font:700 10px Inter;color:var(--cyan)}
.nxt-av img{width:100%;height:100%;object-fit:cover;display:block}
.nxt-main{min-width:0;flex:1}
.nxt-main b{display:block;font:600 12px Inter;color:var(--fg0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nxt-main small{display:block;color:var(--fg3);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nxt-when{color:var(--fg3);font:600 10px Inter;letter-spacing:.04em;white-space:nowrap;flex:none}
.nxt-empty{padding:28px 14px;color:var(--fg3);text-align:center;font-size:12px}
`;
  document.head.appendChild(s);
}

function fmtWhen(d) {
  const t = new Date(d);
  const now = new Date();
  const diffMs = now - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return t.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function MessagesPopover({ anchorRef, threads = [], meId, onClose, onPick }) {
  useEffect(() => { injectStyles(); }, []);
  return (
    <AnchoredPopover anchorRef={anchorRef} width={320} onClose={onClose} label="Messages">
      <h4>Messages</h4>
      <div className="nxp-body" style={{ padding: 0 }}>
        {threads.length === 0 ? (
          <div className="nxt-empty">No conversations yet.<br />Open a friend's card to start one.</div>
        ) : (
          <div className="nxt-list">
            {threads.map(t => {
              const av = resolveAvatar({ avatar: t.avatar, citizen_name: t.name });
              const mine = String(t.last?.from) === String(meId);
              return (
                <button
                  key={t.peerId}
                  className="nxt-row"
                  onClick={() => { onClose?.(); onPick?.(t); }}
                >
                  <span className="nxt-av">
                    {av ? <img src={av} alt="" /> : <span>{initialsOf(t.name)}</span>}
                  </span>
                  <span className="nxt-main">
                    <b>{t.name}</b>
                    <small>{mine ? 'You: ' : ''}{t.last?.body || ''}</small>
                  </span>
                  <span className="nxt-when">{t.last?.created_at ? fmtWhen(t.last.created_at) : ''}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </AnchoredPopover>
  );
}
