// Single-color line symbols for each radio profile, shown only in the
// Radio type picker (row tile + Current-rig header). Keyed by the
// backend profile id (backend/services/radioModels.js), with name
// cross-reference comments against radio_symbols_spec.html.
//
// Drawing rules (from the spec):
//   • 24 unit viewBox, 1.7 stroke, round caps + joins
//   • No fills except small accent dots (fill="currentColor")
//   • All strokes/fills use currentColor so the caller picks the color
//     via `color: var(--acc2)` (or amber for the mockup header, etc.)
//   • 20 px in picker rows, 22 px in the Current-rig header
//   • Static — no animation, no hover effect
//
// Mapping is by backend id. The spec names its symbols by player-facing
// product code (VX-51, KR-828, etc.) which is just META[id].label on
// the backend. We key here on the stable backend id so a label rename
// doesn't orphan a symbol.
//
// Profiles without a symbol fall through to <SymbolFallback/> — a
// dashed-circle placeholder. The five "Legacy" family entries
// (arc5, fug16zy, r1155, scr522a, t1154) are in that bucket today
// because the spec covers 20 profiles and the app ships 25.

import React from 'react';

/**
 * Inline path strings. Kept as plain strings (not JSX) so the catalog
 * is cheap to load and easy to diff against the spec's Icon source.
 */
const PATHS = {
  // ── Personal / Handheld ────────────────────────────────────────────
  // VX-131 Transit — two forward chevrons for a short hop, always moving
  arc131: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
  // VX-27 Scoutlink — crosshair for a tight scouting link
  arc27:
    '<circle cx="12" cy="12" r="6.5"/>' +
    '<path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>' +
    '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  // VX-51 Fieldmaster — field tent
  arc51: '<path d="M3 19.5L12 5l9 14.5zM9.5 19.5L12 14l2.5 5.5"/>',
  // KR-852 Steppe — sun on a flat, dry horizon
  r852:
    '<path d="M3 18h18M6.5 18a5.5 5.5 0 0 1 11 0M12 6v2.5M4.5 9.5L6.3 11M19.5 9.5L17.7 11"/>',
  // KR-6K Veteran — service stripes for the old hand
  rsi6k: '<path d="M5 9l7-5 7 5M5 14l7-5 7 5M5 19l7-5 7 5"/>',

  // ── Ship-fit ───────────────────────────────────────────────────────
  // VX-134 Patrol — shield for the patrol class
  arc134: '<path d="M12 3l7.5 3v6c0 4.6-3.2 7.6-7.5 9-4.3-1.4-7.5-4.4-7.5-9V6z"/>',
  // UV-164 Guard — waves pushing outward on a guard channel
  arc164:
    '<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>' +
    '<path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 5.5a9.2 9.2 0 0 1 0 13"/>',
  // VX-186 Hauler — cargo crate
  arc186: '<path d="M3 7.5L12 3.5l9 4v9l-9 4-9-4zM3 7.5l9 4 9-4M12 11.5v9"/>',
  // DX-201 Secure — key for crypto discipline
  arc201d:
    '<circle cx="7.5" cy="12" r="3.8"/>' +
    '<path d="M11.3 12H21M17.5 12v3.5M14.5 12v2.5"/>',
  // KR-5 Baklan — five-point star for the Soviet pattern
  baklan5: '<path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z"/>',
  // KR-1A Jadro — atom, since jadro means core
  jadro1a:
    '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>' +
    '<ellipse cx="12" cy="12" rx="9" ry="3.6"/>' +
    '<ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/>' +
    '<ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/>',
  // KR-800 Flight — paper plane for the flight standard
  r800: '<path d="M21 3.5L3 10.5l7 2.8 2.8 7.2zM10 13.3L21 3.5"/>',
  // KR-828 Line — two points joined by a straight line
  r828:
    '<circle cx="5" cy="12" r="2.2"/>' +
    '<circle cx="19" cy="12" r="2.2"/>' +
    '<path d="M7.2 12h9.6"/>',
  // KR-832M Military — clipped square wave for deliberate saturation
  r832m: '<path d="M2.5 12H6V6h3.5v12H13V6h3.5v12H20v-6h1.5"/>',
  // KR-862 Scout — eye for bright articulation
  r862: '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  // KR-863 Patrol — radar sweep
  r863:
    '<circle cx="12" cy="12" r="9"/>' +
    '<circle cx="12" cy="12" r="4.5"/>' +
    '<path d="M12 12l6.5-6.5"/>' +
    '<circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  // KR-864 Border — picket fence line for border service
  r864:
    '<path d="M4 20V8l2-2 2 2v12M10 20V8l2-2 2 2v12M16 20V8l2-2 2 2v12M3 12h18M3 16h18"/>',

  // ── Broadcast ──────────────────────────────────────────────────────
  // MX-210 Interop — two overlapping rings for multi-band interop
  arc210: '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>',
  // MX-220 Datalink — opposed arrows for two-way data
  arc220: '<path d="M4 8h15M15.5 4.5L19 8l-3.5 3.5M20 16H5M8.5 12.5L5 16l3.5 3.5"/>',
  // MX-222 Dispatch — headset for dispatch
  arc222:
    '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/>' +
    '<rect x="3.5" y="13.5" width="4" height="6" rx="1.5"/>' +
    '<rect x="16.5" y="13.5" width="4" height="6" rx="1.5"/>' +
    '<path d="M20 19.5c0 1.8-1.8 2.5-5 2.5"/>',
};

const COMMON_SVG_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

/**
 * Renders the symbol for `id` at `size` px. Color is inherited from
 * `color` on the parent (the caller should set `color: var(--acc2)`).
 * Returns the dashed-circle fallback when no symbol is defined.
 */
export default function RadioSymbol({ id, size = 20, className, style }) {
  const inner = PATHS[id];
  if (!inner) return <SymbolFallback size={size} className={className} style={style} />;
  return (
    <svg
      {...COMMON_SVG_PROPS}
      width={size}
      height={size}
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

/** Dashed circle for profiles without a dedicated symbol. */
export function SymbolFallback({ size = 20, className, style }) {
  return (
    <svg
      {...COMMON_SVG_PROPS}
      width={size}
      height={size}
      className={className}
      style={style}
    >
      <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
    </svg>
  );
}

/** Whether the picker has a dedicated symbol for this profile id. */
export function hasSymbol(id) {
  return Object.prototype.hasOwnProperty.call(PATHS, id);
}
