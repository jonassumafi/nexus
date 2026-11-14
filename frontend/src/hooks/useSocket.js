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

    // Clean exit path: on Electron's cleanup-before-quit broadcast,
    // drop the socket immediately so friends see the disconnect
    // without waiting for the ping-timeout fallback.
    const onBeforeQuit = () => {
      try { socket.disconnect(); } catch {}
    };
    window.addEventListener('nexus:before-quit', onBeforeQuit);

    return () => {
      window.removeEventListener('nexus:before-quit', onBeforeQuit);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [token]);

  return { socket: socketRef.current, connected };
}
