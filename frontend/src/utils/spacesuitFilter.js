// Minimal pre-SRS stage, matching SRS's architecture: the radio model's
// txEffect chain (built downstream in useRadioConnection via srsChain.js)
// does all voice character shaping. This file is intentionally thin so it
// doesn't double-filter the signal before SRS gets to it — a prior design
// stacked a full HP/LP/peak/distortion/bitcrush chain here, which combined
// with the SRS tx chain and the listener's rx chain to filter voices into
// inaudibility.
//
// What remains:
//   source → pitchShifter → mixer ← baked-in noise (per-player static_level)
//                                 ← click buffer (on demand)
//
// Per-player variation is now:
//   - pitch_shift   : non-destructive, just raises/lowers formants
//   - static_level  : the hiss volume baked into their transmission
// All other character comes from the operator's assigned SRS radio model
// (ARC-164, Jadro-1A, intercom, etc.), applied downstream.
//
// Public API unchanged from previous versions so useRadioConnection keeps
// working: { output, playClick, setParam, setProfile, dispose }. setParam
// legacy fields that used to drive filters are now intentional no-ops.

const PITCH_WORKLET_URL = '/worklets/pitch_shifter.js';

async function ensureWorkletsLoaded(ctx) {
  await ctx.audioWorklet.addModule(PITCH_WORKLET_URL);
}

function createPitchShifterNode(ctx, initSemitones) {
  const node = new AudioWorkletNode(ctx, 'pitch-shifter');
  node.port.postMessage({ semitones: initSemitones || 0 });
  return {
    node,
    setRate: (st) => node.port.postMessage({ semitones: st || 0 }),
  };
}

export async function buildSpacesuitChain(audioContext, sourceNode, profile) {
  const p = withDefaults(profile);

  await ensureWorkletsLoaded(audioContext);

  const { node: pitchNode, setRate } = createPitchShifterNode(audioContext, p.pitch_shift);

  const mixer = audioContext.createGain();
  mixer.gain.value = 1.0;

  const noiseSource = createWhiteNoiseSource(audioContext);
  const noiseGain = audioContext.createGain();
  noiseGain.gain.value = p.static_level;
  noiseSource.connect(noiseGain);
  noiseGain.connect(mixer);

  // source → pitch → mixer
  sourceNode.connect(pitchNode);
  pitchNode.connect(mixer);

  const playClick = (type) => {
    const buf = makeClickBuffer(audioContext, type);
    const src = audioContext.createBufferSource();
    src.buffer = buf;
    const g = audioContext.createGain();
    g.gain.value = 0.55;
    src.connect(g);
    g.connect(mixer);
    src.start();
    src.stop(audioContext.currentTime + buf.duration + 0.02);
  };

  const SMOOTH = 0.01;
  const setParam = (field, value) => {
    if (value == null || isNaN(value)) return;
    const v = Number(value);
    const now = audioContext.currentTime;
    switch (field) {
      case 'static_level':
        noiseGain.gain.setTargetAtTime(v, now, SMOOTH);
        break;
      case 'pitch_shift':
        setRate(v);
        break;
      case 'highpass':
      case 'lowpass':
      case 'resonance_freq':
      case 'resonance_q':
      case 'distortion':
      case 'bit_crush':
        // Legacy fields — voice character now comes from the SRS radio
        // model chain downstream, not from this stage. Intentionally no-op.
        break;
      default:
        // unknown field — ignore
    }
  };

  const setProfile = (newProfile) => {
    const np = withDefaults(newProfile);
    setParam('static_level', np.static_level);
    setParam('pitch_shift',  np.pitch_shift);
  };

  const dispose = () => {
    try { sourceNode.disconnect(); } catch {}
    try { pitchNode.disconnect(); } catch {}
    try { noiseSource.stop(); } catch {}
    try { noiseSource.disconnect(); } catch {}
    try { noiseGain.disconnect(); } catch {}
    try { mixer.disconnect(); } catch {}
  };

  return { output: mixer, playClick, setParam, setProfile, dispose };
}

export function randomVoiceProfile() {
  // Per-player variation that doesn't fight the SRS chain downstream.
  return {
    pitch_shift:  round(randInRange(-1.5, 1.5), 1),
    static_level: round(randInRange(0.004, 0.012), 3),
    // retained for schema compatibility — ignored by the chain
    highpass:       350,
    lowpass:        3250,
    resonance_freq: 1500,
    resonance_q:    3.0,
    distortion:     0,
    bit_crush:      16,
  };
}

export const VOICE_PROFILE_RANGES = {
  pitch_shift:    { min: -4,    max: 4,     step: 0.1,   default: 0      },
  static_level:   { min: 0.001, max: 0.03,  step: 0.001, default: 0.008  },
  // deprecated fields kept for UI compat
  highpass:       { min: 100,   max: 800,   step: 1,     default: 350    },
  lowpass:        { min: 800,   max: 8000,  step: 1,     default: 3250   },
  resonance_freq: { min: 1000,  max: 2000,  step: 1,     default: 1500   },
  resonance_q:    { min: 1.5,   max: 12,    step: 0.1,   default: 3.0    },
  distortion:     { min: 0,     max: 0,     step: 1,     default: 0      },
  bit_crush:      { min: 16,    max: 16,    step: 1,     default: 16     },
};

function withDefaults(profile) {
  const r = VOICE_PROFILE_RANGES;
  const v = (k) => {
    const def = r[k].default ?? (r[k].min + r[k].max) / 2;
    return (profile && profile[k] != null && !isNaN(profile[k])) ? Number(profile[k]) : def;
  };
  return {
    pitch_shift:  v('pitch_shift'),
    static_level: v('static_level'),
  };
}

function createWhiteNoiseSource(audioContext) {
  const bufferSize = audioContext.sampleRate * 2;
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = audioContext.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start(0);
  return src;
}

function makeClickBuffer(audioContext, type) {
  const duration = type === 'close' ? 0.020 : 0.025;
  const sampleRate = audioContext.sampleRate;
  const numSamples = Math.floor(duration * sampleRate);
  const buf = audioContext.createBuffer(1, numSamples, sampleRate);
  const data = buf.getChannelData(0);
  const decayRate = type === 'close' ? 120 : 80;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    data[i] = (Math.random() * 2 - 1) * Math.exp(-t * decayRate) * 0.7;
  }
  return buf;
}

function randInRange(min, max) { return Math.random() * (max - min) + min; }
function round(n, decimals) { const f = Math.pow(10, decimals); return Math.round(n * f) / f; }
