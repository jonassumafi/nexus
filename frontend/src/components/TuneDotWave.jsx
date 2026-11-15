// Tune-confirmation visual: a soft Gaussian swell of tiny dots that
// rolls left-to-right across the host element (the radio glass). Pure
// overlay — pointer-events none, sits behind the digits. The digits
// themselves are never touched by this component.
//
// Hooked via the `trigger` prop. Each time trigger changes (and it is
// truthy), the swell plays once. A new trigger while a swell is in
// flight cancels the current animation and restarts. Respects
// prefers-reduced-motion by doing nothing.
//
// Parent must be position:relative so inset:0 lands on its box. If
// the parent has a border-radius, give it overflow:hidden too so the
// dots at the corners are clipped to the rounded edge.
//
// Spec: nexus_tune_dot_matrix_reference.html
//   • 10 px grid spacing
//   • Gaussian swell width = 14 % of glass width
//   • Swell travels from -40 px to W+40 px over 900 ms
//   • Peak dot radius ~2.1 px, peak opacity ~0.55 at the swell center
//   • Fill color: var(--acc2) — follows every skin.

import { useEffect, useRef } from 'react';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DURATION_MS = 900;
const SPACING_PX = 10;
const PEAK_R = 2.1;
const PEAK_OPACITY = 0.55;

function reducedMotion() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

export default function TuneDotWave({ trigger }) {
  const svgRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    // trigger=0 (initial) never plays — only rising edges from caller.
    if (!trigger) return;

    const svg = svgRef.current;
    if (!svg) return;

    // Cancel anything in flight, clear whatever's left on screen.
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    svg.innerHTML = '';

    if (reducedMotion()) return;

    const parent = svg.parentElement;
    if (!parent) return;
    const W = parent.clientWidth;
    const H = parent.clientHeight;
    if (W <= 0 || H <= 0) return;

    const cols = Math.max(2, Math.round(W / SPACING_PX));
    const rows = Math.max(2, Math.round(H / SPACING_PX));
    const sg = W * 0.14; // Gaussian sigma

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width',  W);
    svg.setAttribute('height', H);

    // Lay out the dot grid once.
    const circles = new Array(cols * rows);
    const xs      = new Array(cols);
    for (let c = 0; c < cols; c++) xs[c] = ((c + 0.5) * W) / cols;
    const frag = document.createDocumentFragment();
    for (let r = 0; r < rows; r++) {
      const cy = (((r + 0.5) * H) / rows).toFixed(1);
      for (let c = 0; c < cols; c++) {
        const circ = document.createElementNS(SVG_NS, 'circle');
        circ.setAttribute('cx', xs[c].toFixed(1));
        circ.setAttribute('cy', cy);
        circ.setAttribute('r', '0');
        circles[r * cols + c] = circ;
        frag.appendChild(circ);
      }
    }
    svg.appendChild(frag);

    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / DURATION_MS);
      // Swell center sweeps from -40 px to W+40 px.
      const cx = -40 + k * (W + 80);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const g = Math.exp(-Math.pow((xs[c] - cx) / sg, 2));
          const el = circles[r * cols + c];
          el.setAttribute('r', (g * PEAK_R).toFixed(2));
          el.style.opacity = (g * PEAK_OPACITY).toFixed(2);
        }
      }
      if (k < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Done. Clear the overlay — nothing stays at rest.
        svg.innerHTML = '';
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try { svg.innerHTML = ''; } catch {}
    };
  }, [trigger]);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        fill: 'var(--acc2, #00EEFF)',
        overflow: 'hidden',
      }}
    />
  );
}
