// Nexus prompt mark — brackets + chevron + cursor, per logo_e_spec.html.
// Reads --blue (brackets) and --cyan (chevron + cursor) from the active
// skin, so the mark recolors with every theme automatically.
//
// Props:
//   size     — pixel height. Below 24 px the small-cut geometry is used
//              (thicker strokes, larger cursor) so the mark still reads
//              at favicon sizes.
//   mono     — single-color variant: every stroke uses currentColor.
//   animate  — boot draw-on: brackets 360ms, chevron 220ms @280ms,
//              cursor fades in at 520ms. Total ~600ms. Honors
//              prefers-reduced-motion (skipped, mark shown complete).
//   blink    — cursor blinks at 1050ms (same rate as the terminal block).
//              Defaults to true for the master size, false for small.
//   title    — SVG <title> for a11y. Defaults to "Nexus".
//   style    — passthrough.

import { useEffect, useRef } from 'react';

export default function NexusMark({
  size = 32,
  mono = false,
  animate = false,
  blink,
  title = 'Nexus',
  style,
}) {
  const ref = useRef(null);
  const small = size < 24;
  const doBlink = blink ?? !small;

  // Re-trigger boot draw-on when the `animate` prop goes false → true
  // (supports replay via key change or state flip).
  useEffect(() => {
    if (!animate) return;
    const el = ref.current;
    if (!el) return;
    el.classList.remove('nx-boot');
    void el.offsetWidth;
    el.classList.add('nx-boot');
  }, [animate]);

  const commonSvgProps = {
    ref,
    viewBox: '0 0 64 64',
    width: size,
    height: size,
    role: 'img',
    'aria-label': title,
    className: `nx-mark${doBlink ? ' nx-blink' : ''}${mono ? ' nx-mono' : ''}`,
    style: { display: 'inline-block', flex: 'none', ...style },
  };

  if (small) {
    return (
      <svg {...commonSvgProps}>
        <title>{title}</title>
        <path
          className="nx-bk"
          pathLength="1"
          d="M21 8H8V56H21M43 8H56V56H43"
          fill="none"
          stroke={mono ? 'currentColor' : 'var(--blue)'}
          strokeWidth="7"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        <path
          className="nx-ch"
          pathLength="1"
          d="M22 21L35 32L22 43"
          fill="none"
          stroke={mono ? 'currentColor' : 'var(--cyan)'}
          strokeWidth="7"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        <rect
          className="nx-cur"
          x="37" y="40" width="12" height="7"
          fill={mono ? 'currentColor' : 'var(--cyan)'}
        />
      </svg>
    );
  }

  return (
    <svg {...commonSvgProps}>
      <title>{title}</title>
      <path
        className="nx-bk"
        pathLength="1"
        d="M20 10H9V54H20"
        fill="none"
        stroke={mono ? 'currentColor' : 'var(--blue)'}
        strokeWidth="5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        className="nx-bk"
        pathLength="1"
        d="M44 10H55V54H44"
        fill="none"
        stroke={mono ? 'currentColor' : 'var(--blue)'}
        strokeWidth="5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        className="nx-ch"
        pathLength="1"
        d="M24 22L36 32L24 42"
        fill="none"
        stroke={mono ? 'currentColor' : 'var(--cyan)'}
        strokeWidth="5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <rect
        className="nx-cur"
        x="38" y="40" width="10" height="5"
        fill={mono ? 'currentColor' : 'var(--cyan)'}
      />
    </svg>
  );
}
