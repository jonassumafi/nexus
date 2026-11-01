import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import AsciiBox from '../components/AsciiBox';

const playClick = () => {
  const file = Math.random() > 0.5 ? '/sounds/click.mp3' : '/sounds/click2.mp3';
  const snd = new Audio(file);
  snd.volume = 0.7;
  snd.play().catch(() => {});
};

const DOT_SLOTS = 20;
const TICK_MS = 80;

const LINE_DEFS = [
  { label: 'BIOS v2.31.04           ', status: 'OK',        color: '#2A5A7A', range: [800,  2800] },
  { label: 'CHECKING MEMORY         ', status: '640MB OK',  color: '#2A5A7A', range: [700,  2600] },
  { label: 'LOADING BOOT DEVICE     ', status: 'FOUND',     color: '#2A5A7A', range: [600,  2000] },
  { label: 'READING SECTOR TABLE    ', status: 'OK',        color: '#2A5A7A', range: [1000, 3600] },
  { label: 'LOADING CREW MODULE     ', status: 'OK',        color: '#2A5A7A', range: [800,  2800] },
  { label: 'LOADING MISSION MODULE  ', status: 'OK',        color: '#2A5A7A', range: [900,  3200] },
  { label: 'LOADING RP ENGINE       ', status: 'OK',        color: '#2A5A7A', range: [1200, 4400] },
  { label: 'ESTABLISHING CONNECTION ', status: 'CONNECTED', color: '#44FF88', range: [1000, 3600] },
  { label: 'AUTHENTICATING NODE     ', status: 'VERIFIED',  color: '#44FF88', range: [800,  2800] },
];

function randInt(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

function buildSequence() {
  let durations = LINE_DEFS.map(({ range }) => randInt(range[0], range[1]));
  const total = durations.reduce((s, d) => s + d, 0);
  if (total > 28000) {
    const scale = 28000 / total;
    durations = durations.map(d => Math.max(Math.floor(d * scale), 600));
  }
  return {
    durations,
    headerGap:  randInt(400, 800),
    group1Gap:  randInt(600, 1200),
    group2Gap:  randInt(600, 1200),
    header2Lag: randInt(200, 500),
  };
}

const IDLE      = 'idle';
const ANIMATING = 'animating';
const RESOLVED  = 'resolved';

function dots(n) {
  return '[' + '.'.repeat(n) + ' '.repeat(DOT_SLOTS - n) + ']';
}

// Decode JWT payload and return { valid: bool, expired: bool }
// Treats tokens where onboarding_complete is false as invalid — forces fresh OAuth
function checkToken() {
  try {
    const raw = localStorage.getItem('nexus_token');
    if (!raw) return { valid: false };
    const segment = raw.split('.')[1];
    if (!segment) return { valid: false };
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    if (Date.now() / 1000 > payload.exp) return { valid: false, expired: true };
    if (!payload.onboarding_complete) return { valid: false };
    return { valid: true };
  } catch {
    return { valid: false };
  }
}

export default function Splash() {
  const navigate = useNavigate();

  const seqRef    = useRef(null);
  const audios    = useRef({});
  const fadingRef = useRef(false);

  if (!seqRef.current) seqRef.current = buildSequence();

  const [header1, setHeader1]       = useState(false);
  const [header2, setHeader2]       = useState(false);
  const [lineStates, setLineStates] = useState(
    LINE_DEFS.map(() => ({ phase: IDLE, dots: 0 }))
  );
  const [gap1, setGap1]       = useState(false);
  const [gap2, setGap2]       = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [prompt, setPrompt]   = useState(false);
  const [fading, setFading]           = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);

  // ─── Audio setup ─────────────────────────────────────────────────────────────

  useEffect(() => {
    try {
      const c = new Audio('/sounds/comms.mp3');
      c.volume = 0.7;
      audios.current.comms = c;
    } catch {}

    let hdd;
    try {
      const fromGate = sessionStorage.getItem('hdd_started') === 'true';
      if (fromGate && window.__nexus_hdd) {
        // Adopt the audio element Gate started — single instance, no duplicate/orphan.
        hdd = window.__nexus_hdd;
        window.__nexus_hdd = null;
        sessionStorage.removeItem('hdd_started');
        hdd.muted = false;
        setAudioEnabled(true);
      } else {
        hdd = new Audio('/sounds/HDD_sound.mp3');
        hdd.loop   = true;
        hdd.volume = 0.25;
        if (fromGate) {
          sessionStorage.removeItem('hdd_started');
          hdd.muted = false;
          hdd.play().catch(() => {});
          setAudioEnabled(true);
        } else {
          hdd.muted = true;
        }
      }
      audios.current.hdd = hdd;
    } catch {}

    return () => {
      try {
        hdd?.pause();
        if (hdd) {
          hdd.currentTime = 0;
          hdd.src = '';
          hdd.load();
        }
      } catch {}
      try { audios.current.comms?.pause(); } catch {}
    };
  }, []);

  // ─── Audio helpers ────────────────────────────────────────────────────────────

  const fadeOut = (key, stepSize = 0.05, intervalMs = 50) => {
    try {
      const a = audios.current[key];
      if (!a) return;
      const id = setInterval(() => {
        try {
          if (a.volume > stepSize) {
            a.volume = Math.max(0, a.volume - stepSize);
          } else {
            a.volume = 0;
            a.pause();
            clearInterval(id);
          }
        } catch { clearInterval(id); }
      }, intervalMs);
    } catch {}
  };

  const playComms = () => {
    try {
      const a = audios.current.comms;
      if (!a) return;
      if (audios.current.hdd?.muted) return;
      a.currentTime = 0;
      a.volume = 0.7;
      a.play().catch(() => {});
    } catch {}
  };

  const fadeOutComms = () => fadeOut('comms', 0.07, 50);

  // Fade HDD to 0 over exactly 400ms (20 steps × 20ms)
  const fadeOutHDD400 = () => {
    try {
      const a = audios.current.hdd;
      if (!a) return;
      const startVol = a.volume;
      const STEPS = 20;
      const stepSize = startVol / STEPS;
      let step = 0;
      const id = setInterval(() => {
        step++;
        try {
          a.volume = Math.max(0, startVol - stepSize * step);
          if (step >= STEPS) { a.volume = 0; a.pause(); clearInterval(id); }
        } catch { clearInterval(id); }
      }, 20);
    } catch {}
  };

  // ─── Audio toggle button handler ─────────────────────────────────────────────

  const handleAudioToggle = (e) => {
    e.stopPropagation();
    const hdd = audios.current.hdd;
    if (!audioEnabled) {
      if (hdd) {
        hdd.muted = false;
        hdd.play().catch(() => {});
      }
      setAudioEnabled(true);
    } else {
      if (hdd) hdd.muted = true;
      setAudioEnabled(false);
    }
  };

  // ─── Main animation sequence ──────────────────────────────────────────────────

  useEffect(() => {
    const { durations, headerGap, group1Gap, group2Gap, header2Lag } = seqRef.current;
    const tids = [];
    const iids = [];

    const schedule = (fn, delay) => {
      const id = setTimeout(fn, delay);
      tids.push(id);
      return id;
    };

    setHeader1(true);
    schedule(() => setHeader2(true), header2Lag);

    let cursor = header2Lag + headerGap;

    const runLine = (index) => {
      const dur = durations[index];

      schedule(() => {
        setLineStates(prev => {
          const next = [...prev];
          next[index] = { phase: ANIMATING, dots: 0 };
          return next;
        });

        if (index === 7) playComms();

        let dotPos = 0;
        const iid = setInterval(() => {
          dotPos = (dotPos + 1) % (DOT_SLOTS + 1);
          setLineStates(prev => {
            const next = [...prev];
            if (next[index].phase === ANIMATING) {
              next[index] = { phase: ANIMATING, dots: dotPos };
            }
            return next;
          });
        }, TICK_MS);
        iids.push(iid);

        schedule(() => {
          clearInterval(iid);
          setLineStates(prev => {
            const next = [...prev];
            next[index] = { phase: RESOLVED, dots: DOT_SLOTS };
            return next;
          });
          if (index === 3) setGap1(true);
          if (index === 6) setGap2(true);
          if (index === 8) fadeOutComms();
        }, dur);

      }, cursor);

      cursor += dur;
      if (index === 3) cursor += group1Gap;
      if (index === 6) cursor += group2Gap;
    };

    for (let i = 0; i < LINE_DEFS.length; i++) runLine(i);

    schedule(() => setWelcome(true), cursor + 600);
    schedule(() => setPrompt(true),  cursor + 600 + 800);

    return () => {
      tids.forEach(clearTimeout);
      iids.forEach(clearInterval);
    };
  }, []);

  // ─── Keypress / click handler — ANY-TIME skip ────────────────────────────────
  //
  // Previously this handler was gated on `prompt` (the "PRESS ANY KEY TO
  // CONTINUE" state) so users had to watch the entire boot sequence before
  // they could proceed. That gets tedious once you've seen it, and worse
  // once you're already authenticated — nothing meaningful happens in the
  // animation. Now ANY keypress or click at any point in the sequence
  // fast-forwards to the end state and routes the user.

  useEffect(() => {
    const handleInput = () => {
      if (fadingRef.current) return;
      fadingRef.current = true;

      playClick();
      setFading(true);

      fadeOutHDD400();
      try { audios.current.comms?.pause(); } catch {}

      const { valid } = checkToken();
      if (!valid) {
        setTimeout(() => {
          try {
            const h = audios.current.hdd;
            if (h) { h.pause(); h.currentTime = 0; h.src = ''; h.load(); }
          } catch (e) {}
          window.location.href = '/api/auth/discord';
        }, 800);
      } else {
        setTimeout(() => {
          try {
            const h = audios.current.hdd;
            if (h) { h.pause(); h.currentTime = 0; h.src = ''; h.load(); }
          } catch (e) {}
          navigate('/dashboard');
        }, 800);
      }
    };

    // Ignore modifier-only presses so Ctrl, Shift, etc. aren't swallowed.
    const onKeyDown = (e) => {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      handleInput();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('click',   handleInput);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('click',   handleInput);
    };
  }, [navigate]);

  // ─── Already-authenticated fast-path ─────────────────────────────────────────
  // Users who already have a valid JWT shouldn't have to sit through the
  // boot sequence every time the app launches. Short-circuit on mount
  // straight to the dashboard, with a tiny delay so the fading transition
  // feels intentional rather than jarring.

  useEffect(() => {
    const { valid } = checkToken();
    if (!valid) return;
    if (fadingRef.current) return;
    fadingRef.current = true;
    setFading(true);
    const t = setTimeout(() => {
      try {
        const h = audios.current.hdd;
        if (h) { h.pause(); h.currentTime = 0; h.src = ''; h.load(); }
      } catch (e) {}
      navigate('/dashboard', { replace: true });
    }, 450);
    return () => clearTimeout(t);
  }, [navigate]);

  // ─── Render ───────────────────────────────────────────────────────────────────

  const lineColor = (ls, idx) =>
    ls.phase === RESOLVED ? LINE_DEFS[idx].color : '#66AADD';

  const electron = typeof window !== 'undefined' ? window.electronAPI : null;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: fading ? 0 : 1,
      transition: 'opacity 0.8s ease',
      cursor: 'default',
      padding: '48px 72px',
    }}>
      <div className="vignette" />

      {/* Close button for Electron users — keeps the splash from feeling
          like a cutscene they can't escape. */}
      {electron && (
        <button
          className="btn warn"
          onClick={(e) => { e.stopPropagation(); electron.close?.(); }}
          title="Close"
          style={{
            position: 'fixed', top: 12, right: 12,
            width: 30, height: 26, padding: 0, fontSize: 12, zIndex: 200,
          }}
        >
          ✕
        </button>
      )}

      <button
        onClick={handleAudioToggle}
        title={audioEnabled ? 'Mute' : 'Enable sound'}
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          background: 'transparent',
          border: `1px solid ${audioEnabled ? '#44FF88' : '#2A5A7A'}`,
          color: audioEnabled ? '#44FF88' : '#2A5A7A',
          width: 34,
          height: 34,
          padding: 0,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          opacity: 0.75,
        }}
      >
        {audioEnabled ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
          </svg>
        )}
      </button>

      <div style={{ width: '100%', maxWidth: 700 }}>
        <AsciiBox fontSize={21.6} charW={13.2}>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: 16.8,
            lineHeight: 1.9,
            color: '#66AADD',
          }}>

            {header1 && (
              <div style={{ color: '#99BBDD', marginBottom: 2 }}>
                NEXUS INTERSTELLAR TRAFFIC SYSTEM v1.0
              </div>
            )}
            {header2 && (
              <div style={{ color: '#2A5A7A', marginBottom: 20 }}>
                COPYRIGHT 2956 FRONTIER OPERATORS GUILD
              </div>
            )}

            {LINE_DEFS.slice(0, 4).map((def, i) => {
              const ls = lineStates[i];
              if (ls.phase === IDLE) return null;
              return (
                <div key={i} style={{ color: lineColor(ls, i), whiteSpace: 'pre' }}>
                  {def.label}{dots(ls.dots)}{ls.phase === RESOLVED ? '  ' + def.status : ''}
                </div>
              );
            })}

            {gap1 && <div>&nbsp;</div>}

            {LINE_DEFS.slice(4, 7).map((def, i) => {
              const idx = i + 4;
              const ls = lineStates[idx];
              if (ls.phase === IDLE) return null;
              return (
                <div key={idx} style={{ color: lineColor(ls, idx), whiteSpace: 'pre' }}>
                  {def.label}{dots(ls.dots)}{ls.phase === RESOLVED ? '  ' + def.status : ''}
                </div>
              );
            })}

            {gap2 && <div>&nbsp;</div>}

            {LINE_DEFS.slice(7, 9).map((def, i) => {
              const idx = i + 7;
              const ls = lineStates[idx];
              if (ls.phase === IDLE) return null;
              return (
                <div key={idx} style={{ color: lineColor(ls, idx), whiteSpace: 'pre' }}>
                  {def.label}{dots(ls.dots)}{ls.phase === RESOLVED ? '  ' + def.status : ''}
                </div>
              );
            })}

            {welcome && (
              <div style={{ color: '#99BBDD', marginTop: 20 }}>
                WELCOME TO NEXUS 1.0 <span className="cursor">|</span>
              </div>
            )}

            {prompt && (
              <div style={{ color: '#00EEFF', marginTop: 8 }} className="prompt-pulse">
                {'[ PRESS ANY KEY TO CONTINUE ]'}
              </div>
            )}

          </div>
        </AsciiBox>
      </div>
    </div>
  );
}
