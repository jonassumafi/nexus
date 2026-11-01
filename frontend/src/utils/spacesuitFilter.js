// Web Audio chain that simulates a spacesuit/helmet radio:
//   source → pitchShifter → highpass → lowpass → peaking (resonance)
//          → waveshaper (distortion) → bitCrusher
//          → mixer ← static-noise gain
//                  ← click buffer (on demand)
//
// Returns { output, playClick, setParam, setProfile, dispose }.

// AudioWorklet module registrations are idempotent on the same AudioContext,
// so calling addModule on each chain build is safe. Modules ship from
// public/worklets and are served at these absolute paths.
const PITCH_WORKLET_URL = '/worklets/pitch_shifter.js';
const BIT_WORKLET_URL   = '/worklets/bit_crusher.js';

async function ensureWorkletsLoaded(ctx) {
  await Promise.all([
    ctx.audioWorklet.addModule(PITCH_WORKLET_URL),
    ctx.audioWorklet.addModule(BIT_WORKLET_URL),
  ]);
}

function createPitchShifterNode(ctx, initSemitones) {
  const node = new AudioWorkletNode(ctx, 'pitch-shifter');
  node.port.postMessage({ semitones: initSemitones || 0 });
  return {
    node,
    setRate: (st) => node.port.postMessage({ semitones: st || 0 }),
  };
}

function createBitCrusherNode(ctx, initBits) {
  const node = new AudioWorkletNode(ctx, 'bit-crusher');
  node.port.postMessage({ bitDepth: initBits != null ? initBits : 16 });
  return {
    node,
    setBits: (b) => node.port.postMessage({ bitDepth: b }),
  };
}

export async function buildSpacesuitChain(audioContext, sourceNode, profile) {
  const p = withDefaults(profile);

  await ensureWorkletsLoaded(audioContext);

  const { node: pitchNode, setRate } = createPitchShifterNode(audioContext, p.pitch_shift);
  const { node: bitNode, setBits }   = createBitCrusherNode(audioContext, p.bit_crush);

  const highpass = audioContext.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = p.highpass;

  const lowpass = audioContext.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = p.lowpass;

  const resonance = audioContext.createBiquadFilter();
  resonance.type = 'peaking';
  resonance.frequency.value = p.resonance_freq;
  resonance.Q.value = p.resonance_q;
  resonance.gain.value = 6;

  const distortion = audioContext.createWaveShaper();
  distortion.curve = makeDistortionCurve(p.distortion);
  distortion.oversample = '4x';

  const mixer = audioContext.createGain();
  // v1.1.5 — outbound makeup bumped 2.0 → 2.8 (+9 dB from unity).
  // Users reported voice sitting too faint under the squelch bed even
  // with mic sensitivity at 150 %. The bitcrusher downstream soft-
  // saturates anything that would otherwise clip, so this is safe.
  mixer.gain.value = 2.8;

  const noiseSource = createWhiteNoiseSource(audioContext);
  const noiseGain = audioContext.createGain();
  noiseGain.gain.value = p.static_level;
  noiseSource.connect(noiseGain);
  noiseGain.connect(mixer);

  // source → pitch → highpass → lowpass → resonance → distortion → bitCrush → mixer
  sourceNode.connect(pitchNode);
  pitchNode.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(resonance);
  resonance.connect(distortion);
  distortion.connect(bitNode);
  bitNode.connect(mixer);

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

  let lastDistortion = p.distortion;
  const SMOOTH = 0.01;
  const setParam = (field, value) => {
    if (value == null || isNaN(value)) return;
    const v = Number(value);
    const now = audioContext.currentTime;
    switch (field) {
      case 'highpass':
        highpass.frequency.setTargetAtTime(v, now, SMOOTH);
        break;
      case 'lowpass':
        lowpass.frequency.setTargetAtTime(v, now, SMOOTH);
        break;
      case 'resonance_freq':
        resonance.frequency.setTargetAtTime(v, now, SMOOTH);
        break;
      case 'resonance_q':
        resonance.Q.setTargetAtTime(v, now, SMOOTH);
        break;
      case 'static_level':
        noiseGain.gain.setTargetAtTime(v, now, SMOOTH);
        break;
      case 'distortion':
        if (Math.abs(v - lastDistortion) > 0.001) {
          distortion.curve = makeDistortionCurve(v);
          lastDistortion = v;
        }
        break;
      case 'pitch_shift':
        setRate(v);
        break;
      case 'bit_crush':
        setBits(v);
        break;
      default:
        // unknown field — ignore
    }
  };

  const setProfile = (newProfile) => {
    const np = withDefaults(newProfile);
    setParam('highpass',       np.highpass);
    setParam('lowpass',        np.lowpass);
    setParam('resonance_freq', np.resonance_freq);
    setParam('resonance_q',    np.resonance_q);
    setParam('static_level',   np.static_level);
    setParam('distortion',     np.distortion);
    setParam('pitch_shift',    np.pitch_shift);
    setParam('bit_crush',      np.bit_crush);
  };

  const dispose = () => {
    try { sourceNode.disconnect(); } catch {}
    try { pitchNode.disconnect(); } catch {}
    try { highpass.disconnect(); } catch {}
    try { lowpass.disconnect(); } catch {}
    try { resonance.disconnect(); } catch {}
    try { distortion.disconnect(); } catch {}
    try { bitNode.disconnect(); } catch {}
    try { noiseSource.stop(); } catch {}
    try { noiseSource.disconnect(); } catch {}
    try { noiseGain.disconnect(); } catch {}
    try { mixer.disconnect(); } catch {}
  };

  return { output: mixer, playClick, setParam, setProfile, dispose };
}

export function randomVoiceProfile() {
  return {
    highpass:       randIntInRange(200, 500),
    lowpass:        randIntInRange(2500, 4000),
    resonance_freq: randIntInRange(1000, 2000),
    resonance_q:    round(randInRange(1.5, 4.5), 1),
    distortion:     randIntInRange(5, 30),
    static_level:   round(randInRange(0.003, 0.012), 3),
    pitch_shift:    0,
    bit_crush:      16,
  };
}

export const VOICE_PROFILE_RANGES = {
  highpass:       { min: 100,   max: 800,   step: 1,     default: 350    },
  lowpass:        { min: 800,   max: 8000,  step: 1,     default: 3250   },
  resonance_freq: { min: 1000,  max: 2000,  step: 1,     default: 1500   },
  resonance_q:    { min: 1.5,   max: 12,    step: 0.1,   default: 3.0    },
  distortion:     { min: 5,     max: 80,    step: 1,     default: 17     },
  static_level:   { min: 0.003, max: 0.05,  step: 0.001, default: 0.0075 },
  pitch_shift:    { min: -4,    max: 4,     step: 0.1,   default: 0      },
  bit_crush:      { min: 4,     max: 16,    step: 1,     default: 16     },
};

function withDefaults(profile) {
  const r = VOICE_PROFILE_RANGES;
  const v = (k) => {
    const def = r[k].default ?? (r[k].min + r[k].max) / 2;
    return (profile && profile[k] != null && !isNaN(profile[k])) ? Number(profile[k]) : def;
  };
  return {
    highpass:       v('highpass'),
    lowpass:        v('lowpass'),
    resonance_freq: v('resonance_freq'),
    resonance_q:    v('resonance_q'),
    distortion:     v('distortion'),
    static_level:   v('static_level'),
    pitch_shift:    v('pitch_shift'),
    bit_crush:      v('bit_crush'),
  };
}

function makeDistortionCurve(amount) {
  const n = 4096;
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;
  const a = Math.max(0, Number(amount) || 0);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + a) * x * 20 * deg) / (Math.PI + a * Math.abs(x));
  }
  return curve;
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
function randIntInRange(min, max) { return Math.floor(randInRange(min, max + 1)); }
function round(n, decimals) { const f = Math.pow(10, decimals); return Math.round(n * f) / f; }
