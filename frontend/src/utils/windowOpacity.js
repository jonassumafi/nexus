// Single source of truth for floating-window opacity — currently Global
// Chat (popover + popout). Both the chat's own slider and the main
// Settings-panel slider read/write this value and subscribe to its
// changes, so flipping either one moves the other live.
//
// Stored as a float 0.25–1.0 in localStorage (`nexus_window_opacity`).
// Missing / invalid / out-of-range values fall back to 1.0 (fully
// opaque) — the spec requires a safe default rather than silently
// keeping a value the user can't see through.

const KEY = 'nexus_window_opacity';
const EVENT = 'nexus:window-opacity-changed';
const MIN = 0.25;
const MAX = 1.0;
const DEFAULT = 1.0;

export const WINDOW_OPACITY_MIN = MIN;
export const WINDOW_OPACITY_MAX = MAX;
export const WINDOW_OPACITY_DEFAULT = DEFAULT;

export function readWindowOpacity() {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (!Number.isFinite(v) || v < MIN || v > MAX) return DEFAULT;
    return v;
  } catch { return DEFAULT; }
}

export function writeWindowOpacity(v) {
  const clamped = Math.max(MIN, Math.min(MAX, Number(v) || DEFAULT));
  try { localStorage.setItem(KEY, String(clamped)); } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { value: clamped } }));
  } catch {}
  return clamped;
}

export function resetWindowOpacity() {
  return writeWindowOpacity(DEFAULT);
}

export function onWindowOpacityChange(fn) {
  const handler = (e) => {
    const v = Number(e?.detail?.value);
    if (Number.isFinite(v)) { try { fn(v); } catch {} }
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
