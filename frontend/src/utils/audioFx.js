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
