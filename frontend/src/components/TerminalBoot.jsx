// Shared boot terminal (treatment A — tinted phosphor). Renders the .term.A
// chrome from global.css: staggered phase rows with [...] bars, OK/READY
// chips, scanline overlay, trailing cursor. Each caller supplies content
// and owns its own audio via onPhaseChange — this component is sequencing
// and visuals only.

import { useState, useEffect, useRef } from 'react';

const DIVIDER = '─'.repeat(45);
const DOTS    = '.'.repeat(20);

export default function TerminalBoot({
  title,
  subtitle,
  operatorLine,
  phases = [],
  phaseDelay = 700,
  finalLine,
  onPhaseChange,
  onComplete,
  completeDelay = 3000,
  width = 700,
  awaitingLabel = 'AWAITING INPUT',
  readyLabel    = 'TERMINAL READY',
  loadingLabel  = 'TERMINAL LOADING',
}) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [showFinal, setShowFinal]       = useState(false);

  const tids             = useRef([]);
  const cancelledRef     = useRef(false);
  const onPhaseChangeRef = useRef(onPhaseChange);
  const onCompleteRef    = useRef(onComplete);

  useEffect(() => { onPhaseChangeRef.current = onPhaseChange; }, [onPhaseChange]);
  useEffect(() => { onCompleteRef.current    = onComplete;    }, [onComplete]);

  useEffect(() => {
    cancelledRef.current = false;
    phases.forEach((_, idx) => {
      const id = setTimeout(() => {
        if (cancelledRef.current) return;
        setVisibleCount(idx + 1);
        try { onPhaseChangeRef.current?.(idx); } catch {}
      }, idx * phaseDelay);
      tids.current.push(id);
    });

    const finalAt = phases.length * phaseDelay + 400;
    const idFinal = setTimeout(() => {
      if (cancelledRef.current) return;
      setShowFinal(true);
      const idDone = setTimeout(() => {
        if (cancelledRef.current) return;
        try { onCompleteRef.current?.(); } catch {}
      }, completeDelay);
      tids.current.push(idDone);
    }, finalAt);
    tids.current.push(idFinal);

    return () => {
      cancelledRef.current = true;
      tids.current.forEach(clearTimeout);
      tids.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="term A" style={{ width, padding: '28px 32px' }}>
      {/* Terminal title glyph per logo_e_spec section 6 — "[>_]" in the
          bright accent before the screen title, since the glyph is the
          mark's own shape rendered as text inside a monospace terminal. */}
      {title && <span className="ln hd">[&gt;_]&nbsp;{title}</span>}
      {(title || subtitle) && (
        <span className="ln"><span className="rule">{DIVIDER}</span></span>
      )}
      {subtitle && <span className="ln op">{subtitle}</span>}
      {operatorLine && <span className="ln op">{operatorLine}</span>}
      {(subtitle || operatorLine) && <span className="ln">&nbsp;</span>}

      {phases.slice(0, visibleCount).map((p, i) => (
        <span key={i} className="ln st">
          <span className="lb">{p.label}</span>
          <span>
            <span className="br">[</span>
            <span className="dots filled">{DOTS}</span>
            <span className="br">]</span>
          </span>
          <span className={p.status === 'OK' ? 'ok' : 'rdy'}>
            {p.status !== 'OK' && <span className="led" />}
            {p.status}
          </span>
        </span>
      ))}

      <span className="ln"><span className="rule">{DIVIDER}</span></span>
      <span className="ln pr">
        &gt; {visibleCount >= phases.length ? readyLabel : loadingLabel}
      </span>
      {showFinal && finalLine
        ? <span className="ln pr">{finalLine}</span>
        : <span className="ln pr">&gt; {awaitingLabel}<span className="cur" /></span>}
    </div>
  );
}
