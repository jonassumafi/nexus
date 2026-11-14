// Radio module — rendered twice (once as CREW, once as COMMAND).
// Only the `role` label and the data wires differ. Matches the "full
// mirror" variant from Radio Mirror Layouts: role header, big LCD
// frequency, Retune/Lock/Disconnect, Transmit bar + PTT key, On
// Frequency expand/collapse, Volume · Pan expand/collapse.
//
// This component is purely presentational — it takes callbacks for
// every action and renders a mirror-identical UI. Data wiring lives
// in whichever page mounts it (Dashboard, Companion, Radio-only).

import { useEffect, useRef, useState } from 'react';
import FreqTuneInput from './FreqTuneInput';
import { playTune } from '../utils/audioFx';
import { useHold, HoldRing } from './HoldButton';
import './radioMotion.css';

// Power toggle button. Turning ON is still a single click; turning OFF
// requires a 3-second press-and-hold with a progress ring, so the
// operator can't accidentally silence their radio mid-fight. Early
// release cancels. When powered off, hover=cyan (restorative).
function PowerBtn({ onClick, powered }) {
  const [hover, setHover] = useState(false);
  const [pressing, setPressing] = useState(false);
  const { bindProps, progress, holding, showHint } = useHold({
    holdMs: 3000,
    hintText: 'Hold to turn off',
    onComplete: () => { try { onClick?.(); } catch {} },
  });

  // When powered on: show a filling ring, no instant click. When off:
  // single click turns on (hold machinery is bypassed).
  const flash = hover && !pressing && !holding;
  const flashColor = powered ? 'var(--red)' : 'var(--cyan)';

  const commonHandlers = powered
    ? bindProps
    : { onClick: () => { try { onClick?.(); } catch {} } };

  return (
    <button
      className="rm-ib"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressing(false); if (powered) bindProps.onMouseLeave(); }}
      onMouseDown={() => { setPressing(true); if (powered) bindProps.onMouseDown(); }}
      onMouseUp={() => { setPressing(false); if (powered) bindProps.onMouseUp(); }}
      onTouchStart={powered ? bindProps.onTouchStart : undefined}
      onTouchEnd={powered ? bindProps.onTouchEnd : undefined}
      onTouchCancel={powered ? bindProps.onTouchCancel : undefined}
      onKeyDown={powered ? bindProps.onKeyDown : undefined}
      onKeyUp={powered ? bindProps.onKeyUp : undefined}
      onBlur={powered ? bindProps.onBlur : undefined}
      onClick={powered ? undefined : commonHandlers.onClick}
      aria-label={powered ? 'Power off (hold 3 seconds)' : 'Power on'}
      aria-pressed={powered}
      title={powered ? 'Hold to turn off' : 'Power on radio'}
      style={{
        position: 'relative',
        width: 32, minHeight: 0,
        display: 'grid', placeItems: 'center',
        borderRadius: 5, padding: 0, flex: 'none',
        border: (flash || holding)
          ? `1px solid color-mix(in srgb, ${flashColor} 70%, var(--bg0))`
          : '1px solid var(--rim1)',
        background: (flash || holding)
          ? `linear-gradient(180deg, color-mix(in srgb, ${flashColor} 55%, var(--bg0)), color-mix(in srgb, ${flashColor} 32%, var(--bg0)))`
          : 'linear-gradient(180deg, var(--bg3, #183230), var(--bg2))',
        boxShadow: '0 1px 0 var(--hl) inset, 0 2px 0 var(--edge)',
        color: (flash || holding)
          ? '#fff'
          : (powered
              ? 'color-mix(in srgb, var(--red) 55%, #fff)'
              : 'var(--fg3)'),
        cursor: 'pointer',
        opacity: powered ? 1 : 0.65,
        transition: 'background .12s, color .12s, border-color .12s, opacity .12s',
        fontSize: 14,
        fontWeight: powered ? 700 : 400,
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {powered && <HoldRing progress={progress} variant="danger" size={32} />}
      <span style={{ position: 'relative', zIndex: 1 }}>⏻</span>
      {showHint && (
        <span
          role="status"
          style={{
            position: 'absolute', left: '50%', bottom: -16, transform: 'translateX(-50%)',
            whiteSpace: 'nowrap', fontSize: 9, letterSpacing: '0.08em',
            color: 'var(--red)', pointerEvents: 'none',
          }}
        >Hold to turn off</span>
      )}
    </button>
  );
}

export default function RadioModule({
  role = 'RADIO',             // visible header label
  rigLabel = '',              // long rig name (e.g. "VHF · VX-51 Fieldmaster")
  rigShort = '',              // short rig name for tight areas
  freq = '',                  // tuned frequency string
  pttKey = null,              // key label
  isLive = false,             // peers present on frequency
  isTx = false,               // currently transmitting
  peers = [],                 // {citizenName, socketId}[]
  transmittingPeerIds = [],
  locked = false,
  powered = true,             // false = inert radio; UI muted & disabled
  onCommitFreq,               // (string) => void   — commit a frequency change
  onPowerToggle,              // () => void          — toggle power on/off
  onLockToggle,
  onPttDown,
  onPttUp,
  onRemapPtt,
  onOpenSettings,
  onOpenRigPicker,
  otherPttKey = null,                  // other tuner's PTT key, used to flag conflicts in capture mode
  siblingSettingsOpen = false,         // sibling tile has settings open → dim this one
  onSettingsOpenChange,                // (bool) => void; lets parent coordinate single-open invariant
}) {
  const [freqInput, setFreqInput] = useState(freq || '');
  const [openOnFreq, setOpenOnFreq] = useState(true);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgClosing, setCfgClosing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [capState, setCapState] = useState(null);   // null | 'bad' | 'got'
  const [capLabel, setCapLabel] = useState(null);   // text override while capturing (e.g. "F in use")
  const [savedShow, setSavedShow] = useState(false);
  const savedTimerRef = useRef(null);

  const cardRef = useRef(null);
  const digitsRef = useRef(null);
  const dispRef = useRef(null);
  const lockBtnRef = useRef(null);
  const chipRef = useRef(null);
  const facesRef = useRef(null);
  const backRef = useRef(null);
  const frontRef = useRef(null);
  const gearBtnRef = useRef(null);
  const prevFreqRef = useRef(freq || '');
  const prevPoweredRef = useRef(powered);
  const prevLockedRef = useRef(locked);
  const prevRxActiveRef = useRef(false);

  const [rollChars, setRollChars] = useState(null);
  const [digitsAnim, setDigitsAnim] = useState(null);
  const [chipOverride, setChipOverride] = useState(null);
  const tailTimersRef = useRef({});
  const prevTalkingRef = useRef(new Set());
  const [tailIds, setTailIds] = useState(new Set());

  const isPTTActive = !!isTx;
  const activeTalkers = (transmittingPeerIds || []).filter(Boolean);
  const isRx = activeTalkers.length > 0 && !isPTTActive && powered;

  if (freqInput === '' && freq) {
    // One-shot sync — not reactive, parent passes `freq` on each render.
  }

  useEffect(() => {
    if (!cardRef.current) return;
    const root = cardRef.current;
    const onDown = (e) => {
      const target = e.target.closest('.rm-btn, .rm-ib');
      if (!target || target.disabled || !root.contains(target)) return;
      const rc = target.getBoundingClientRect();
      const span = document.createElement('span');
      const sz = Math.max(rc.width, rc.height) * 2.2;
      span.className = 'rm-rip';
      span.style.cssText =
        `left:${e.clientX - rc.left}px;top:${e.clientY - rc.top}px;` +
        `width:${sz}px;height:${sz}px`;
      target.appendChild(span);
      setTimeout(() => { try { span.remove(); } catch {} }, 420);
    };
    root.addEventListener('pointerdown', onDown);
    return () => root.removeEventListener('pointerdown', onDown);
  }, []);

  // Odometer digit roll when committed freq changes
  useEffect(() => {
    const next = freq || '';
    const prev = prevFreqRef.current || '';
    if (next === prev) return;
    prevFreqRef.current = next;
    if (!prev) return;
    setRollChars({ prev, next, at: Date.now() });
    const dp = dispRef.current;
    if (dp) {
      dp.classList.remove('rm-flash');
      void dp.offsetWidth;
      dp.classList.add('rm-flash');
    }
    const digitCount = next.replace(/\./g, '').length;
    const dur = 280 + digitCount * 40 + 60;
    const t = setTimeout(() => setRollChars(null), dur);
    return () => clearTimeout(t);
  }, [freq]);

  // Power transitions on the digits display
  useEffect(() => {
    if (prevPoweredRef.current === powered) return;
    prevPoweredRef.current = powered;
    if (!powered) {
      setDigitsAnim('rm-pdn');
      const t = setTimeout(() => setDigitsAnim(null), 360);
      return () => clearTimeout(t);
    } else {
      setDigitsAnim('rm-pup');
      const t = setTimeout(() => setDigitsAnim(null), 460);
      return () => clearTimeout(t);
    }
  }, [powered]);

  // Lock snap
  useEffect(() => {
    if (prevLockedRef.current === locked) return;
    prevLockedRef.current = locked;
    const btn = lockBtnRef.current;
    if (btn) {
      btn.classList.remove('rm-snap');
      void btn.offsetWidth;
      btn.classList.add('rm-snap');
      const t = setTimeout(() => btn.classList.remove('rm-snap'), 320);
      return () => clearTimeout(t);
    }
  }, [locked]);

  // Squelch flash on RX edge
  useEffect(() => {
    const now = activeTalkers.length > 0;
    if (now !== prevRxActiveRef.current) {
      prevRxActiveRef.current = now;
      const dp = dispRef.current;
      if (dp) {
        dp.classList.remove('rm-sq');
        void dp.offsetWidth;
        dp.classList.add('rm-sq');
        setTimeout(() => dp && dp.classList.remove('rm-sq'), 120);
      }
    }
  }, [activeTalkers.length]);

  // Peer tail bookkeeping
  useEffect(() => {
    const now = new Set(activeTalkers);
    const prev = prevTalkingRef.current;
    const stopped = [];
    prev.forEach(id => { if (!now.has(id)) stopped.push(id); });
    prevTalkingRef.current = now;
    if (stopped.length) {
      setTailIds(cur => {
        const n = new Set(cur);
        stopped.forEach(id => n.add(id));
        return n;
      });
      stopped.forEach(id => {
        if (tailTimersRef.current[id]) clearTimeout(tailTimersRef.current[id]);
        tailTimersRef.current[id] = setTimeout(() => {
          setTailIds(cur => { const n = new Set(cur); n.delete(id); return n; });
          delete tailTimersRef.current[id];
        }, 420);
      });
    }
  }, [activeTalkers.join(',')]);

  // ─── Settings face: measured-height animation ─────────────────────────
  // We toggle `.rm-cfg` on the module root, which flips which face is in
  // flow (front vs. back). Before flipping we record the current height,
  // after flipping we read the target, then pin the inline height during
  // the CSS transition. A safety timer clears the inline height in case
  // transitionend never fires (e.g. heights were equal).
  const showSaved = () => {
    setSavedShow(true);
    clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedShow(false), 1300);
  };

  const animateFaces = (opening) => {
    const f = facesRef.current;
    if (!f) return;
    const from = f.getBoundingClientRect().height;
    // Measure the destination face by reading its offsetHeight. The back
    // face is visibility:hidden by default; temporarily force it visible
    // just long enough to measure, then restore. Flip the state flag
    // between measurements so we read each face in its "in flow" layout.
    const front = frontRef.current;
    const back = backRef.current;
    let to;
    if (opening) {
      const prevVis = back.style.visibility;
      back.style.visibility = 'visible';
      to = back.offsetHeight;
      back.style.visibility = prevVis;
    } else {
      // Front is currently absolute (settings open). Read its height anyway.
      to = front.offsetHeight;
    }
    f.style.height = from + 'px';
    void f.offsetHeight;
    f.style.height = to + 'px';
    const clear = () => {
      f.style.height = '';
      f.removeEventListener('transitionend', onEnd);
    };
    const onEnd = (e) => {
      if (e.target === f && e.propertyName === 'height') clear();
    };
    f.addEventListener('transitionend', onEnd);
    setTimeout(clear, 700);
  };

  const openCfg = () => {
    if (cfgOpen) return;
    setCfgOpen(true);
    onSettingsOpenChange?.(true);
    requestAnimationFrame(() => {
      animateFaces(true);
      // Focus the first interactive control on the back face after the
      // swap begins. rAF-after-rAF lets the layout settle first.
      requestAnimationFrame(() => {
        const el = backRef.current?.querySelector('button, select, [role=switch]');
        if (el) try { el.focus({ preventScroll: true }); } catch {}
      });
    });
  };
  const closeCfg = () => {
    if (!cfgOpen) return;
    // Cancel any in-flight capture before closing.
    if (capturing) stopCapture(true);
    setCfgClosing(true);
    setCfgOpen(false);
    onSettingsOpenChange?.(false);
    requestAnimationFrame(() => {
      animateFaces(false);
      setTimeout(() => setCfgClosing(false), 460);
      try { gearBtnRef.current?.focus({ preventScroll: true }); } catch {}
    });
  };

  // Escape closes
  useEffect(() => {
    if (!cfgOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !capturing) {
        e.preventDefault();
        closeCfg();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgOpen, capturing]);

  const stopCapture = (cancel) => {
    setCapturing(false);
    setCapState(null);
    setCapLabel(null);
    void cancel;
  };

  // Capture-mode key listener. Runs only while `capturing` is true.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { stopCapture(true); return; }
      const raw = e.key;
      const label = raw.length === 1
        ? raw.toUpperCase()
        : (raw === 'CapsLock' ? 'CAPSLOCK' : raw.toUpperCase());
      // Ignore bare modifier presses — wait for a real key.
      if (['SHIFT','CONTROL','ALT','META'].includes(label)) return;
      if (otherPttKey && label.toUpperCase() === String(otherPttKey).toUpperCase()) {
        setCapState('bad');
        setCapLabel(label + ' in use');
        setTimeout(() => {
          setCapState(null);
          setCapLabel(null);
        }, 900);
        return;
      }
      setCapturing(false);
      setCapState('got');
      setCapLabel(null);
      // New contract: pass the resolved key. Parent cards that still use
      // the legacy "listen for next key" flow should accept an optional
      // string arg and skip the overlay if given.
      try { onRemapPtt?.(label); } catch {}
      showSaved();
      setTimeout(() => setCapState(null), 320);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, otherPttKey]);

  const commitFreq = () => {
    if (!powered) return;
    if (locked) {
      const btn = lockBtnRef.current;
      if (btn) {
        btn.classList.remove('rm-deny');
        void btn.offsetWidth;
        btn.classList.add('rm-deny');
        setTimeout(() => btn && btn.classList.remove('rm-deny'), 320);
      }
      setChipOverride('LOCKED');
      setTimeout(() => setChipOverride(null), 900);
      return;
    }
    const raw = (freqInput || '').trim();
    if (!raw) { setFreqInput(freq || ''); return; }
    onCommitFreq?.(raw);
  };

  const peerCount = (peers || []).length;

  // ─── Styles reused in multiple places ─────────────────────────────────
  const ibtn = {  // icon button
    width: 34, height: 'auto', minHeight: 28,
    display: 'grid', placeItems: 'center',
    borderRadius: 5, border: '1px solid var(--rim1)',
    background: 'linear-gradient(180deg, var(--bg3, #183230), var(--bg2))',
    boxShadow: '0 1px 0 var(--hl) inset, 0 2px 0 var(--edge)',
    color: 'var(--fg1)', padding: 0, flex: 'none',
    cursor: 'pointer',
  };
  const btn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 6, height: 28, padding: '0 10px',
    borderRadius: 5, border: '1px solid var(--rim1)',
    background: 'linear-gradient(180deg, var(--bg3, #183230), var(--bg2))',
    boxShadow: '0 1px 0 var(--hl) inset, 0 2px 0 var(--edge)',
    font: '600 12px Inter',
    color: 'var(--fg1)',
    whiteSpace: 'nowrap', cursor: 'pointer',
  };
  const goBtn = {
    ...btn,
    background: 'linear-gradient(180deg, color-mix(in srgb, var(--cyan) 34%, var(--bg0)), color-mix(in srgb, var(--cyan) 18%, var(--bg0)))',
    borderColor: 'color-mix(in srgb, var(--cyan) 58%, var(--bg0))',
    color: 'var(--cyan)',
    fontWeight: 700,
  };
  const chip = {
    display: 'inline-flex', alignItems: 'center',
    height: 20, padding: '0 8px', borderRadius: 4,
    border: '1px solid var(--rim1)',
    font: '700 10px Inter', letterSpacing: '0.1em',
    color: 'var(--fg2)', background: 'var(--bg0)',
    flex: 'none',
  };
  const chipLive = {
    ...chip,
    borderColor: 'color-mix(in srgb, var(--lime) 55%, var(--bg0))',
    background: 'color-mix(in srgb, var(--lime) 16%, var(--bg0))',
    color: 'color-mix(in srgb, var(--lime) 55%, #fff)',
  };
  const chipTx = {
    ...chip,
    borderColor: 'color-mix(in srgb, var(--red) 58%, var(--bg0))',
    background: 'color-mix(in srgb, var(--red) 20%, var(--bg0))',
    color: 'color-mix(in srgb, var(--red) 45%, #fff)',
  };
  const chipOff = {
    ...chip,
    borderColor: 'var(--rim1)',
    background: 'var(--bg0)',
    color: 'var(--fg3)',
    opacity: 0.75,
  };

  let statusChip = !powered ? chipOff : (isTx ? chipTx : (isLive ? chipLive : chip));
  let statusLabel = !powered ? 'OFF' : (isTx ? 'TX' : (isLive ? 'LIVE' : 'IDLE'));
  let statusMod = !powered ? 'rm-chip-off' : (isTx ? 'rm-chip-tx' : (isRx ? 'rm-chip-rx' : (isLive ? 'rm-chip-live' : '')));
  if (chipOverride === 'LOCKED') {
    statusChip = { ...chip, borderColor: 'color-mix(in srgb, var(--amber) 58%, var(--bg0))', background: 'color-mix(in srgb, var(--amber) 16%, var(--bg0))', color: 'color-mix(in srgb, var(--amber) 50%, #fff)' };
    statusLabel = 'LOCKED';
    statusMod = 'rm-chip-lk';
  }

  const modClass =
    'rm-mod' +
    (isTx ? ' rm-tx' : '') +
    (isRx ? ' rm-rx' : '') +
    (locked ? ' rm-locked' : '') +
    (!powered ? ' rm-off' : '') +
    (cfgOpen ? ' rm-cfg' : '') +
    (cfgClosing ? ' rm-closing' : '') +
    (siblingSettingsOpen && !cfgOpen ? ' rm-dim' : '');

  const renderOdometer = () => {
    if (!rollChars) return null;
    const { prev, next } = rollChars;
    let k = 0;
    return (
      <div
        className={`rm-digits ${digitsAnim || ''}`}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          font: '700 18px Inter',
          pointerEvents: 'none',
          background: 'var(--bg0)',
          zIndex: 2,
        }}
      >
        {next.split('').map((c, i) => {
          if (c === '.') return <span key={i} className="rm-pt">.</span>;
          const delay = k * 40;
          const o = prev[i];
          const changed = o !== undefined && o !== c;
          k++;
          return (
            <span key={i} className="rm-dg">
              {changed && o !== '.' && (
                <span className="rm-o" style={{ animationDelay: `${delay}ms` }}>{o}</span>
              )}
              <span
                className={changed ? 'rm-n rm-roll' : 'rm-n'}
                style={changed ? { animationDelay: `${delay}ms` } : undefined}
              >{c}</span>
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div ref={cardRef} className={modClass} style={{
      position: 'relative',
      border: `1px solid ${isTx ? 'color-mix(in srgb, var(--red) 58%, var(--bg0))' : 'var(--rim0)'}`,
      borderRadius: 8,
      background: 'var(--bg2)',
      overflow: 'hidden',
      boxShadow: isTx
        ? '0 0 0 1px color-mix(in srgb, var(--red) 58%, var(--bg0)), 0 0 18px color-mix(in srgb, var(--red) 30%, transparent)'
        : '0 1px 0 var(--hl) inset',
      transition: 'box-shadow .12s, border-color .12s',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header: role · rig · status · gear */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px 6px 10px',
        background: 'linear-gradient(180deg, var(--bg3, #183230), var(--bg1))',
        borderBottom: '1px solid var(--edge, var(--rim0))',
      }}>
        <div className="rm-titles">
          <span className="rm-t-main">
            <span style={{
              font: '700 12px Inter', letterSpacing: '0.14em',
              textTransform: 'uppercase', color: 'var(--cyan)',
              flex: 'none',
            }}>{role}</span>
            <button
              onClick={onOpenRigPicker}
              title={rigLabel || rigShort || 'Change radio'}
              disabled={locked || !powered}
              style={{
                background: 'none', border: 0, padding: 0,
                color: 'var(--fg2)', font: '400 11px Inter',
                minWidth: 0, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
                cursor: (locked || !powered) ? 'default' : 'pointer',
                opacity: !powered ? 0.5 : 1,
              }}
            >{rigShort || rigLabel || '(no rig)'}</button>
          </span>
          <span className="rm-t-cfg">
            <span style={{
              font: '700 12px Inter', letterSpacing: '0.14em',
              textTransform: 'uppercase', color: 'var(--cyan)',
            }}>{role} · Settings</span>
          </span>
        </div>
        <span ref={chipRef} className={`rm-chip ${statusMod}`} style={statusChip}>
          {statusMod && <i className="rm-chip-dot" />}
          {statusLabel}
        </span>
        <button
          ref={gearBtnRef}
          className="rm-ib rm-gear"
          style={{ ...ibtn, position: 'relative' }}
          onClick={() => (cfgOpen ? closeCfg() : openCfg())}
          aria-expanded={cfgOpen}
          aria-label={`${role} settings`}
          title={cfgOpen ? 'Close settings' : 'Settings'}
        >
          <span className="rm-i-gear">⚙</span>
          <span className="rm-i-close">✕</span>
        </button>
      </div>

      {/* Body — front/back faces for settings slide */}
      <div className="rm-faces" ref={facesRef}>
      <div className="rm-face rm-front" ref={frontRef}>
        {/* Frequency row: LCD (its internal TUNE button commits) · Lock · Disconnect.
            Row height is driven by the FreqTuneInput's own padding; no
            external tune button since FreqTuneInput ships one inside. */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
          <div
            ref={dispRef}
            className="rm-disp"
            style={{ flex: 1, minWidth: 0, opacity: powered ? 1 : 0.55, position: 'relative', borderRadius: 6 }}
          >
            {renderOdometer()}
            <FreqTuneInput
              value={freqInput}
              onChange={(locked || !powered) ? () => {} : setFreqInput}
              onCommit={commitFreq}
              onCancel={() => setFreqInput(freq || '')}
              transmitting={isTx}
              lcdFontSize={18}
              playTune={(locked || !powered) ? undefined : playTune}
            />
          </div>
          <button
            ref={lockBtnRef}
            className="rm-ib"
            style={{
              ...ibtn, width: 32, height: 'auto', minHeight: 0,
              color: locked ? 'var(--amber)' : 'var(--fg1)',
              borderColor: locked
                ? 'color-mix(in srgb, var(--amber) 55%, var(--bg0))'
                : 'var(--rim1)',
              fontSize: 14,
              cursor: !powered ? 'not-allowed' : 'pointer',
              opacity: powered ? 1 : 0.55,
            }}
            onClick={onLockToggle}
            disabled={!powered}
            aria-pressed={locked}
            aria-label={locked ? 'Unlock' : 'Lock'}
            title={locked ? 'Unlock tuner' : 'Lock tuner'}
          >{locked ? '🔒' : '🔓'}</button>
          <PowerBtn onClick={onPowerToggle} powered={powered} />
        </div>

        {/* Transmit row: TX button + remap PTT */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            className="rm-btn"
            style={{
              ...goBtn, flex: 1, height: 40, fontSize: 13,
              letterSpacing: '0.04em',
              userSelect: 'none', WebkitUserSelect: 'none',
              touchAction: 'none',
              ...(isTx ? {
                background: 'linear-gradient(180deg, color-mix(in srgb, var(--red) 45%, var(--bg0)), color-mix(in srgb, var(--red) 28%, var(--bg0)))',
                borderColor: 'color-mix(in srgb, var(--red) 58%, var(--bg0))',
                color: '#fff',
              } : {}),
            }}
            onMouseDown={e => { e.preventDefault(); if (powered) onPttDown?.(); }}
            onMouseUp={onPttUp}
            onMouseLeave={onPttUp}
            onTouchStart={e => { e.preventDefault(); if (powered) onPttDown?.(); }}
            onTouchEnd={onPttUp}
            disabled={!powered || !freq}
            title={!powered ? 'Radio is off' : (!freq ? 'Tune a frequency first' : 'Hold to transmit')}
          >
            <span>Transmit</span>
            {pttKey && (
              <span style={{
                display: 'inline-grid', placeItems: 'center',
                minWidth: 22, height: 20, padding: '0 6px',
                borderRadius: 4, border: '1px solid var(--rim1)',
                background: 'var(--bg0)', color: 'var(--cyan)',
                font: '700 11px Inter',
              }}>{pttKey.toUpperCase()}</span>
            )}
          </button>
          <button
            className="rm-ib"
            style={{ ...ibtn, width: 34, height: 40 }}
            onClick={onRemapPtt}
            aria-label={`Change ${role} key`}
            title="Change PTT key"
          >⌨</button>
        </div>
        <div style={{
          color: 'var(--fg3)', fontSize: 10, letterSpacing: '0.14em',
          textTransform: 'uppercase', textAlign: 'center',
        }}>Press and hold</div>

        {/* On Frequency expand/collapse */}
        <div style={{
          borderTop: '1px solid var(--rim0)', margin: '0 -8px',
          padding: '6px 10px 0', display: 'flex', flexDirection: 'column', gap: 4,
          opacity: powered ? 1 : 0.5,
        }}>
          <button
            onClick={() => setOpenOnFreq(o => !o)}
            aria-expanded={openOnFreq}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              cursor: 'pointer', userSelect: 'none',
              background: 'none', border: 0, padding: 0,
              textAlign: 'left', width: '100%',
            }}
          >
            <span style={{
              fontSize: 11, color: 'var(--fg2)',
              transform: openOnFreq ? 'none' : 'rotate(-90deg)',
              transition: 'transform .15s',
            }}>▾</span>
            <span style={{
              font: '700 10px Inter', letterSpacing: '0.14em',
              textTransform: 'uppercase', color: 'var(--fg2)',
            }}>On frequency</span>
            <span style={{
              marginLeft: 'auto', color: 'var(--fg2)',
              fontVariantNumeric: 'tabular-nums',
            }}>{peerCount}</span>
          </button>
          {openOnFreq && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 3,
              paddingBottom: 6,
            }}>
              {peerCount === 0 ? (
                <div style={{ color: 'var(--fg3)', fontSize: 11 }}>
                  No other operators
                </div>
              ) : (
                (peers || []).map(p => {
                  const speaking = (transmittingPeerIds || []).includes(p.socketId);
                  const tailing = tailIds.has(p.socketId) && !speaking;
                  // TODO: weak signal (rm-weak), your-own-voice (rm-me) — deferred, need signal-quality + self-tx surface
                  const opClass =
                    'rm-op' +
                    (speaking ? ' rm-talk' : '') +
                    (tailing ? ' rm-tail' : '');
                  return (
                    <div
                      key={p.socketId}
                      className={opClass}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '3px 7px', borderRadius: 4,
                        background: speaking ? 'color-mix(in srgb, var(--lime) 14%, var(--bg0))' : 'var(--bg0)',
                      }}
                    >
                      <i style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: speaking ? 'var(--lime)' : 'var(--rim1)',
                        boxShadow: speaking ? '0 0 5px var(--lime)' : 'none',
                      }} />
                      <span style={{
                        color: speaking ? 'var(--lime)' : 'var(--fg1)',
                        fontWeight: speaking ? 600 : 400,
                      }}>{p.citizenName || 'Operator'}</span>
                      <em style={{
                        marginLeft: 'auto', fontStyle: 'normal',
                        color: 'var(--fg2)', fontSize: 11,
                      }}>{speaking ? 'speaking' : 'in range'}</em>
                    </div>
                  );
                })
              )}
            </div>
          )}

        </div>
      </div>
      {/* /rm-front */}

      {/* Back face: settings rows */}
      <div className="rm-face rm-back" ref={backRef} aria-hidden={!cfgOpen}>
        <div className="rm-row" style={{ '--i': 0 }}>
          <span className="rm-lb" style={rowLabelStyle}>Radio</span>
          <div style={rowCtlStyle}>
            <button
              onClick={() => { showSaved(); onOpenRigPicker?.(); }}
              disabled={locked || !powered}
              style={{
                ...btn,
                width: '100%', textAlign: 'left', justifyContent: 'flex-start',
                opacity: (locked || !powered) ? 0.55 : 1,
                cursor: (locked || !powered) ? 'not-allowed' : 'pointer',
              }}
              title={rigLabel || 'Change radio preset'}
            >{rigShort || rigLabel || '(no rig)'}</button>
          </div>
        </div>

        <div className="rm-row" style={{ '--i': 1 }}>
          <span className="rm-lb" style={rowLabelStyle}>PTT key</span>
          <div style={rowCtlStyle}>
            <div className={`rm-cap${capturing ? ' rm-armed' : ''}${capState === 'bad' ? ' rm-bad' : ''}${capState === 'got' ? ' rm-got' : ''}`}>
              {capturing && !capLabel ? (
                <span style={{ color: 'var(--cyan)', fontWeight: 600, letterSpacing: '0.04em' }}>
                  Press a key…
                </span>
              ) : (
                <span className="rm-key" style={{
                  display: 'inline-grid', placeItems: 'center',
                  minWidth: 22, height: 20, padding: '0 6px',
                  borderRadius: 4, border: '1px solid var(--rim1)',
                  background: 'var(--bg0)', color: 'var(--cyan)',
                  font: '700 11px Inter',
                }}>{capLabel || (pttKey ? String(pttKey).toUpperCase() : '—')}</span>
              )}
            </div>
            <button
              onClick={() => {
                if (capturing) { stopCapture(true); return; }
                setCapturing(true);
                setCapState(null);
                setCapLabel(null);
              }}
              disabled={!powered}
              style={{ ...btn, opacity: !powered ? 0.55 : 1, cursor: !powered ? 'not-allowed' : 'pointer' }}
              title={capturing ? 'Cancel' : 'Click, then press a key'}
            >{capturing ? 'Cancel' : 'Change'}</button>
          </div>
        </div>

        <div className="rm-row" style={{ '--i': 2 }}>
          <span className="rm-lb" style={rowLabelStyle}>Lock tuner</span>
          <div style={rowCtlStyle}>
            <span className="rm-val" style={{ color: 'var(--fg2)', minWidth: 62, textAlign: 'right' }}>
              {locked ? 'Locked' : 'Unlocked'}
            </span>
            <button
              className="rm-sw"
              role="switch"
              aria-checked={locked}
              aria-label="Lock tuner"
              disabled={!powered}
              onClick={() => { onLockToggle?.(); showSaved(); }}
            />
          </div>
        </div>

        <div className="rm-row rm-foot" style={{ '--i': 5 }}>
          {onOpenSettings && (
            <button
              onClick={() => { closeCfg(); onOpenSettings(); }}
              style={{
                ...btn,
                background: 'none', borderColor: 'var(--rim0)', boxShadow: 'none',
                color: 'var(--fg2)',
              }}
              title="Open the full voice-profile editor"
            >Voice profile…</button>
          )}
          <span className={`rm-saved${savedShow ? ' rm-show' : ''}`} aria-live="polite">
            <span style={{ color: 'inherit' }}>✓</span> Saved
          </span>
          <button
            onClick={closeCfg}
            style={{ ...goBtn }}
            title="Close settings"
          >Done</button>
        </div>
      </div>
      {/* /rm-back */}

      </div>
      {/* /rm-faces */}
    </div>
  );
}

// Settings row layout helpers — shared between the three rows on the back face.
const rowLabelStyle = {
  flex: '0 0 88px',
  whiteSpace: 'nowrap',
  font: '700 10px Inter',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--fg2)',
};
const rowCtlStyle = {
  flex: 1, minWidth: 0,
  display: 'flex', alignItems: 'center', gap: 8,
  justifyContent: 'flex-end',
};
