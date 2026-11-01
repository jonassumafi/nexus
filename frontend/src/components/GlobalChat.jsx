// Global chat — small floating panel anchored under its launcher button.
// Collapsed state is just the button + an unread badge; open state shows
// a Discord-style message list with miniature avatars + names + text.
//
// Unread tracking: localStorage stores the timestamp of the last message
// seen while the panel was open. Any messages newer than that count as
// unread. Opening the panel marks everything as seen.
//
// Props:
//   open           — bool, controlled by parent
//   onOpenChange   — (bool) => void
//   anchorRef      — ref to the launcher button so the panel can position
//                    itself under it

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useSocketContext } from '../context/SocketContext';

const UNREAD_KEY = 'nexus_chat_last_seen_ts';

function readLastSeen() {
  try { return Number(localStorage.getItem(UNREAD_KEY)) || 0; } catch { return 0; }
}
function writeLastSeen(ts) {
  try { localStorage.setItem(UNREAD_KEY, String(ts)); } catch {}
}

// Prefer the operator's uploaded portrait, fall back to Discord's CDN
// avatar (same resolution logic the ID card uses elsewhere).
function avatarFor(m) {
  if (m.avatar_url) return m.avatar_url;
  if (m.discord_id && m.discord_avatar_hash) {
    return `https://cdn.discordapp.com/avatars/${m.discord_id}/${m.discord_avatar_hash}.png?size=64`;
  }
  return null;
}

function initialsFor(name) {
  return String(name || 'OP').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function useChatUnread() {
  const { socket } = useSocketContext();
  const [latestTs, setLatestTs] = useState(readLastSeen());
  const [count, setCount] = useState(0);

  // Prime with current server messages on mount so the badge reflects
  // reality even if the user hasn't received a live socket event yet.
  useEffect(() => {
    api.get('/chat?limit=100').then(({ data }) => {
      const seen = readLastSeen();
      const unread = (data || []).filter(m => new Date(m.timestamp).getTime() > seen).length;
      setCount(unread);
      if (data?.length) setLatestTs(new Date(data[data.length - 1].timestamp).getTime());
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onMsg = (m) => {
      const t = new Date(m.timestamp).getTime();
      setLatestTs(t);
      if (t > readLastSeen()) setCount(c => c + 1);
    };
    socket.on('chat:message', onMsg);
    return () => socket.off('chat:message', onMsg);
  }, [socket]);

  const markSeen = useCallback(() => {
    const t = Math.max(latestTs, Date.now());
    writeLastSeen(t);
    setCount(0);
  }, [latestTs]);

  return { count, markSeen };
}

export default function GlobalChat({ open, onOpenChange, anchorRef, markSeen }) {
  const { socket } = useSocketContext();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 360 });
  const listRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  // Position the panel under the launcher.
  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const PANEL_W = 360;
    // Prefer left-aligned under the button; clamp inside the viewport.
    let left = r.left;
    if (left + PANEL_W > window.innerWidth - 8) left = window.innerWidth - PANEL_W - 8;
    if (left < 8) left = 8;
    setPos({ top: r.bottom + 6, left, width: PANEL_W });
  }, [open, anchorRef]);

  // Load recent messages on open.
  useEffect(() => {
    if (!open) return;
    api.get('/chat?limit=100').then(({ data }) => {
      setMessages(Array.isArray(data) ? data : []);
      requestAnimationFrame(() => {
        const l = listRef.current;
        if (l) l.scrollTop = l.scrollHeight;
      });
    }).catch(() => setMessages([]));
    markSeen?.();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, markSeen]);

  // Live socket push while open.
  useEffect(() => {
    if (!socket) return;
    const onMsg = (m) => {
      setMessages(prev => [...prev, m]);
      requestAnimationFrame(() => {
        const l = listRef.current;
        if (!l) return;
        // Only auto-scroll if the user was already near the bottom.
        const nearBottom = l.scrollHeight - (l.scrollTop + l.clientHeight) < 60;
        if (nearBottom) l.scrollTop = l.scrollHeight;
      });
      // While the panel is open, keep marking seen as new messages arrive.
      if (open) markSeen?.();
    };
    socket.on('chat:message', onMsg);
    return () => socket.off('chat:message', onMsg);
  }, [socket, open, markSeen]);

  // Dismiss on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onOpenChange?.(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onOpenChange, anchorRef]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setErr('');
    try {
      await api.post('/chat', { text });
      setDraft('');
    } catch (e) {
      setErr(e?.response?.data?.error || 'send failed');
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [draft, sending]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(180deg, var(--bz1,#172636), var(--bz2,#0f1b27))',
        border: '1px solid var(--edge, var(--rim0, #1A3A50))',
        borderRadius: 8,
        boxShadow: '0 16px 40px rgba(0,0,0,.7), inset 0 1px 0 rgba(190,224,255,.18)',
        zIndex: 9500,
        fontFamily: 'var(--font)',
        color: 'var(--fg1)',
        overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid var(--rim0)',
        background: 'linear-gradient(180deg, #0A1B2B, #061018)',
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
          color: 'var(--blue)',
        }}>
          GLOBAL CHAT
        </span>
        <div style={{ flex: 1 }} />
        <button
          className="btn"
          onClick={() => onOpenChange?.(false)}
          title="Close"
          style={{ width: 24, height: 22, padding: 0, fontSize: 12 }}
        >
          ✕
        </button>
      </div>

      <div
        ref={listRef}
        style={{
          flex: 1, minHeight: 160, maxHeight: '60vh',
          overflowY: 'auto',
          padding: '8px 8px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}
      >
        {messages.length === 0 ? (
          <div style={{
            fontSize: 11, color: 'var(--fg3)', fontStyle: 'italic',
            textAlign: 'center', padding: '20px 0',
          }}>
            Silence on the net. Be the first to say something.
          </div>
        ) : (
          messages.map(m => <ChatRow key={m._id} msg={m} />)
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 10px',
        borderTop: '1px solid var(--rim0)',
        background: 'linear-gradient(180deg, #061018, #020C14)',
      }}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value.slice(0, 500))}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
          placeholder="Say something…"
          style={{
            flex: 1,
            background: 'var(--bg0)',
            color: 'var(--fg0)',
            border: '1px solid var(--rim0)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12,
            fontFamily: 'var(--font)',
          }}
        />
        <button
          className="btn go"
          onClick={send}
          disabled={sending || !draft.trim()}
          style={{ fontSize: 11, padding: '6px 12px' }}
        >
          Send
        </button>
      </div>
      {err && (
        <div style={{
          padding: '2px 12px 6px',
          fontSize: 10, color: 'var(--red)',
          background: 'linear-gradient(180deg, #061018, #020C14)',
        }}>
          {err}
        </div>
      )}
    </div>
  );
}

function ChatRow({ msg }) {
  const avatar = avatarFor(msg);
  const t = new Date(msg.timestamp);
  const timeLabel = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div style={{
      display: 'flex', gap: 8,
      padding: '4px 6px',
      borderRadius: 4,
    }}>
      {avatar ? (
        <img src={avatar} alt=""
          style={{
            width: 28, height: 28, borderRadius: '50%',
            objectFit: 'cover',
            border: '1px solid var(--rim1)',
            flexShrink: 0,
          }}
        />
      ) : (
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--blue) 55%, var(--bg3)), var(--bg0) 80%)',
          border: '1px solid var(--rim1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: 'var(--fg0)',
          flexShrink: 0,
        }}>
          {initialsFor(msg.citizen_name)}
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, color: 'var(--fg0)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {msg.citizen_name}
          </span>
          <span style={{
            fontSize: 10, color: 'var(--fg3)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {timeLabel}
          </span>
        </div>
        <div style={{
          fontSize: 12.5, color: 'var(--fg1)', lineHeight: 1.45,
          wordWrap: 'break-word', wordBreak: 'break-word',
        }}>
          {msg.text}
        </div>
      </div>
    </div>
  );
}
