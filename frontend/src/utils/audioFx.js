// Centralized audio-cue helpers. One place to change what we play
// for radio-chrome interactions so every mode (full dashboard,
// companion, radio-only) sounds the same.
//
// All functions silently swallow playback rejections — unauthorized
// autoplay or missing-file errors never bubble to the UI.

const TUNE_CLIPS = ['tune_1','tune_2','tune_3','tune_4','tune_5','tune_6'];

function _play(path, { volume = 1 } = {}) {
  try {
    const a = new Audio(path);
    a.volume = volume;
    a.play().catch(() => {});
    return a;
  } catch { return null; }
}

/** Random mechanical "tune" click — matches the Nexus website behavior
 *  of playing one of six variants on each digit entered. Rate-limited
 *  so holding a key down doesn't stack a dozen overlapping clips. */
let _lastTune = 0;
export function playTune() {
  const now = Date.now();
  if (now - _lastTune < 60) return; // rate-limit at ~16Hz
  _lastTune = now;
  const pick = TUNE_CLIPS[Math.floor(Math.random() * TUNE_CLIPS.length)];
  _play(`/sounds/${pick}.mp3`, { volume: 0.9 });
}

/** PTT press — the "transmitting" open-key cue. */
export function playTransmit() { _play('/sounds/transmitting.mp3'); }

/** Mute toggled on. */
export function playMute()     { _play('/sounds/mute_mic.mp3'); }

/** Mute toggled off. */
export function playUnmute()   { _play('/sounds/unmute_mic.mp3'); }

/** Successfully tuned onto a frequency. Already wired inside the
 *  radio hook on joinFrequency() — exported here so other UI can use
 *  it if desired. */
export function playFreqConnect()    { _play('/sounds/freq_connect.mp3'); }
export function playFreqDisconnect() { _play('/sounds/freq_disconnect.mp3'); }

// ─── DM cues (synthesized; no asset files) ────────────────────────────
// Short two-tone blips so sending feels different from receiving
// without introducing new audio dependencies. Send is a quiet
// ascending blip; receive is a slightly louder descending chime.
let _actx = null;
function _getCtx() {
  if (typeof window === 'undefined') return null;
  try {
    if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
    if (_actx.state === 'suspended') _actx.resume().catch(() => {});
    return _actx;
  } catch { return null; }
}
function _blip(freqs, { gain = 0.08, dur = 0.09, gap = 0.07, type = 'sine' } = {}) {
  const ctx = _getCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    const start = t0 + i * gap;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(ctx.destination);
    o.start(start);
    o.stop(start + dur + 0.02);
  });
}
/** Short ascending blip for DM send. */
export function playDmSend()    { _blip([660, 990],  { gain: 0.06, dur: 0.08, gap: 0.06 }); }
/** Softer descending chime for DM receive. */
export function playDmReceive() { _blip([1180, 820], { gain: 0.09, dur: 0.11, gap: 0.08, type: 'triangle' }); }
