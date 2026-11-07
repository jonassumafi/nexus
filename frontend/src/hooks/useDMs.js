// Direct-message state. Caches messages per peerId and subscribes to
// `dm:new` so panes update live. Plain text only — no read receipts,
// no attachments.
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useSocketContext } from '../context/SocketContext';
import { playDmReceive } from '../utils/audioFx';

const SEEN_LS_KEY = 'nexus_dm_seen';
function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_LS_KEY) || '{}') || {}; } catch { return {}; }
}
function writeSeen(map) {
  try { localStorage.setItem(SEEN_LS_KEY, JSON.stringify(map)); } catch {}
}

export function useDMs(meId) {
  const { socket } = useSocketContext();
  const [threads, setThreads] = useState([]);
  const [messagesByPeer, setMessagesByPeer] = useState({}); // peerId -> message[]
  const [seenMap, setSeenMap] = useState(() => readSeen());
  const openPeerRef = useRef(null);

  const setOpenPeer = useCallback((peerId) => { openPeerRef.current = peerId ? String(peerId) : null; }, []);

  // Mark everything in a peer's thread as seen up to "now". Called when
  // the DM pane opens on that peer and when the Messages popover is
  // opened (so any threads glanced at count as read).
  const markSeen = useCallback((peerId) => {
    if (!peerId) return;
    setSeenMap(prev => {
      const next = { ...prev, [String(peerId)]: Date.now() };
      writeSeen(next);
      return next;
    });
  }, []);
  const markAllSeen = useCallback(() => {
    setSeenMap(prev => {
      const next = { ...prev };
      const now = Date.now();
      for (const t of threads) next[String(t.peerId)] = now;
      writeSeen(next);
      return next;
    });
  }, [threads]);

  // Unread count — number of threads whose last-message is inbound and
  // newer than the stored seen timestamp for that peer.
  const unreadCount = (() => {
    let n = 0;
    for (const t of threads) {
      const last = t.last;
      if (!last) continue;
      if (String(last.from) === String(meId)) continue;
      const ts = new Date(last.created_at).getTime();
      const seen = seenMap[String(t.peerId)] || 0;
      if (ts > seen) n++;
    }
    return n;
  })();

  const fetchThreads = useCallback(async () => {
    try {
      const { data } = await api.get('/dms/threads');
      setThreads(Array.isArray(data?.threads) ? data.threads : []);
    } catch {}
  }, []);

  const fetchMessages = useCallback(async (peerId) => {
    const key = String(peerId);
    try {
      const { data } = await api.get(`/dms/${key}`);
      setMessagesByPeer(prev => ({ ...prev, [key]: Array.isArray(data?.messages) ? data.messages : [] }));
    } catch {}
  }, []);

  const send = useCallback(async (peerId, body) => {
    const text = String(body || '').trim();
    if (!text) return null;
    const { data } = await api.post(`/dms/${peerId}`, { body: text });
    return data?.message || null;
  }, []);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  // Live updates.
  useEffect(() => {
    if (!socket) return;
    const onNew = (msg) => {
      if (!msg?.from || !msg?.to) return;
      const peerId = String(msg.from) === String(meId) ? String(msg.to) : String(msg.from);
      setMessagesByPeer(prev => {
        const list = prev[peerId] || [];
        if (list.some(m => m.id === msg.id)) return prev;
        return { ...prev, [peerId]: [...list, msg] };
      });
      // Thread list refresh (cheap; keeps ordering + last-message right).
      fetchThreads();
      // Receive cue — only if this was inbound and the pane for this
      // peer isn't currently open. Suppresses noise while chatting.
      if (String(msg.to) === String(meId) && openPeerRef.current !== peerId) {
        playDmReceive();
      }
      // If the pane for this peer IS open, mark seen immediately so the
      // badge doesn't light up for a conversation the user is in.
      if (String(msg.to) === String(meId) && openPeerRef.current === peerId) {
        setSeenMap(prev => {
          const next = { ...prev, [peerId]: Date.now() };
          writeSeen(next);
          return next;
        });
      }
    };
    socket.on('dm:new', onNew);
    return () => { socket.off('dm:new', onNew); };
  }, [socket, meId, fetchThreads]);

  return { threads, messagesByPeer, fetchMessages, send, refresh: fetchThreads, setOpenPeer, unreadCount, markSeen, markAllSeen };
}
