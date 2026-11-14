import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext.jsx';
import NexusMark from '../components/NexusMark';

export default function Gate() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuthContext();
  const [clicked, setClicked] = useState(false);
  const [ready,   setReady]   = useState(false);
  const [fading,  setFading]  = useState(false);
  const timeoutsRef = useRef([]);

  // Already authenticated and onboarded? Skip the intro completely —
  // nobody needs to re-watch the "click to initiate" countdown every
  // time they open the app.
  useEffect(() => {
    if (isAuthenticated && user?.onboarding_complete) {
      navigate('/dashboard', { replace: true });
    } else if (isAuthenticated && user && !user.onboarding_complete) {
      navigate('/onboarding', { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  // Render nothing for the one frame between mount and the useEffect's
  // navigate() firing — otherwise returning users see a brief flash of
  // the "click to initiate" screen before the redirect kicks in. First-
  // time users (not authenticated or onboarding incomplete) fall through
  // to the normal intro below.
  if (isAuthenticated && user?.onboarding_complete) return null;
  if (isAuthenticated && user && !user.onboarding_complete) return null;

  // Jump directly to the Splash boot sequence (with HDD audio handoff
  // intact so Splash's expected soundscape still runs). Shared by click
  // and any-key handlers below.
  const beginSequence = () => {
    if (clicked) return;
    setClicked(true);

    try {
      const hdd = new Audio('/sounds/HDD_sound.mp3');
      hdd.loop = true;
      hdd.volume = 0.25;
      hdd.play().catch(() => {});
      window.__nexus_hdd = hdd;
    } catch {}

    timeoutsRef.current.push(setTimeout(() => { setReady(true); setFading(true); }, 5000));
    timeoutsRef.current.push(setTimeout(() => {
      sessionStorage.setItem('hdd_started', 'true');
      navigate('/splash');
    }, 5500));
  };

  // Immediate skip — fast-path the "ready" state and navigate right now.
  // Fired by any key press after the sequence has started, or by Enter /
  // Space before the user has clicked anything.
  const fastForward = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setReady(true);
    setFading(true);
    sessionStorage.setItem('hdd_started', 'true');
    navigate('/splash');
  };

  const handleClick = () => beginSequence();

  // Keyboard handler — any key press. Behavior:
  //   • Not clicked yet → start the sequence (so pressing a key feels
  //     like clicking the button).
  //   • Already clicked and animating → fast-forward past the pulse.
  useEffect(() => {
    const onKey = (e) => {
      // Ignore modifier-only presses so Ctrl-Shift-F etc. aren't swallowed.
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      if (!clicked) beginSequence();
      else fastForward();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clicked]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const electron = typeof window !== 'undefined' ? window.electronAPI : null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'radial-gradient(ellipse 60% 55% at 50% 42%, #0E2A44 0%, transparent 70%), var(--void)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 22,
      textAlign: 'center',
      opacity: fading ? 0 : 1,
      transition: 'opacity 0.5s ease',
    }}>
      {/* Window close button — top-right, always visible so users on the
          splash screen aren't trapped without an escape. Only renders in
          the Electron companion; irrelevant in a regular browser tab. */}
      {electron && (
        <button
          className="btn warn"
          onClick={() => electron.close?.()}
          title="Close"
          style={{
            position: 'absolute', top: 12, right: 12,
            width: 30, height: 26, padding: 0, fontSize: 12, zIndex: 20,
          }}
        >
          ✕
        </button>
      )}
      {/* Prompt mark (logo_e_spec). Boot draw-on plays once on mount. */}
      <div style={{
        width: 120,
        height: 120,
        borderRadius: 14,
        background: 'linear-gradient(180deg, #0b1d2e, #020a12)',
        border: '1px solid var(--rim1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 1px 0 rgba(150,210,255,.25) inset, 0 4px 0 #04101a, 0 6px 0 #030c14, 0 22px 36px rgba(0,0,0,.6)',
      }}>
        <NexusMark size={76} animate />
      </div>

      <div>
        <h1 style={{
          fontSize: 46,
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: 'var(--fg0)',
          textTransform: 'uppercase',
          lineHeight: 1.1,
          margin: 0,
        }}>
          Nexus Interstellar
        </h1>
        <div style={{
          fontSize: 16,
          fontWeight: 500,
          letterSpacing: '0.3em',
          color: 'var(--blue)',
          textTransform: 'uppercase',
          marginTop: 6,
        }}>
          Traffic System
        </div>
      </div>

      <div style={{
        fontSize: 14,
        letterSpacing: '0.16em',
        color: 'var(--fg3)',
        textTransform: 'uppercase',
      }}>
        v1.0 · 2956 SEY
      </div>

      <button
        className={clicked ? 'btn lg' : 'btn lg'}
        onClick={handleClick}
        disabled={clicked}
        style={{ marginTop: 20 }}
      >
        {clicked ? (
          <>
            <span className="spinner" />
            <span>Initiating session…</span>
          </>
        ) : (
          'Enter'
        )}
      </button>

      {clicked && (
        <div style={{
          marginTop: 12,
          fontSize: 12,
          color: ready ? 'var(--lime)' : 'var(--fg3)',
          letterSpacing: '0.08em',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          {ready && <span className="live-dot" />}
          {ready ? 'READY' : 'Opening uplink…'}
        </div>
      )}

      <div style={{
        position: 'absolute',
        bottom: 16,
        display: 'flex',
        justifyContent: 'center',
        gap: 28,
        fontSize: 12,
        color: 'var(--fg3)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <i className="live-dot" />Systems online
        </span>
        <span>Build 1.0.0</span>
      </div>
    </div>
  );
}
