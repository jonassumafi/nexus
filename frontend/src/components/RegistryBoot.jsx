import { useState, useEffect, useRef } from 'react';
import api from '../services/api';

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

const DOS_DEFS = [
  { text: '> INITIALIZING NEXUS REGISTRY ACCESS PROTOCOL...', color: '#66AADD' },
  { text: '> AUTHENTICATING OPERATOR CREDENTIALS...',          color: '#66AADD' },
  { text: '> CREDENTIALS VERIFIED — CLEARANCE LEVEL: OPERATOR', color: '#33DDAA' },
  { text: '> ESTABLISHING UPLINK TO UEE CENTRAL DATABASE...', color: '#66AADD' },
  // audio.onended gates line 4
  { text: '> SIGNAL ACQUIRED — NODE 7 ONLINE',               color: '#33DDAA' },
  // Final VESSEL MANIFESTS SYNCHRONIZED line is injected dynamically inside
  // startSequence() with the actual ship count after the bars finish.
];

export default function RegistryBoot({ onComplete }) {
  const [dosLines,      setDosLines]      = useState([]);
  const [signalVisible, setSignalVisible] = useState(false);
  const [activeBars,    setActiveBars]    = useState(0);
  const [signalLocked,  setSignalLocked]  = useState(false);

  const shipsRef        = useRef([]);
  const onCompleteRef   = useRef(onComplete);
  const tids            = useRef([]);
  const audioRef        = useRef(null);
  const dlAudioRef      = useRef(null);
  const cancelledRef    = useRef(false);
  const seqStarted      = useRef(false);

  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      tids.current.forEach(clearTimeout);
      const a = audioRef.current;
      if (a) { try { a.pause(); a.src = ''; a.load(); } catch {} }
      const dl = dlAudioRef.current;
      if (dl) { try { dl.pause(); dl.src = ''; dl.load(); } catch {} }
    };
  }, []);

  useEffect(() => {
    api.get('/ships?includeStats=true')
      .then(({ data }) => {
        if (cancelledRef.current) return;
        const list = Array.isArray(data) ? data : [];
        shipsRef.current = list;
        startSequence(list);
      })
      .catch(() => {
        if (!cancelledRef.current) startSequence([]);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function sched(fn, delay) {
    const id = setTimeout(() => { if (!cancelledRef.current) fn(); }, delay);
    tids.current.push(id);
    return id;
  }

  function addLine(text, color) {
    if (cancelledRef.current) return;
    setDosLines(prev => [...prev, { id: Date.now() + Math.random(), text, color }]);
  }

  function startSequence(ships) {
    if (seqStarted.current) return;
    seqStarted.current = true;

    const shipCount = ships.length;

    // Download sound plays as soon as the sequence begins (before line 0
    // renders) and is stopped when line 3 "ESTABLISHING UPLINK" fires.
    const dlSfx = new Audio('/sounds/download_sound.mp3');
    dlAudioRef.current = dlSfx;
    dlSfx.play().catch(() => {});

    // Lines 0-3 at 1200ms intervals
    sched(() => addLine(DOS_DEFS[0].text, DOS_DEFS[0].color), 0);
    sched(() => addLine(DOS_DEFS[1].text, DOS_DEFS[1].color), 1200);
    sched(() => addLine(DOS_DEFS[2].text, DOS_DEFS[2].color), 2400);
    sched(() => {
      // Line 3 fires: cut the download sound.
      try { dlSfx.pause(); dlSfx.currentTime = 0; } catch {}

      addLine(DOS_DEFS[3].text, DOS_DEFS[3].color);

      // Play signal_resolution and gate the post-audio sequence on the first
      // trigger — either natural `onended` OR the 8s fallback, whichever
      // fires first. `afterAudioFired` is a single-shot flag shared across
      // both paths so we never replay the sequence.
      const audio = new Audio('/sounds/signal_resolution.mp3');
      audioRef.current = audio;
      audio.volume = 0.5;
      audio.play().catch(() => {});

      let afterAudioFired = false;
      const afterAudio = () => {
        if (afterAudioFired || cancelledRef.current) return;
        afterAudioFired = true;

        addLine(DOS_DEFS[4].text, DOS_DEFS[4].color);
        const sfx = new Audio('/sounds/signal_established.mp3');
        sfx.play().catch(() => {});
        sched(() => {
          setSignalVisible(true);
          animateBars(() => {
            addLine(`> VESSEL MANIFESTS SYNCHRONIZED — ${shipCount} RECORDS LOADED`, '#33DDAA');
            sched(() => onCompleteRef.current?.(shipsRef.current), 3000);
          });
        }, 2400);
      };

      audio.onended = afterAudio;
      sched(afterAudio, 8000);
    }, 3600);
  }

  function animateBars(cb) {
    let i = 0;
    const tick = () => {
      if (cancelledRef.current) return;
      if (i < 5) {
        setActiveBars(i + 1);
        i++;
        const id = setTimeout(tick, 220);
        tids.current.push(id);
      } else {
        setSignalLocked(true);
        const id = setTimeout(cb, 500);
        tids.current.push(id);
      }
    };
    tick();
  }

  const barHeights = [8, 16, 24, 32, 40];

  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#000', overflow: 'hidden',
    }}>
      <div style={{
        width: 700,
        padding: 40,
        boxSizing: 'border-box',
        fontFamily: "'JetBrains Mono', 'Courier New', Courier, monospace",
      }}>
        {/* Header */}
        <div style={{
          fontSize: 20, color: '#CCE8FF', fontWeight: 'bold',
          letterSpacing: '0.16em', textAlign: 'center',
          marginBottom: 4,
        }}>
          NEXUS INTERSTELLAR TRAFFIC SYSTEM
        </div>
        <div style={{ color: '#1A3D55', fontSize: 16, letterSpacing: '0.06em', lineHeight: 1.9 }}>
          {DIVIDER}
        </div>
        <div style={{
          fontSize: 14, color: '#4488BB',
          letterSpacing: '0.12em', textAlign: 'center',
          marginBottom: 4,
        }}>
          CENTRAL SHIP REGISTRY — OPERATOR ACCESS
        </div>
        <div style={{ color: '#1A3D55', fontSize: 16, letterSpacing: '0.06em', lineHeight: 1.9, marginBottom: 20 }}>
          {DIVIDER}
        </div>

        {/* DOS log */}
        <div style={{ minHeight: 130, marginBottom: 24 }}>
          {dosLines.map(line => (
            <div key={line.id} style={{
              fontSize: 18, color: line.color,
              letterSpacing: '0.06em', lineHeight: 1.9,
            }}>
              {line.text}
            </div>
          ))}
        </div>

        {/* Signal row */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, marginBottom: 24,
          opacity: signalVisible ? 1 : 0, transition: 'opacity 0.5s',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 40 }}>
            {barHeights.map((h, i) => (
              <div key={i} style={{
                width: 8, height: h,
                background: activeBars > i ? '#00EEFF' : '#1A3D55',
                transition: 'background 0.3s',
              }} />
            ))}
          </div>
          <div style={{ fontSize: 16, color: '#00EEFF', letterSpacing: '0.1em' }}>
            {signalLocked ? 'SIGNAL LOCKED · UEE NODE 7' : 'ACQUIRING SIGNAL...'}
          </div>
        </div>
      </div>
    </div>
  );
}
