// Keystroke sound effect — plays a tiny random slice of /sounds/typing.mp3
// per keypress so the chat input has a subtle mechanical-keyboard texture.
//
// Design:
//   • One shared AudioContext, lazily created on first use.
//   • Full typing.mp3 buffer fetched + decoded once per page load, cached.
//   • Each keystroke picks a random start offset inside the buffer and
//     plays ~60–100 ms with a quick fade-out, so adjacent keystrokes feel
//     like different individual key clacks rather than a continuous drone.
//   • Rate-limited to one keystroke per ~30 ms so a held key doesn't
//     machine-gun the audio.
//   • If decode fails or the buffer isn't loaded yet, playKeystroke is a
//     silent no-op — never throws.

const SRC = '/sounds/typing.mp3';
const MIN_SLICE_MS = 60;
const MAX_SLICE_MS = 110;
const FADE_MS      = 20;
const GAIN         = 0.35;    // subtle; sits under the chat UI, not foreground
const RATE_LIMIT_MS = 30;

let ctx = null;
let bufferPromise = null;
let lastPlayedAt = 0;

function getCtx() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  return ctx;
}

async function ensureBuffer() {
  if (bufferPromise) return bufferPromise;
  const c = getCtx();
  if (!c) return null;
  bufferPromise = (async () => {
    try {
      const resp = await fetch(SRC);
      if (!resp.ok) throw new Error('http ' + resp.status);
      const arr = await resp.arrayBuffer();
      return await c.decodeAudioData(arr);
    } catch (err) {
      console.warn('[keystrokeSfx] load failed, keystroke sounds disabled:', err?.message);
      return null;
    }
  })();
  return bufferPromise;
}

export function playKeystroke() {
  const now = Date.now();
  if (now - lastPlayedAt < RATE_LIMIT_MS) return;
  lastPlayedAt = now;
  const c = getCtx();
  if (!c) return;
  ensureBuffer().then(buf => {
    if (!buf) return;
    try {
      if (c.state === 'suspended') c.resume().catch(() => {});
      const sliceSec = (MIN_SLICE_MS + Math.random() * (MAX_SLICE_MS - MIN_SLICE_MS)) / 1000;
      const safeMax = Math.max(0, buf.duration - sliceSec - 0.01);
      const startOffset = Math.random() * safeMax;

      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      const t0 = c.currentTime;
      // Attack is instant; fade out over FADE_MS so clipped slice boundaries
      // never leave an audible edge click.
      g.gain.setValueAtTime(GAIN, t0);
      g.gain.setValueAtTime(GAIN, t0 + sliceSec - FADE_MS / 1000);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + sliceSec);

      src.connect(g);
      g.connect(c.destination);
      src.start(t0, startOffset, sliceSec);
      src.onended = () => {
        try { src.disconnect(); g.disconnect(); } catch {}
      };
    } catch { /* non-fatal */ }
  });
}

// Preload call — optional. Chat opens → call this so the first keystroke
// doesn't eat the fetch+decode latency.
export function preloadKeystroke() { ensureBuffer(); }
