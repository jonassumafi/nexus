import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const DOT_SLOTS = 20;
const TICK_MS   = 80;

function dots(n) {
  return '[' + '.'.repeat(n) + ' '.repeat(DOT_SLOTS - n) + ']';
}

function Corner({ pos }) {
  const S = { position: 'absolute', width: 16, height: 16, pointerEvents: 'none' };
  const edges = {
    tl: { top: 24, left: 24,  borderTop:    '1px solid #1A3D55', borderLeft:   '1px solid #1A3D55' },
    tr: { top: 24, right: 24, borderTop:    '1px solid #1A3D55', borderRight:  '1px solid #1A3D55' },
    bl: { bottom: 24, left: 24,  borderBottom: '1px solid #1A3D55', borderLeft:   '1px solid #1A3D55' },
    br: { bottom: 24, right: 24, borderBottom: '1px solid #1A3D55', borderRight:  '1px solid #1A3D55' },
  };
  return <div style={{ ...S, ...edges[pos] }} />;
}

export default function Gate() {
  const navigate = useNavigate();
  const [clicked, setClicked] = useState(false);
  const [dotPos,  setDotPos]  = useState(0);
  const [ready,   setReady]   = useState(false);
  const [fading,  setFading]  = useState(false);
  const [hover,   setHover]   = useState(false);
  const timeoutsRef = useRef([]);

  const handleClick = () => {
    if (clicked) return;
    setClicked(true);
    setHover(false);

    try {
      const hdd = new Audio('/sounds/HDD_sound.mp3');
      hdd.loop = true;
      hdd.volume = 0.25;
      hdd.play().catch(() => {});
      // Hand off ownership via window so Splash can adopt the same audio element
      // (preserves seamless audio continuity from Gate → Splash and prevents orphaning).
      window.__nexus_hdd = hdd;
    } catch {}

    timeoutsRef.current.push(setTimeout(() => { setReady(true); setFading(true); }, 5000));
    timeoutsRef.current.push(setTimeout(() => { sessionStorage.setItem('hdd_started', 'true'); navigate('/splash'); }, 5500));
  };

  useEffect(() => {
    if (!clicked || ready) return;
    const id = setInterval(() => setDotPos(p => (p + 1) % (DOT_SLOTS + 1)), TICK_MS);
    return () => clearInterval(id);
  }, [clicked, ready]);

  // Defensive cleanup: clear pending timeouts and, if we're NOT handing off to Splash
  // (e.g., user navigated away mid-countdown), kill the orphaned HDD audio.
  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
      if (window.__nexus_hdd && sessionStorage.getItem('hdd_started') !== 'true') {
        try {
          window.__nexus_hdd.pause();
          window.__nexus_hdd.src = '';
          window.__nexus_hdd.load();
        } catch {}
        window.__nexus_hdd = null;
      }
    };
  }, []);

  const btnBorder = clicked ? '#00EEFF' : hover ? '#66AADD' : '#2A6A9A';
  const btnColor  = clicked ? '#00EEFF' : hover ? '#99CCFF' : '#66AADD';

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#000',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
      opacity: fading ? 0 : 1,
      transition: 'opacity 0.5s ease',
    }}>
      <div className="scanlines" />
      <div className="vignette" />

      <Corner pos="tl" />
      <Corner pos="tr" />
      <Corner pos="bl" />
      <Corner pos="br" />

      <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 28, color: '#1A3D55', letterSpacing: '0.24em', marginBottom: 36 }}>
          FRONTIER OPERATORS GUILD
        </div>

        <div style={{ fontSize: 48, color: '#99CCFF', fontWeight: 'bold', letterSpacing: '0.16em', marginBottom: 10 }}>
          NEXUS INTERSTELLAR TRAFFIC SYSTEM
        </div>

        <div style={{ fontSize: 32, color: '#2A6A9A', letterSpacing: '0.12em', marginBottom: 56 }}>
          v1.0 · 2956 SEY
        </div>

        <div style={{ width: 140, height: 1, background: '#0D2030', margin: '0 auto', marginBottom: 56 }} />

        <button
          className={clicked ? 'gate-btn' : 'gate-btn gate-pulse'}
          onClick={handleClick}
          onMouseEnter={() => !clicked && setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            background: '#000',
            border: `1px solid ${btnBorder}`,
            color: btnColor,
            fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
            fontSize: 36,
            padding: '20px 48px',
            cursor: clicked ? 'default' : 'pointer',
            letterSpacing: '0.08em',
            transition: 'border-color 0.15s, color 0.15s',
          }}
        >
          {clicked ? '[ INITIATING... ]' : '[ CLICK TO INITIATE ]'}
        </button>

        {clicked && (
          <div style={{
            marginTop: 24,
            fontSize: 14,
            letterSpacing: '0.08em',
            whiteSpace: 'pre',
            color: ready ? '#33DDAA' : '#2A6A9A',
          }}>
            {ready ? `${dots(DOT_SLOTS)}  READY` : dots(dotPos)}
          </div>
        )}

        <div style={{ fontSize: 26, color: '#1A3D55', letterSpacing: '0.1em', marginTop: 56 }}>
          BUILD 1.0.0 · UTC
        </div>
      </div>
    </div>
  );
}
