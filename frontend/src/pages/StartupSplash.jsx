// Returning-player startup splash. Frameless 560×340 window drawn by
// the Electron shell before the dashboard is revealed. Look is a port
// of /home/kylo-mini/nexus/loading_screen_installer_style.html — same
// installer aesthetic, same log-line format, same timings.
//
// This renderer is the single source of truth for WHEN the main window
// reveals. The main process:
//   • creates this splash first,
//   • creates the main window hidden in parallel (loadURL kicks off),
//   • forwards real startup "steps" from various sources (main-side
//     cache_clear / renderer_load / update_check / ptt_hook; renderer-
//     side socket_connect / heartbeat) via `nexus:startup:broadcast-step`.
//
// We never block the app: a failed network step marks itself "offline"
// and we keep going. After 20 s we show "Still working"; after 60 s a
// hung step turns red and we offer Retry / Quit.
//
// Reveal rule:
//   reveal when (all required steps either ok/offline)
//   AND (3.5 s floor passed)
//   AND (each visible log line has had its 450 ms).
import { useEffect, useRef, useState } from 'react';

// Maps real IPC step names to user-visible phases. Multiple real
// events may roll into the same phase (e.g. prefs_read + skin_apply +
// cache_clear + ptt_hook all land under "Starting Nexus"). A phase
// completes once ALL its component steps are ok/offline.
const PHASES = [
  {
    id: 'start',
    label: 'Starting Nexus',
    ftLabel: 'STARTING',
    needs: ['prefs_read', 'skin_apply', 'cache_clear', 'ptt_hook'],
    network: false,
  },
  {
    id: 'update',
    label: 'Checking for updates',
    ftLabel: 'UPDATES',
    needs: ['update_check'],
    network: true,
  },
  {
    id: 'network',
    label: 'Connecting to the network',
    ftLabel: 'NETWORK',
    needs: ['socket_connect'],
    network: true,
  },
  {
    id: 'radios',
    label: 'Loading your radios',
    ftLabel: 'RADIOS',
    needs: ['renderer_load'],
    network: false,
  },
  {
    id: 'dash',
    label: 'Opening your dashboard',
    ftLabel: 'READY',
    needs: ['heartbeat'],
    network: true,
  },
];

const FLOOR_MS = 3500;
const LINE_MIN_MS = 450;
const STILL_WORKING_MS = 20000;
const FAIL_MS = 60000;

// Skin palette (mirror of the HTML spec). Keyed by skin id used in the
// renderer / installer. The main process picks `--bg0` for the window
// backgroundColor; the renderer re-applies the full palette here so the
// splash matches the saved skin on first paint.
const SKIN_PALETTES = {
  deepblue:    ['#66AADD','#00EEFF','#020C14','#061018','#0A1828','#12263A','#1A3A50','#2A5A7A'],
  obsidian:    ['#b4c2d3','#e4f2ff','#0a0a0c','#101012','#17171a','#202024','#2c2c31','#4a4a52'],
  ember:       ['#e3a655','#ffc766','#0c0806','#130d09','#1c130d','#281a11','#3a2616','#6a4524'],
  oxide:       ['#e2806a','#ffae92','#0e0607','#160a0b','#20100f','#2e1715','#44201c','#7a3a2e'],
  olivedrab:   ['#aec86f','#dff48f','#090b06','#0f120a','#171b0f','#212714','#333b1f','#5c6b34'],
  violetvoid:  ['#ae92ee','#e6ceff','#0a0612','#100a1a','#181026','#231738','#34224f','#5b3d8c'],
  abyss:       ['#52c6b3','#80f6e8','#04100f','#081817','#0e2321','#16322f','#1d4642','#2f7a72'],
  dune:        ['#d8bd90','#f3deb4','#100e0c','#181512','#221e19','#2f2922','#403830','#6e6254'],
  carbonpink:  ['#ff5fae','#ff8cc6','#030304','#08080a','#0f0f12','#18181c','#25252b','#3e3e47'],
};
const PALETTE_VARS = ['--acc','--acc2','--bg0','--bg1','--bg2','--bg3','--rim0','--rim1'];

function applySkin(id) {
  const p = SKIN_PALETTES[id] || SKIN_PALETTES.deepblue;
  const root = document.documentElement;
  PALETTE_VARS.forEach((v, i) => root.style.setProperty(v, p[i]));
}

export default function StartupSplash() {
  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  const startRef = useRef(Date.now());
  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  // Per-step status: 'pending' | 'ok' | 'offline' | 'error'
  const [steps, setSteps] = useState({
    prefs_read: 'ok',   // immediate on open
    skin_apply: 'ok',   // immediate on open
    cache_clear: 'pending',
    ptt_hook: 'pending',
    update_check: 'pending',
    socket_connect: 'pending',
    renderer_load: 'pending',
    heartbeat: 'pending',
  });

  // Phases the user has seen. Each entry: { phaseId, shownAt, completedAt }.
  const [visiblePhases, setVisiblePhases] = useState([
    { id: PHASES[0].id, shownAt: Date.now(), completedAt: null },
  ]);

  // Which phase is currently "active" (the latest one written to the log).
  const [activePhaseIdx, setActivePhaseIdx] = useState(0);

  // Update download UI: null if no update, else { percent, downloading, ready }.
  const [updateState, setUpdateState] = useState(null);

  // "Still working" (>=20 s) and failure (>=60 s) hints.
  const [stillWorking, setStillWorking] = useState(false);
  const [failedPhase, setFailedPhase] = useState(null); // phase id string
  const [revealed, setRevealed] = useState(false);

  // ─── Pre-paint setup: skin palette + reduced-motion report ────────────
  useEffect(() => {
    // Mirror of what main.jsx normally does, but earlier (main.jsx runs
    // on the /startup route too — we re-apply in case the stored value
    // changed). Fallback deepblue if unknown.
    try {
      const t = localStorage.getItem('nexus_theme') || 'deepblue';
      applySkin(t);
    } catch { applySkin('deepblue'); }
    // Tell main.js whether to skip its fade for the reveal.
    try { api?.startup?.reportReducedMotion?.(prefersReducedMotion.current); } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Wire IPC: broadcast-step from main ───────────────────────────────
  useEffect(() => {
    if (!api?.startup?.onBroadcastStep) return;
    const off = api.startup.onBroadcastStep(({ name, status }) => {
      if (!name) return;
      setSteps(prev => {
        if (prev[name] === 'ok' || prev[name] === 'offline') return prev;
        return { ...prev, [name]: status || 'ok' };
      });
    });
    return off;
  }, [api]);

  // ─── Wire IPC: update-specific events (progress / ready) ──────────────
  useEffect(() => {
    if (!api?.update?.on) return;
    const offs = [];
    offs.push(api.update.on('available', () => {
      setUpdateState({ percent: 0, downloading: true, ready: false });
      // Kick the download. autoDownload is false in main.js.
      try { api.update.download?.(); } catch {}
    }));
    offs.push(api.update.on('progress', (p) => {
      setUpdateState(s => ({
        percent: Math.round(p?.percent || 0),
        downloading: true,
        ready: false,
        ...(s || {}),
        percent: Math.round(p?.percent || 0),
      }));
    }));
    offs.push(api.update.on('ready', () => {
      setUpdateState({ percent: 100, downloading: false, ready: true });
      // The splash closes into the installer.
      try { api.update.installNow?.(); } catch {}
    }));
    offs.push(api.update.on('none', () => {
      setSteps(prev => prev.update_check === 'pending' ? { ...prev, update_check: 'ok' } : prev);
    }));
    offs.push(api.update.on('error', () => {
      setSteps(prev => prev.update_check === 'pending' ? { ...prev, update_check: 'offline' } : prev);
    }));
    return () => offs.forEach(fn => { try { fn && fn(); } catch {} });
  }, [api]);

  // ─── Still-working + failure timers ───────────────────────────────────
  useEffect(() => {
    const swT = setTimeout(() => setStillWorking(true), STILL_WORKING_MS);
    const failT = setTimeout(() => {
      // Pick the first phase that's not yet ok/offline.
      const stuck = PHASES.find(p => !isPhaseDone(p, steps));
      if (stuck) {
        // Network phases degrade to offline instead of blocking.
        if (stuck.network) {
          setSteps(prev => {
            const next = { ...prev };
            stuck.needs.forEach(k => { if (next[k] === 'pending') next[k] = 'offline'; });
            return next;
          });
        } else {
          setFailedPhase(stuck.id);
        }
      }
    }, FAIL_MS);
    return () => { clearTimeout(swT); clearTimeout(failT); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Advance phases as their underlying steps complete ────────────────
  useEffect(() => {
    // Mark completedAt on the currently-active phase if it's done.
    setVisiblePhases(prev => {
      const next = prev.map(v => {
        if (v.completedAt) return v;
        const def = PHASES.find(p => p.id === v.id);
        if (def && isPhaseDone(def, steps)) return { ...v, completedAt: Date.now() };
        return v;
      });
      return next;
    });
  }, [steps]);

  // Separate effect: open the next phase once the current one has been
  // visible for LINE_MIN_MS AND is done. Loop until we hit the last.
  useEffect(() => {
    if (activePhaseIdx >= PHASES.length - 1) return;
    const current = visiblePhases[visiblePhases.length - 1];
    const def = PHASES.find(p => p.id === current.id);
    if (!def) return;
    const done = isPhaseDone(def, steps);
    if (!done) return;
    const elapsed = Date.now() - current.shownAt;
    const wait = Math.max(0, LINE_MIN_MS - elapsed);
    const t = setTimeout(() => {
      const nextIdx = activePhaseIdx + 1;
      setActivePhaseIdx(nextIdx);
      setVisiblePhases(prev => [
        ...prev,
        { id: PHASES[nextIdx].id, shownAt: Date.now(), completedAt: null },
      ]);
    }, wait);
    return () => clearTimeout(t);
  }, [steps, visiblePhases, activePhaseIdx]);

  // ─── Reveal when ready ────────────────────────────────────────────────
  useEffect(() => {
    if (revealed) return;
    // All phases must be seen AND done, floor must have passed, last
    // line must have had its 450 ms.
    const allDone = PHASES.every(p => isPhaseDone(p, steps));
    const everyLineSeen = visiblePhases.length >= PHASES.length;
    const floorPassed = Date.now() - startRef.current >= FLOOR_MS;
    const lastLineSettled = (() => {
      const last = visiblePhases[visiblePhases.length - 1];
      if (!last) return false;
      return Date.now() - last.shownAt >= LINE_MIN_MS;
    })();
    if (allDone && everyLineSeen && floorPassed && lastLineSettled) {
      setRevealed(true);
      try { api?.startup?.signalReady?.(); } catch {}
      return;
    }
    // Otherwise poll gently so the floor/line timers eventually fire.
    const t = setTimeout(() => {
      // trigger re-render by setting state to itself (no-op) — easiest
      // path is to just bump a ref via setState(prev=>prev).
      setVisiblePhases(prev => prev.slice());
    }, 120);
    return () => clearTimeout(t);
  }, [steps, visiblePhases, revealed, api]);

  // ─── Retry / Quit handlers ────────────────────────────────────────────
  const onRetry = () => {
    try { api?.app?.relaunch?.(); } catch {}
  };
  const onQuit = () => {
    try { api?.app?.quit?.(); } catch {}
  };

  // ─── Compute UI ───────────────────────────────────────────────────────
  // Progress bar: completed phase count / total, 0..100.
  const completedCount = PHASES.filter(p => isPhaseDone(p, steps)).length;
  const basePct = Math.round((completedCount / PHASES.length) * 100);
  // When downloading an update, let that drive the bar instead.
  const downloading = updateState?.downloading && !updateState?.ready;
  const barPct = downloading
    ? Math.max(basePct, Math.min(100, Math.round(updateState.percent || 0)))
    : basePct;

  const statusWord = downloading
    ? `Downloading update ${Math.round(updateState.percent || 0)}%`
    : (PHASES[activePhaseIdx]?.label || 'Starting');

  const ftWord = downloading ? 'UPDATE' : (PHASES[activePhaseIdx]?.ftLabel || 'STARTING');

  return (
    <>
      <StyleBlock reduced={prefersReducedMotion.current} />
      <div className={`win ${revealed ? 'done' : ''}`}>
        <div className="drag" />
        <div className="body">
          <div className="scr">
            <div className="logo"><LogoMark /></div>
            <div className="wr">
              <div className="ttl" aria-label="NEXUS">
                {'NEXUS'.split('').map((c, k) => (
                  <span key={k} style={{ '--k': k }}>{c}</span>
                ))}
              </div>
              <div className="sub" style={{ '--i': 3 }}>SHIP MANAGEMENT</div>
              <div className="bar" style={{ '--i': 4 }}>
                <i style={{ width: `${barPct}%` }} />
              </div>
              <div className="pr" style={{ '--i': 4 }}>
                <span>{statusWord}{stillWorking && !revealed ? ' — Still working' : ''}</span>
                <b>{barPct}%</b>
              </div>
              <div className="log" style={{ '--i': 5 }}>
                {visiblePhases.map((v, i) => {
                  const def = PHASES.find(p => p.id === v.id);
                  const isLast = i === visiblePhases.length - 1;
                  const done = def ? isPhaseDone(def, steps) : false;
                  const offline = def ? isPhaseOffline(def, steps) : false;
                  const failed = failedPhase === v.id;
                  return (
                    <div
                      key={v.id + '-' + i}
                      className={`ln ${isLast ? '' : 'old'} ${failed ? 'err' : ''}`}
                    >
                      {def?.label || v.id}...
                      {done && !offline && <span className="ok">ok</span>}
                      {offline && <span className="offline">offline</span>}
                      {failed && <span className="err-label">failed</span>}
                    </div>
                  );
                })}
                {failedPhase && (
                  <div className="actions">
                    <button onClick={onRetry}>Retry</button>
                    <button onClick={onQuit}>Quit</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="ft">
          <div className="dots">
            {PHASES.map((p, i) => {
              const def = PHASES[i];
              const done = isPhaseDone(def, steps);
              const active = i === activePhaseIdx && !done;
              return <i key={p.id} className={done ? 'done' : (active ? 'on' : '')} />;
            })}
          </div>
          <span>{ftWord}</span>
          <span className="sp" />
          <span>VERSION {window?.electronAPI?.companion?.version || ''}</span>
        </div>
        <div className="cover"><b>Ready</b></div>
      </div>
    </>
  );
}

function isPhaseDone(phase, steps) {
  return phase.needs.every(k => steps[k] === 'ok' || steps[k] === 'offline');
}
function isPhaseOffline(phase, steps) {
  return phase.needs.some(k => steps[k] === 'offline');
}

function LogoMark() {
  // Direct port of mark() from the HTML spec.
  return (
    <svg viewBox="0 0 64 64" className="lg" aria-hidden="true">
      <path className="ink" pathLength="1" style={{ '--dl': '0ms' }} d="M20 10H9V54H20" />
      <path className="ink" pathLength="1" style={{ '--dl': '140ms' }} d="M44 10H55V54H44" />
      <path className="hot" pathLength="1" style={{ '--dl': '340ms' }} d="M24 22L36 32L24 42" />
      <rect className="cur" x="38" y="40" width="10" height="5" />
    </svg>
  );
}

// ─── Inline styles (matches the pattern in SettingsPopover.jsx / Splash.jsx)
// Verbatim port of the spec CSS, scoped to the splash root. Variables
// --acc / --acc2 / --bg0..bg3 / --rim0 / --rim1 are set by applySkin() at
// mount. Everything else is static.
function StyleBlock({ reduced }) {
  return (
    <style>{`
html, body, #root { margin:0; padding:0; background: transparent; }
body { font: 13px/1.5 Inter,system-ui,sans-serif; color: var(--t1, #f4f4f4); overflow:hidden; }
:root {
  --t1: color-mix(in srgb, var(--acc2,#00EEFF) 12%, #f4f4f4);
  --t2: color-mix(in srgb, var(--acc,#66AADD) 42%, #8c8c8c);
  --lime:#44dd88; --red:#ff5544;
  --inset: color-mix(in srgb, var(--bg0,#020C14) 60%, #000);
  --d2:160ms; --d3:280ms; --out:cubic-bezier(.2,.8,.2,1);
}
.win{position:fixed;inset:0;background:var(--bg0,#020C14);border:1px solid var(--rim1,#2A5A7A);display:flex;flex-direction:column;overflow:hidden}
.drag{position:absolute;top:0;left:0;right:0;height:22px;-webkit-app-region:drag;z-index:3}
.body{position:relative;flex:1;min-height:0}
.scr{position:absolute;inset:0;padding:26px 30px 14px;display:flex;align-items:center;gap:28px}
.scr>*{animation:rise var(--d3) var(--out) both;animation-delay:calc(var(--i,0)*60ms)}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.logo{width:150px;flex:none;display:grid;place-items:center;border-right:1px solid var(--rim0,#1A3A50);align-self:stretch}
.logo svg{width:100px;height:100px}
.lg{overflow:visible}
.lg path{fill:none;stroke-width:5;stroke-linecap:square;stroke-dasharray:1;stroke-dashoffset:1;animation:draw 380ms var(--out) forwards;animation-delay:var(--dl,0ms)}
.lg .ink{stroke:var(--acc,#66AADD)} .lg .hot{stroke:var(--acc2,#00EEFF)}
.lg .cur{fill:var(--acc2,#00EEFF);opacity:0;animation:blink 1050ms steps(1) infinite;animation-delay:640ms}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes blink{0%{opacity:1}50%{opacity:0}}
.wr{flex:1;min-width:0;display:flex;flex-direction:column}
.ttl{font:800 38px/1 Inter,system-ui,sans-serif;letter-spacing:.14em;color:var(--acc2,#00EEFF);display:flex}
.ttl span{opacity:0;animation:tp 1ms steps(1) forwards;animation-delay:calc(700ms + var(--k)*55ms)}
@keyframes tp{to{opacity:1}}
.sub{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.3em;color:var(--acc,#66AADD);margin:8px 0 14px}
.bar{position:relative;height:12px;background:var(--inset);border:1px solid var(--rim0,#1A3A50);overflow:hidden}
.bar i{position:absolute;inset:0 auto 0 0;background:var(--acc2,#00EEFF);transition:width var(--d2) linear}
.bar i::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent);transform:translateX(-100%);animation:shine 1500ms linear infinite}
.bar::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0 19px,rgba(0,0,0,.5) 19px 20px);pointer-events:none}
@keyframes shine{to{transform:translateX(100%)}}
.pr{display:flex;justify-content:space-between;margin:6px 0 8px;font:600 11px Inter,system-ui,sans-serif;letter-spacing:.06em;color:var(--t2)}
.pr b{color:var(--acc2,#00EEFF);font-variant-numeric:tabular-nums}
.log{height:76px;overflow:hidden;background:var(--inset);border:1px solid var(--rim0,#1A3A50);padding:7px 10px;font:11px/1.55 ui-monospace,Menlo,Consolas,monospace;display:flex;flex-direction:column;justify-content:flex-end}
.ln{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--t1);animation:lnin var(--d2) var(--out)}
.ln .ok{color:var(--lime);margin-left:8px}
.ln .offline{color:var(--t2);margin-left:8px}
.ln .err-label{color:var(--red);margin-left:8px}
.ln.err{color:var(--red)}
.ln.old{color:var(--t2)}
.actions{display:flex;gap:10px;margin-top:4px}
.actions button{font:600 10px Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--acc2,#00EEFF);background:transparent;border:1px solid var(--rim1,#2A5A7A);padding:3px 10px;cursor:pointer}
.actions button:hover{background:var(--bg2,#0A1828)}
@keyframes lnin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.ft{height:30px;flex:none;border-top:1px solid var(--rim0,#1A3A50);background:var(--bg1,#061018);display:flex;align-items:center;gap:14px;padding:0 14px;font:600 10px Inter,system-ui,sans-serif;letter-spacing:.08em;color:var(--t2)}
.dots{display:flex;gap:6px} .dots i{width:18px;height:3px;background:var(--rim0,#1A3A50);transition:background var(--d3)}
.dots i.on{background:var(--acc2,#00EEFF)} .dots i.done{background:var(--acc,#66AADD)}
.ft .sp{flex:1}
.cover{position:absolute;inset:0;background:var(--bg0,#020C14);opacity:0;pointer-events:none;transition:opacity 380ms ease;z-index:4;display:grid;place-items:center}
.cover b{font:800 11px Inter,system-ui,sans-serif;letter-spacing:.3em;color:var(--lime);text-transform:uppercase}
.win.done .cover{opacity:1}
${reduced ? `
*{animation:none!important;transition:none!important}
.lg path{stroke-dashoffset:0!important}
.ttl span, .lg .cur{opacity:1!important}
` : ''}
    `}</style>
  );
}
