import { useState, useEffect } from 'react';
import { useAuthContext } from '../context/AuthContext.jsx';

const playClick = () => {
  const file = Math.random() > 0.5 ? '/sounds/click.mp3' : '/sounds/click2.mp3';
  const snd = new Audio(file);
  snd.volume = 0.7;
  snd.play().catch(() => {});
};

const BASE_LINES = [
  { text: 'TERMINATING SESSION...',              color: '#2A6A9A' },
  { text: 'FLUSHING CREW ASSIGNMENTS...',        color: '#2A6A9A' },
  { text: 'CLEARING AUTHORIZATION TOKEN...',     color: '#2A6A9A' },
  { text: 'DISCONNECTING FROM NEXUS RELAY...',   color: '#2A6A9A' },
  { text: 'CONNECTION TERMINATED.',              color: '#FF5544' },
];

export default function Disconnect() {
  const { user } = useAuthContext();
  const [visibleCount, setVisibleCount] = useState(0);

  const lines = [
    ...BASE_LINES,
    { text: `GOODBYE, ${user?.citizen_name || 'OPERATOR'}.`, color: '#1A3D55' },
  ];

  useEffect(() => {
    playClick();

    const tids = [];
    lines.forEach((_, i) => {
      tids.push(setTimeout(() => setVisibleCount(i + 1), i * 200));
    });

    const lastDelay = (lines.length - 1) * 200;
    tids.push(setTimeout(() => {
      localStorage.removeItem('nexus_token');
      window.location.href = '/';
    }, lastDelay + 1200));

    return () => tids.forEach(clearTimeout);
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
      fontSize: 14,
    }}>
      <div className="scanlines" />
      <div className="vignette" />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {lines.slice(0, visibleCount).map((line, i) => (
          <div key={i} style={{ color: line.color, letterSpacing: '0.08em', lineHeight: 2 }}>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}
