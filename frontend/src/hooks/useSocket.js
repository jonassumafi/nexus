import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

export function useSocket(token) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!token) return;

    const socket = io('/', {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [token]);

  return { socket: socketRef.current, connected };
}
