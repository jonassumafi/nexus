// Live online-player count. Subscribes to the `presence:online_count`
// socket event broadcast by backend/services/socketManager.js on every
// connect/disconnect, and renders a bright-accent circular indicator
// plus the number of currently connected operators.
//
// Theming — the dot and text both pull from the current theme's
// --cyan accent (set per-theme in global.css), so switching themes
// retints this automatically (violet skin → violet dot, carbon →
// pink, etc.).

import { useEffect, useState } from 'react';
import { useSocketContext } from '../context/SocketContext';

export default function OnlineCount() {
  const { socket } = useSocketContext();
  const [count, setCount] = useState(null);

  useEffect(() => {
    if (!socket) return;
    const onCount = (data) => {
      if (data && typeof data.count === 'number') setCount(data.count);
    };
    socket.on('presence:online_count', onCount);
    // Nudge the server for the current value in case we missed the
    // broadcast between page load and socket attach.
    socket.emit('presence:ping');
    return () => { socket.off('presence:online_count', onCount); };
  }, [socket]);

  return (
    <div
      title={count === null ? 'Connecting…' : `${count} operator${count === 1 ? '' : 's'} online`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginTop: 3,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.14em',
        color: 'var(--fg3)',
        userSelect: 'none',
      }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: 'var(--cyan)',
        boxShadow: '0 0 6px var(--cyan)',
        flexShrink: 0,
      }} />
      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cyan)' }}>
        {count === null ? '—' : count}
      </span>
      <span style={{ textTransform: 'uppercase' }}>
        online
      </span>
    </div>
  );
}
