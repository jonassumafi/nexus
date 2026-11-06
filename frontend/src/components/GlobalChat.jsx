// Global chat panel — resizable, draggable, opacity-adjustable, and
// detachable to a frameless always-on-top-able Electron window via
// electronAPI.chatPopout.
//
// Modes:
//   "popover"  — floats anchored under its launcher button (Dashboard).
//                Users can drag its header to reposition and drag the
//                bottom-right corner to resize.
//   "popout"   — fills the entire BrowserWindow (standalone page at
//                /chat-popout). Header gets window controls that talk
//                to the popout BrowserWindow via IPC.
//
// Discoverability: the detach button in the popover header has a clear
// ↗ icon + tooltip + visible label the first time it's shown. First-
// opener gets a brief "💡 Tip" hint under the header on first use.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useSocketContext } from '../context/SocketContext';
import { playKeystroke, preloadKeystroke } from '../utils/keystrokeSfx';
import FriendMarkerIcon from './FriendMarkerIcon';

const UNREAD_KEY  = 'nexus_chat_last_seen_ts';
const RECT_KEY    = 'nexus_chat_popover_rect';
const OPACITY_KEY = 'nexus_chat_opacity';
const SEEN_DETACH_KEY = 'nexus_chat_seen_detach_hint';

const MIN_W = 300, MIN_H = 240;
const DEFAULT_W = 380, DEFAULT_H = 460;

function readRect() {
  try { return JSON.parse(localStorage.getItem(RECT_KEY) || 'null'); } catch { return null; }
}
function writeRect(r) {
  try { localStorage.setItem(RECT_KEY, JSON.stringify(r)); } catch {}
}
function readOpacity() {
  try { const v = Number(localStorage.getItem(OPACITY_KEY)); return v >= 0.15 && v <= 1 ? v : 1; } catch { return 1; }
}
function writeOpacity(v) {
  try { localStorage.setItem(OPACITY_KEY, String(v)); } catch {}
}

function readLastSeen()  { try { return Number(localStorage.getItem(UNREAD_KEY)) || 0; } catch { return 0; } }
function writeLastSeen(ts) { try { localStorage.setItem(UNREAD_KEY, String(ts)); } catch {} }

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

export default function GlobalChat({ open, onOpenChange, anchorRef, markSeen, mode = 'popover', friendIds, onAvatarClick }) {
  const { socket } = useSocketContext();
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;

  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [opacity, setOpacity] = useState(readOpacity);
  const [opacityPanelOpen, setOpacityPanelOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [showDetachHint, setShowDetachHint] = useState(false);
  const [rect, setRect] = useState(() => readRect() || { width: DEFAULT_W, height: DEFAULT_H });

  const listRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  const isPopout = mode === 'popout';

  // Position the popover under the launcher on first open. Subsequent
  // positions come from the user's drag + localStorage. In popout mode
  // the panel fills the window.
  useLayoutEffect(() => {
    if (isPopout || !open || !anchorRef?.current) return;
    const stored = readRect();
    if (stored && Number.isFinite(stored.left) && Number.isFinite(stored.top)) {
      setRect(stored);
      return;
    }
    const r = anchorRef.current.getBoundingClientRect();
    let left = r.left;
    const w = rect.width ?? DEFAULT_W;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    setRect(curr => ({ ...curr, top: r.bottom + 6, left }));
  }, [open, isPopout, anchorRef]);

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
    // Pre-decode the typing sample so the first keystroke isn't delayed
    // by the fetch+decode. Safe no-op if already loaded.
    preloadKeystroke();
    // First-time detach hint (popover mode only).
    if (!isPopout && electron) {
      try {
        if (!localStorage.getItem(SEEN_DETACH_KEY)) {
          setShowDetachHint(true);
          localStorage.setItem(SEEN_DETACH_KEY, '1');
          setTimeout(() => setShowDetachHint(false), 7000);
        }
      } catch {}
    }
  }, [open, markSeen, isPopout, electron]);

  // Live socket push while open.
  useEffect(() => {
    if (!socket) return;
    const onMsg = (m) => {
      setMessages(prev => [...prev, m]);
      requestAnimationFrame(() => {
        const l = listRef.current;
        if (!l) return;
        const nearBottom = l.scrollHeight - (l.scrollTop + l.clientHeight) < 60;
        if (nearBottom) l.scrollTop = l.scrollHeight;
      });
      if (open) markSeen?.();
    };
    socket.on('chat:message', onMsg);
    return () => socket.off('chat:message', onMsg);
  }, [socket, open, markSeen]);

  // Outside-click close — popover mode only.
  useEffect(() => {
    if (!open || isPopout) return;
    const onDoc = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (anchorRef?.current?.contains(e.target)) return;
      onOpenChange?.(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onOpenChange, anchorRef, isPopout]);

  // Apply opacity. In popover mode, apply via CSS; in popout, call
  // Electron so the whole BrowserWindow becomes transparent (which is
  // what the user needs when it's overlaying Star Citizen).
  useEffect(() => {
    writeOpacity(opacity);
    if (isPopout && electron?.chatPopout?.setOpacity) {
      electron.chatPopout.setOpacity(opacity).catch(() => {});
    }
  }, [opacity, isPopout, electron]);

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

  // ── Drag to move (popover only) ───────────────────────────────────
  const onHeaderMouseDown = (e) => {
    if (isPopout) return;
    if (e.target.closest('button, input, [data-nexus-no-drag]')) return;
    const startX = e.clientX, startY = e.clientY;
    const startLeft = rect.left ?? 0, startTop = rect.top ?? 0;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const nextLeft = Math.max(0, Math.min(window.innerWidth - 40, startLeft + dx));
      const nextTop  = Math.max(0, Math.min(window.innerHeight - 40, startTop + dy));
      setRect(curr => ({ ...curr, left: nextLeft, top: nextTop }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setRect(curr => { writeRect(curr); return curr; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  };

  // ── Resize handles (popover only) ─────────────────────────────────
  const startResize = (edgeX, edgeY) => (e) => {
    if (isPopout) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const start = { ...rect };
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let { left, top, width, height } = start;
      if (edgeX === 1)  width = Math.max(MIN_W, start.width + dx);
      if (edgeX === -1) { width = Math.max(MIN_W, start.width - dx); left = start.left + (start.width - width); }
      if (edgeY === 1)  height = Math.max(MIN_H, start.height + dy);
      if (edgeY === -1) { height = Math.max(MIN_H, start.height - dy); top = start.top + (start.height - height); }
      setRect({ left, top, width, height });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setRect(curr => { writeRect(curr); return curr; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── Detach to Electron popout window ──────────────────────────────
  const detach = async () => {
    if (!electron?.chatPopout?.open) return;
    await electron.chatPopout.open();
    try { await electron.chatPopout.setOpacity(opacity); } catch {}
    // Hide the in-dashboard popover now that the floating window owns the chat.
    onOpenChange?.(false);
  };

  // ── Pin — only meaningful in popout mode (the whole window pins).
  const togglePin = async () => {
    if (!electron?.chatPopout?.togglePin) return;
    const next = await electron.chatPopout.togglePin();
    setPinned(!!next);
  };

  if (!open && !isPopout) return null;

  // Panel positioning / sizing differ between modes.
  const panelStyle = isPopout
    ? {
        position: 'fixed', inset: 0,
        background: 'linear-gradient(180deg, var(--bz1,#172636), var(--bz2,#0f1b27))',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'var(--font)',
        color: 'var(--fg1)',
      }
    : {
        position: 'fixed',
        top: rect.top ?? 100,
        left: rect.left ?? 100,
        width: rect.width ?? DEFAULT_W,
        height: rect.height ?? DEFAULT_H,
        display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(180deg, var(--bz1,#172636), var(--bz2,#0f1b27))',
        border: '1px solid var(--edge, var(--rim0, #1A3A50))',
        borderRadius: 8,
        boxShadow: '0 16px 40px rgba(0,0,0,.7), inset 0 1px 0 rgba(190,224,255,.18)',
        zIndex: 9500,
        fontFamily: 'var(--font)',
        color: 'var(--fg1)',
        overflow: 'hidden',
        opacity,
      };

  return (
    <div ref={panelRef} style={panelStyle}>
      {/* Header strip — drag region in popover; window chrome in popout */}
      <div
        onMouseDown={onHeaderMouseDown}
        style={{
          display: 'flex', alignItems: 'center',
          padding: '7px 10px',
          borderBottom: '1px solid var(--rim0)',
          background: 'linear-gradient(180deg, #0A1B2B, #061018)',
          cursor: isPopout ? 'default' : 'move',
          userSelect: 'none',
          WebkitAppRegion: isPopout ? 'drag' : undefined,
        }}
      >
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
          color: 'var(--blue)',
        }}>
          GLOBAL CHAT
        </span>
        <div style={{ flex: 1 }} />

        <HeaderBtn
          onClick={() => setOpacityPanelOpen(o => !o)}
          title={`Opacity: ${Math.round(opacity * 100)}%`}
        >
          🔆
        </HeaderBtn>

        {isPopout && electron && (
          <HeaderBtn
            onClick={togglePin}
            title={pinned ? 'Unpin (window will no longer stay on top)' : 'Pin on top (stays over Star Citizen)'}
            style={pinned ? { color: 'var(--cyan)' } : undefined}
          >
            ⌖
          </HeaderBtn>
        )}

        {!isPopout && electron && (
          <HeaderBtn
            onClick={detach}
            title="Detach as floating window (pinnable, over-game overlay)"
            style={{ color: 'var(--cyan)' }}
          >
            ↗
          </HeaderBtn>
        )}

        {isPopout ? (
          <HeaderBtn
            onClick={() => electron?.chatPopout?.close?.()}
            title="Close"
            style={{ color: 'var(--red)' }}
          >
            ✕
          </HeaderBtn>
        ) : (
          <HeaderBtn
            onClick={() => onOpenChange?.(false)}
            title="Close"
          >
            ✕
          </HeaderBtn>
        )}
      </div>

      {opacityPanelOpen && (
        <div data-nexus-no-drag style={{
          padding: '7px 10px',
          borderBottom: '1px solid var(--rim0)',
          background: 'rgba(10,27,43,.6)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 10, color: 'var(--fg3)', letterSpacing: '0.1em' }}>OPACITY</span>
          <input
            type="range"
            min={15} max={100} step={5}
            value={Math.round(opacity * 100)}
            onChange={e => setOpacity(Number(e.target.value) / 100)}
            style={{ flex: 1, accentColor: 'var(--cyan)' }}
          />
          <span style={{ fontSize: 10, color: 'var(--fg2)', minWidth: 30, textAlign: 'right' }}>
            {Math.round(opacity * 100)}%
          </span>
        </div>
      )}

      {showDetachHint && !isPopout && (
        <div style={{
          padding: '6px 10px',
          background: 'color-mix(in srgb, var(--cyan) 10%, transparent)',
          borderBottom: '1px solid color-mix(in srgb, var(--cyan) 30%, transparent)',
          fontSize: 10, color: 'var(--cyan)',
          letterSpacing: '0.04em',
        }}>
          💡 Tip — click ↗ to detach this chat into its own floating window.
          Great for leaving it visible while you're in Star Citizen.
        </div>
      )}

      <div
        ref={listRef}
        className="nexus-chat-list"
        style={{
          flex: 1, minHeight: 160,
          overflowY: 'auto',
          padding: '8px 8px',
          display: 'flex', flexDirection: 'column', gap: 6,
          // Enable container queries so children (ChatRow) can scale
          // their font size with the chat column width.
          containerType: 'inline-size',
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
          messages.map(m => <ChatRow key={m._id} msg={m} friendIds={friendIds} onAvatarClick={onAvatarClick} />)
        )}
      </div>

      <div data-nexus-no-drag style={{
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
          onKeyDown={e => {
            if (e.key === 'Enter') { send(); return; }
            // Mechanical-keyboard SFX — only for keys that actually
            // modify the field. Skip modifiers, Escape, arrow keys,
            // Tab, etc.
            if (e.key === 'Backspace' || e.key === 'Delete' || e.key === ' ' || e.key.length === 1) {
              playKeystroke();
            }
          }}
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
            WebkitAppRegion: 'no-drag',
          }}
        />
        <button
          className="btn go"
          onClick={send}
          disabled={sending || !draft.trim()}
          style={{ fontSize: 11, padding: '6px 12px', WebkitAppRegion: 'no-drag' }}
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

      {/* Resize handles — popover only. Visual affordance in the
          bottom-right corner, and invisible hit zones on every edge
          and corner. */}
      {!isPopout && (
        <>
          <ResizeEdge pos="t"  onMouseDown={startResize(0, -1)} />
          <ResizeEdge pos="b"  onMouseDown={startResize(0,  1)} />
          <ResizeEdge pos="l"  onMouseDown={startResize(-1, 0)} />
          <ResizeEdge pos="r"  onMouseDown={startResize( 1, 0)} />
          <ResizeEdge pos="tl" onMouseDown={startResize(-1,-1)} />
          <ResizeEdge pos="tr" onMouseDown={startResize( 1,-1)} />
          <ResizeEdge pos="bl" onMouseDown={startResize(-1, 1)} />
          <ResizeEdge pos="br" onMouseDown={startResize( 1, 1)} />
          <div style={{
            position: 'absolute',
            right: 3, bottom: 3, width: 10, height: 10,
            borderRight: '2px solid rgba(102,170,221,.45)',
            borderBottom: '2px solid rgba(102,170,221,.45)',
            pointerEvents: 'none',
          }} />
        </>
      )}
    </div>
  );
}

function HeaderBtn({ children, onClick, title, style }) {
  return (
    <button
      data-nexus-no-drag
      className="nexus-no-drag"
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 24, height: 22,
        padding: 0, fontSize: 12,
        marginLeft: 2,
        background: 'transparent',
        border: '1px solid var(--rim0)',
        borderRadius: 3,
        color: 'var(--fg1)',
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        WebkitAppRegion: 'no-drag',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function ResizeEdge({ pos, onMouseDown }) {
  const base = { position: 'absolute', zIndex: 10 };
  const G = 6; // grip thickness
  const styles = {
    t:  { ...base, top: 0, left: G, right: G, height: G, cursor: 'ns-resize' },
    b:  { ...base, bottom: 0, left: G, right: G, height: G, cursor: 'ns-resize' },
    l:  { ...base, left: 0, top: G, bottom: G, width: G, cursor: 'ew-resize' },
    r:  { ...base, right: 0, top: G, bottom: G, width: G, cursor: 'ew-resize' },
    tl: { ...base, top: 0, left: 0, width: G, height: G, cursor: 'nwse-resize' },
    tr: { ...base, top: 0, right: 0, width: G, height: G, cursor: 'nesw-resize' },
    bl: { ...base, bottom: 0, left: 0, width: G, height: G, cursor: 'nesw-resize' },
    br: { ...base, bottom: 0, right: 0, width: G, height: G, cursor: 'nwse-resize' },
  };
  return <div style={styles[pos]} onMouseDown={onMouseDown} />;
}

function ChatRow({ msg, friendIds, onAvatarClick }) {
  const avatar = avatarFor(msg);
  const avRef = useRef(null);
  const isFriend = !!(friendIds && (friendIds.has?.(String(msg.user_id)) || friendIds.has?.(String(msg.author_id))));
  const clickable = !!onAvatarClick && (msg.user_id || msg.author_id);
  const handleAvatar = () => {
    if (!clickable) return;
    onAvatarClick?.(String(msg.user_id || msg.author_id), avRef);
  };
  const t = new Date(msg.timestamp);
  const timeLabel = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div style={{
      display: 'flex', gap: 8,
      padding: '4px 6px',
      borderRadius: 4,
    }}>
      <button
        ref={avRef}
        onClick={handleAvatar}
        disabled={!clickable}
        aria-label={clickable ? `Open ${msg.citizen_name}'s ID card` : msg.citizen_name}
        style={{
          padding: 0, border: 0, background: 'none',
          cursor: clickable ? 'pointer' : 'default',
          flexShrink: 0,
        }}
      >
        {avatar ? (
          <img src={avatar} alt=""
            style={{
              width: 28, height: 28, borderRadius: '50%',
              objectFit: 'cover',
              border: '1px solid var(--rim1)',
              flexShrink: 0,
              display: 'block',
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
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            // Shrunk from 12 → ~10, with container-width scaling.
            // Floor 8.5px (narrow column) → up to 10.5px (wide).
            fontSize: 'clamp(8.5px, 3.8cqi, 10.5px)',
            fontWeight: 700, color: 'var(--fg0)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {msg.citizen_name}
          </span>
          {isFriend && <FriendMarkerIcon size={14} />}
          <span style={{
            fontSize: 'clamp(7.5px, 3.2cqi, 9px)',
            color: 'var(--fg3)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {timeLabel}
          </span>
        </div>
        <div style={{
          // Container-query sized body text: scales with chat column.
          // Floor 9px (very narrow) up to 11.5px (wide).
          fontSize: 'clamp(9px, 4.2cqi, 11.5px)',
          color: 'var(--fg1)', lineHeight: 1.45,
          wordWrap: 'break-word', wordBreak: 'break-word',
        }}>
          {msg.text}
        </div>
      </div>
    </div>
  );
}
