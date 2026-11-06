// Pre-SRS stage — SRS parity. Does NOTHING to the voice signal.
//
// SRS has no per-player voice character: every operator on the same radio
// model sounds the same, shaped only by that radio's txEffect chain.
// Earlier versions of this file added per-player white noise (static_level)
// and a per-player pitch shift. Both were removed to match SRS behavior
// after friends reported extra noise coming through from Nexus clients
// that doesn't come through from SRS clients.
//
// What remains:
//   source → mixer ← click buffer (on PTT key up / down)
//
// The mixer exists so PTT click samples can be injected into the outbound
// stream and travel through the downstream SRS tx chain alongside the
// voice. The mic signal otherwise passes straight through at unity gain.
//
// Public API unchanged so useRadioConnection / useCommandTunerRx keep
// working: { output, playClick, setParam, setProfile, dispose }.
// setParam / setProfile are now no-ops — there is nothing to tune on
// this stage. Values are accepted and ignored for backward compat with
// callers that still pass a voice profile.

export async function buildSpacesuitChain(audioContext, sourceNode, profile) {
  // profile is intentionally ignored — see file header.

  const mixer = audioContext.createGain();
  mixer.gain.value = 1.0;

  // Pass-through: mic goes straight into the mixer at unity gain.
  sourceNode.connect(mixer);

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

  const setParam = () => {
    // No tunable parameters on this stage after SRS-parity rewrite.
  };

  const setProfile = () => {
    // Nothing to update.
  };

  const dispose = () => {
    try { sourceNode.disconnect(); } catch {}
    try { mixer.disconnect(); } catch {}
  };

  return { output: mixer, playClick, setParam, setProfile, dispose };
}

// Backward-compat exports — callers (RadioPanel settings, pre-existing
// voice-profile persistence) still reference these. They now return
// neutral/empty values that have no audible effect.
export function randomVoiceProfile() {
  return {
    pitch_shift:  0,
    static_level: 0,
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
  static_level:   { min: 0,     max: 0,     step: 0.001, default: 0      },
  highpass:       { min: 100,   max: 800,   step: 1,     default: 350    },
  lowpass:        { min: 800,   max: 8000,  step: 1,     default: 3250   },
  resonance_freq: { min: 1000,  max: 2000,  step: 1,     default: 1500   },
  resonance_q:    { min: 1.5,   max: 12,    step: 0.1,   default: 3.0    },
  distortion:     { min: 0,     max: 0,     step: 1,     default: 0      },
  bit_crush:      { min: 16,    max: 16,    step: 1,     default: 16     },
};

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
