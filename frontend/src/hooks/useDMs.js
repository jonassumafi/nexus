// Direct-message state. Caches messages per peerId and subscribes to
// `dm:new` so panes update live. Plain text only — no read receipts,
// no attachments.
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useSocketContext } from '../context/SocketContext';
import { playDmReceive } from '../utils/audioFx';

export function useDMs(meId) {
  const { socket } = useSocketContext();
  const [threads, setThreads] = useState([]);
  const [messagesByPeer, setMessagesByPeer] = useState({}); // peerId -> message[]
  const openPeerRef = useRef(null);

  const setOpenPeer = useCallback((peerId) => { openPeerRef.current = peerId ? String(peerId) : null; }, []);

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
    };
    socket.on('dm:new', onNew);
    return () => { socket.off('dm:new', onNew); };
  }, [socket, meId, fetchThreads]);

  return { threads, messagesByPeer, fetchMessages, send, refresh: fetchThreads, setOpenPeer };
}
