import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import AsciiBox from '../components/AsciiBox';
import TerminalBoot from '../components/TerminalBoot';
import NexusLockup from '../components/NexusLockup';

const playClick = () => {
  const file = Math.random() > 0.5 ? '/sounds/click.mp3' : '/sounds/click2.mp3';
  const snd = new Audio(file);
  snd.volume = 0.7;
  snd.play().catch(() => {});
};

// Phase content preserved from the old LINE_DEFS — labels/status words are
// the same, only the render shape changed. The "CONNECTED" and "VERIFIED"
// chips at the end become the READY chip with the lime LED under treatment A.
const SPLASH_PHASES = [
  { label: 'BIOS v2.31.04',            status: 'OK'        },
  { label: 'CHECKING MEMORY',          status: 'OK'        },
  { label: 'LOADING BOOT DEVICE',      status: 'OK'        },
  { label: 'READING SECTOR TABLE',     status: 'OK'        },
  { label: 'LOADING CREW MODULE',      status: 'OK'        },
  { label: 'LOADING MISSION MODULE',   status: 'OK'        },
  { label: 'LOADING RP ENGINE',        status: 'OK'        },
  { label: 'ESTABLISHING CONNECTION',  status: 'CONNECTED' },
  { label: 'AUTHENTICATING NODE',      status: 'VERIFIED'  },
];

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

  // Belt-and-suspenders: a returning player must never see the MS-DOS
  // boot. Gate.jsx already blocks the "Enter" path, but if anything else
  // routes here (deep link, legacy sessionStorage flag, etc.), short-
  // circuit straight to /dashboard.
  const [returningBlocked, setReturningBlocked] = useState(false);
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (!api?.prefs?.get) return;
    let cancelled = false;
    Promise.resolve(api.prefs.get('hasCharacter'))
      .then(v => {
        if (cancelled) return;
        if (v === true) {
          setReturningBlocked(true);
          navigate('/dashboard', { replace: true });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [navigate]);

  const audios    = useRef({});
  const fadingRef = useRef(false);

  const [welcome, setWelcome]           = useState(false);
  const [prompt, setPrompt]             = useState(false);
  const [fading, setFading]             = useState(false);
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

  // Comms sfx used to fire alongside the ESTABLISHING CONNECTION phase in
  // the old range-based timing; route it through onPhaseChange so the
  // trigger still lands on the same conceptual step (now phase 7).
  const handlePhase = (idx) => {
    if (idx === 7) playComms();
    if (idx === SPLASH_PHASES.length - 1) fadeOutComms();
  };

  const handleBootComplete = () => {
    setWelcome(true);
    setTimeout(() => setPrompt(true), 800);
  };

  // ─── Keypress / click handler — ANY-TIME skip ────────────────────────────────

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

  // Fast-path for already-authenticated users.
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

  const electron = typeof window !== 'undefined' ? window.electronAPI : null;

  if (returningBlocked) return null;

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
          border: `1px solid ${audioEnabled ? 'var(--lime)' : 'var(--rim1)'}`,
          color: audioEnabled ? 'var(--lime)' : 'var(--rim1)',
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

      <div style={{ width: '100%', maxWidth: 760 }}>
        <AsciiBox fontSize={21.6} charW={13.2}>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: 16.8,
            lineHeight: 1.9,
            color: 'var(--blue)',
          }}>
            {/* Stacked lockup per logo_e_spec section 6 — the only spot
                where the boot draw-on plays. Keeps the version + copyright
                text so the context above the terminal still reads. */}
            <div style={{
              display: 'flex', justifyContent: 'center', marginBottom: 14,
            }}>
              <NexusLockup height={64} orientation="stacked" animate />
            </div>
            <div style={{ color: 'var(--t2)', marginBottom: 2, textAlign: 'center' }}>
              NEXUS INTERSTELLAR TRAFFIC SYSTEM v1.0
            </div>
            <div style={{ color: 'var(--rim1)', marginBottom: 20, textAlign: 'center' }}>
              COPYRIGHT 2956 FRONTIER OPERATORS GUILD
            </div>

            <TerminalBoot
              phases={SPLASH_PHASES}
              phaseDelay={700}
              onPhaseChange={handlePhase}
              onComplete={handleBootComplete}
              completeDelay={400}
              width={680}
              awaitingLabel="AWAITING NODE HANDSHAKE"
              readyLabel="SYSTEM READY"
              loadingLabel="SYSTEM LOADING"
            />

            {welcome && (
              <div style={{ color: 'var(--t2)', marginTop: 20 }}>
                WELCOME TO NEXUS 1.0 <span className="cursor">|</span>
              </div>
            )}

            {prompt && (
              <div style={{ color: 'var(--cyan)', marginTop: 8 }} className="prompt-pulse">
                {'[ PRESS ANY KEY TO CONTINUE ]'}
              </div>
            )}

          </div>
        </AsciiBox>
      </div>
    </div>
  );
}
