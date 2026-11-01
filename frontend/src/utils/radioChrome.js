// DCS-style radio chrome — fully synthesized, no sample files.
//
// Provides four effects attached to the shared AudioContext of the
// current peer session:
//
//   1. Local key-up click      — short *k-chh* when PTT opens
//      Local key-down click    — tail click + brief hiss when PTT closes
//   2. Squelch bed              — persistent low-level pink-noise under any
//                                 active transmission (self or peer). Fades
//                                 in 40 ms on open, out 220 ms on close.
//   6. Channel coloration       — deterministic per-frequency offset applied
//                                 to the outbound filter chain so every
//                                 channel sounds slightly different.
//   7. 80 ms outbound delay     — DelayNode installed on the outbound stream
//                                 so peers receive the mic-open click just
//                                 before voice, matching DCS's keying feel.
//
// One chrome instance per AudioContext. Rebuilds its graph on first use.

const CHROME_BY_CTX = new WeakMap();

export function getRadioChrome(ctx) {
  if (!ctx) return null;
  let rc = CHROME_BY_CTX.get(ctx);
  if (rc) return rc;
  rc = buildChrome(ctx);
  CHROME_BY_CTX.set(ctx, rc);
  return rc;
}

/** Return the outbound 80 ms delay node to insert between the filter chain
 *  output and the MediaStreamDestination. Keep a single node per ctx. */
export function getOutboundDelay(ctx) {
  const rc = getRadioChrome(ctx);
  return rc?.outboundDelay ?? null;
}

/** Deterministic per-channel offset applied on top of the operator's own
 *  voice profile. Hash the frequency string → stable {highpass, lowpass,
 *  resonance_freq, resonance_q, bit_crush} deltas within audible-but-subtle
 *  bounds. Same freq → same color, every time. */
export function channelColor(freqString) {
  const h = hashString(String(freqString || ''));
  const u = (n) => ((h >> (n * 4)) & 0xff) / 0xff; // 0..1 per nibble
  return {
    highpass_delta:       Math.round(u(0) * 120 - 60),  // ±60 Hz
    lowpass_delta:        Math.round(u(1) * 400 - 200), // ±200 Hz
    resonance_freq_delta: Math.round(u(2) * 300 - 150), // ±150 Hz
    resonance_q_delta:    (u(3) * 1.0 - 0.5),           // ±0.5
    bit_crush_delta:      Math.round(u(4) * 2 - 1),     // ±1 bit
  };
}

// ─── Internals ──────────────────────────────────────────────────────────

function buildChrome(ctx) {
  // Local cue bus — plays into speakers only, NOT into the outbound.
  const localBus = ctx.createGain();
  localBus.gain.value = 1;
  localBus.connect(ctx.destination);

  // ── Squelch bed ─────────────────────────────────────────────────────
  // Pink noise source, piped through a 4-pole brick-wall lowpass (two
  // cascaded biquads at the same cutoff ⇒ ~24 dB/octave rolloff). SRS
  // study found the "radio bed" character comes from a steep spectral
  // cliff, not from pink/white tilt — a flat 3.2 kHz biquad reads as
  // "ambient hiss," while a cascaded cliff reads as "VHF channel open."
  const bedBuf = makePinkNoiseBuffer(ctx, 2.0);
  const bedSrc = ctx.createBufferSource();
  bedSrc.buffer = bedBuf;
  bedSrc.loop = true;

  const bedCutA = ctx.createBiquadFilter();
  bedCutA.type = 'lowpass';
  bedCutA.frequency.value = 4500;   // default VHF-ish cutoff
  bedCutA.Q.value = 0.707;          // Butterworth, no resonant peak
  const bedCutB = ctx.createBiquadFilter();
  bedCutB.type = 'lowpass';
  bedCutB.frequency.value = 4500;
  bedCutB.Q.value = 0.707;

  // AM-fade LFO — only engages for channels where the hash picks fade.
  // Modulates an intermediate gain node ±fadeDepth around 1.0 at 1–3 Hz.
  // Simulates HF atmospheric variation visible as vertical banding in
  // SRS's HF_NOISE spectrogram.
  const fadeMod = ctx.createGain();
  fadeMod.gain.value = 1.0;
  const fadeLFO = ctx.createOscillator();
  fadeLFO.type = 'sine';
  fadeLFO.frequency.value = 1.5;
  const fadeDepth = ctx.createGain();
  fadeDepth.gain.value = 0.0;        // off by default
  fadeLFO.connect(fadeDepth);
  fadeDepth.connect(fadeMod.gain);
  try { fadeLFO.start(); } catch {}

  const bedGain = ctx.createGain();
  bedGain.gain.value = 0;

  // source → cutA → cutB → fadeMod → bedGain → bus
  bedSrc.connect(bedCutA);
  bedCutA.connect(bedCutB);
  bedCutB.connect(fadeMod);
  fadeMod.connect(bedGain);
  bedGain.connect(localBus);
  try { bedSrc.start(); } catch {}

  // Outbound delay — 80 ms, DCS pre-click feel.
  const outboundDelay = ctx.createDelay(0.5);
  outboundDelay.delayTime.value = 0.08;

  let bedTargetOn = false;
  const setBedActive = (on) => {
    bedTargetOn = !!on;
    const now = ctx.currentTime;
    const target = bedTargetOn ? 0.04 : 0;
    const tau = bedTargetOn ? 0.04 : 0.22;
    bedGain.gain.cancelScheduledValues(now);
    bedGain.gain.setTargetAtTime(target, now, tau);
  };

  // Per-channel bed profile. Called from useRadioConnection whenever the
  // operator tunes a new frequency. Hashes the freq string to a stable
  // cutoff within 3–6 kHz, and decides whether this channel gets slow
  // atmospheric fade and at what depth/rate.
  const setChannel = (freqString) => {
    const h = hashString(String(freqString || ''));
    const u = (n) => ((h >> (n * 4)) & 0xff) / 0xff;
    // Cutoff drifts 3100–5800 Hz so each channel has its own "radio
    // bandwidth." Reused for both bed filters so the cliff stays sharp.
    const cutoff = Math.round(3100 + u(0) * 2700);
    const now = ctx.currentTime;
    bedCutA.frequency.setTargetAtTime(cutoff, now, 0.05);
    bedCutB.frequency.setTargetAtTime(cutoff, now, 0.05);
    // ~1/3 of channels get atmospheric fade. Rate 0.8–2.4 Hz, depth
    // ±4-10 % of unity — audible but not disorienting.
    const fade = u(1) > 0.66;
    fadeLFO.frequency.setTargetAtTime(0.8 + u(2) * 1.6, now, 0.05);
    fadeDepth.gain.setTargetAtTime(fade ? (0.04 + u(3) * 0.06) : 0, now, 0.08);
  };

  const playKeyUp   = () => playKeyClick(ctx, localBus, { woofFreq: 360, crackFreq: 1600, dur: 0.09, hiss: 0.035, clickGain: 0.22, tailGain: 0.045 });
  const playKeyDown = () => playKeyClick(ctx, localBus, { woofFreq: 280, crackFreq: 1200, dur: 0.11, hiss: 0.15,  clickGain: 0.22, tailGain: 0.045 });

  return {
    localBus,
    bedGain, bedSrc,
    outboundDelay,
    setBedActive,
    setChannel,
    playKeyUp, playKeyDown,
  };
}

// Hybrid key click — damped low sine (mechanical "woof") + overlaid
// bandpass noise burst (relay "crack") + optional pink hiss tail.
// The sine component is what the SRS waveform analysis showed to be
// missing from our previous pure-noise click — real radio keyups have
// a tonal transient from the discriminator relay or hybrid coil, which
// pure white noise can't replicate.
function playKeyClick(ctx, dest, {
  woofFreq = 350,
  crackFreq = 1500,
  dur = 0.09,
  hiss = 0.04,
  clickGain = 0.22,
  tailGain = 0.045,
}) {
  const now = ctx.currentTime;
  // Random ±5% jitter so repeat presses never sound identical.
  const j = 0.95 + Math.random() * 0.10;

  // ─── Component 1: damped sine (the "woof") ───────────────────────────
  // Short exponential decay. Peak at crackGain * 0.7 so it sits under
  // the noise crack but still colours the attack.
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = woofFreq * j;
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.linearRampToValueAtTime(clickGain * 0.75, now + 0.002);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(oscGain); oscGain.connect(dest);
  osc.start(now);
  osc.stop(now + dur + 0.02);

  // ─── Component 2: bandpass noise crack ──────────────────────────────
  // Fires 1 ms after the woof starts so the ear perceives the transient
  // as a single mechanical event with body.
  const noise = ctx.createBufferSource();
  noise.buffer = makeWhiteNoiseBuffer(ctx, dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = crackFreq * j;
  bp.Q.value = 1.6;
  const g = ctx.createGain();
  const t0 = now + 0.001;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(clickGain, t0 + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.6);
  noise.connect(bp); bp.connect(g); g.connect(dest);
  noise.start(t0);
  noise.stop(t0 + dur + 0.02);

  // ─── Component 3: pink hiss tail ─────────────────────────────────────
  if (hiss > 0) {
    const tail = ctx.createBufferSource();
    tail.buffer = makePinkNoiseBuffer(ctx, hiss + 0.1);
    const tailLp = ctx.createBiquadFilter();
    tailLp.type = 'lowpass';
    tailLp.frequency.value = 2800;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(tailGain, now);
    tg.gain.exponentialRampToValueAtTime(0.0005, now + hiss);
    tail.connect(tailLp); tailLp.connect(tg); tg.connect(dest);
    tail.start(now);
    tail.stop(now + hiss + 0.05);
  }
}

function makeWhiteNoiseBuffer(ctx, seconds) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function makePinkNoiseBuffer(ctx, seconds) {
  // Voss-McCartney-ish approximation — cheap pink noise, good enough for
  // ambient bed.
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    d[i] = pink * 0.11; // normalize to ~ ±1 roughly
  }
  return buf;
}

function hashString(s) {
  let h = 2166136261 >>> 0; // FNV-1a 32
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
