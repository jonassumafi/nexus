// Friend-system state. Owns the friends list + pending requests and
// subscribes to the socket events emitted by backend/routes/friends.js
// so state stays live without polling.
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useSocketContext } from '../context/SocketContext';

export function useFriends() {
  const { socket } = useSocketContext();
  const [friends, setFriends]     = useState([]);
  const [received, setReceived]   = useState([]);
  const [sent, setSent]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [lastAccepted, setLastAccepted] = useState(null); // {name, userId, ts}

  const friendsRef = useRef(friends);
  useEffect(() => { friendsRef.current = friends; }, [friends]);

  const fetchAll = useCallback(async () => {
    try {
      const [{ data: list }, { data: reqs }] = await Promise.all([
        api.get('/friends'),
        api.get('/friends/requests'),
      ]);
      setFriends(Array.isArray(list) ? list : []);
      setReceived(reqs?.received || []);
      setSent(reqs?.sent || []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Socket wiring. The server emits in both directions (`friend:accepted`
  // reaches both sides), so every listener triggers a fresh fetch — a few
  // round-trips per event, but keeps shape consistent and avoids bugs
  // around derived counts.
  useEffect(() => {
    if (!socket) return;
    const onReqRecv   = async (data) => {
      await fetchAll();
    };
    const onReqSent   = () => fetchAll();
    const onAccepted  = async (data) => {
      await fetchAll();
      const fromServer = friendsRef.current.find(f => String(f.userId) === String(data?.userId));
      try {
        // Fetch card for banner name if we just got a new friend we didn't know
        if (!fromServer && data?.userId) {
          const { data: card } = await api.get(`/friends/${data.userId}/card`);
          setLastAccepted({ name: card.name, userId: data.userId, ts: Date.now() });
        } else if (fromServer) {
          setLastAccepted({ name: fromServer.name, userId: data.userId, ts: Date.now() });
        }
      } catch {}
    };
    const onDeclined  = () => fetchAll();
    const onCanceled  = () => fetchAll();
    const onRemoved   = () => fetchAll();

    // Live presence — single-friend ping fired on connect / disconnect
    // and a bulk snapshot the server sends to each newcomer so the
    // initial /api/friends fetch doesn't stay stuck on stale "offline"
    // dots when a friend had already been online for a while.
    const onPresence = ({ userId, online }) => {
      setFriends(prev => prev.map(f =>
        String(f.userId) === String(userId)
          ? {
              ...f,
              online: !!online,
              status_line: online
                ? (f.on_mission ? 'On a mission' : 'Online')
                : 'Offline',
            }
          : f
      ));
    };
    const onPresenceBulk = (list) => {
      if (!Array.isArray(list)) return;
      const byId = new Map(list.map(x => [String(x.userId), !!x.online]));
      setFriends(prev => prev.map(f => {
        if (!byId.has(String(f.userId))) return f;
        const online = byId.get(String(f.userId));
        return {
          ...f,
          online,
          status_line: online
            ? (f.on_mission ? 'On a mission' : 'Online')
            : 'Offline',
        };
      }));
    };

    socket.on('friend:request_received', onReqRecv);
    socket.on('friend:request_sent', onReqSent);
    socket.on('friend:accepted', onAccepted);
    socket.on('friend:declined', onDeclined);
    socket.on('friend:canceled', onCanceled);
    socket.on('friend:removed', onRemoved);
    socket.on('friend:presence', onPresence);
    socket.on('friend:presence_bulk', onPresenceBulk);
    return () => {
      socket.off('friend:request_received', onReqRecv);
      socket.off('friend:request_sent', onReqSent);
      socket.off('friend:accepted', onAccepted);
      socket.off('friend:declined', onDeclined);
      socket.off('friend:canceled', onCanceled);
      socket.off('friend:removed', onRemoved);
      socket.off('friend:presence', onPresence);
      socket.off('friend:presence_bulk', onPresenceBulk);
    };
  }, [socket, fetchAll]);

  const sendRequest = useCallback(async (handle) => {
    const { data } = await api.post('/friends/request', { handle });
    await fetchAll();
    return data;
  }, [fetchAll]);
  const accept  = useCallback(async (id) => { await api.post(`/friends/accept/${id}`);  await fetchAll(); }, [fetchAll]);
  const decline = useCallback(async (id) => { await api.post(`/friends/decline/${id}`); await fetchAll(); }, [fetchAll]);
  const cancel  = useCallback(async (id) => { await api.post(`/friends/cancel/${id}`);  await fetchAll(); }, [fetchAll]);
  const remove  = useCallback(async (userId) => { await api.delete(`/friends/${userId}`); await fetchAll(); }, [fetchAll]);

  const friendIdSet = (() => {
    const s = new Set();
    for (const f of friends) s.add(String(f.userId));
    return s;
  })();

  const isFriend = useCallback((userId) => friendIdSet.has(String(userId)), [friends]); // eslint-disable-line

  return {
    friends, received, sent,
    loading,
    sendRequest, accept, decline, cancel, remove,
    refresh: fetchAll,
    isFriend,
    incomingCount: received.length,
    lastAccepted,
    clearLastAccepted: () => setLastAccepted(null),
  };
}
