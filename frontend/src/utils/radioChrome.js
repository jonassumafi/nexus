// Radio chrome — PTT key-up/down clicks + persistent squelch bed.
//
// v1.1: switched from pure synthesis to real SRS recorded samples when
// they're loadable, synthesis fallback for first play before buffers
// are warm. The actual mechanical "key up" character of real military
// relay recordings is unforgeable in synthesis — the Bimbac samples
// shipped under GPL via the SRS project close that fidelity gap.
//
// Shipped alongside Nexus under GPL v3; see /LICENSE and
// frontend/public/sounds/radio/CREDITS.md for provenance.
//
// Public API (unchanged from v1.0 so useRadioConnection just works):
//   getRadioChrome(ctx)  → singleton per AudioContext with:
//       .playKeyUp()
//       .playKeyDown()
//       .setBedActive(bool)
//       .setChannel(freqString)       — tune bed cutoff + fade
//       .setBand(band)                — swap bed sample (UHF/VHF/HF/FM)
//   getOutboundDelay(ctx)
//   channelColor(freqString)
//
// All sample loading is lazy + async. If a .wav 404s or decodeAudioData
// throws, the chrome falls back to the previous synthesis path so audio
// never breaks because an asset is missing.

const CHROME_BY_CTX = new WeakMap();

export function getRadioChrome(ctx) {
  if (!ctx) return null;
  let rc = CHROME_BY_CTX.get(ctx);
  if (rc) return rc;
  rc = buildChrome(ctx);
  CHROME_BY_CTX.set(ctx, rc);
  return rc;
}

export function getOutboundDelay(ctx) {
  const rc = getRadioChrome(ctx);
  return rc?.outboundDelay ?? null;
}

export function channelColor(freqString) {
  const h = hashString(String(freqString || ''));
  const u = (n) => ((h >> (n * 4)) & 0xff) / 0xff;
  return {
    highpass_delta:       Math.round(u(0) * 120 - 60),
    lowpass_delta:        Math.round(u(1) * 400 - 200),
    resonance_freq_delta: Math.round(u(2) * 300 - 150),
    resonance_q_delta:    (u(3) * 1.0 - 0.5),
    bit_crush_delta:      Math.round(u(4) * 2 - 1),
  };
}

// ─── Sample URLs ────────────────────────────────────────────────────────

const CLICK_URLS = {
  // ALTERNATE variants pulled: the START_ALTERNATE sample has a
  // voice-recording tail baked in that leaked onto the air when the
  // PTT engage happened to pick that variant. Single-sample rotation
  // keeps the keyup/keydown chrome clean until we re-source cleaner
  // alternates (or re-record Nexus-original ones).
  up:   ['/sounds/radio/RADIO_TRANS_START.wav'],
  down: ['/sounds/radio/RADIO_TRANS_END.wav'],
};
const BED_URL = {
  UHF:  '/sounds/radio/UHF_NOISE.wav',
  VHF:  '/sounds/radio/VHF_NOISE.wav',
  HF:   '/sounds/radio/HF_NOISE.wav',
  FM:   '/sounds/radio/FM_NOISE.wav',
  // KY58 cryptomap static — reserved for cvsd-tagged crypto rigs so they
  // get a bed distinct from non-crypto FM rigs. Shorter sample (~10 s)
  // but seamlessly loops. See CREDITS.md.
  KY58: '/sounds/radio/KY58_UHF_SECURE.wav',
};

// Per-ctx cache of decoded AudioBuffers so each sample is fetched + decoded
// exactly once per audio session. Shared across all getRadioChrome() calls
// on the same ctx.
const BUFFER_CACHE = new WeakMap();

function cacheFor(ctx) {
  let m = BUFFER_CACHE.get(ctx);
  if (!m) { m = new Map(); BUFFER_CACHE.set(ctx, m); }
  return m;
}

/** Returns a Promise<AudioBuffer|null>. Null means fetch/decode failed —
 *  callers should fall back to synthesis. */
async function loadBuffer(ctx, url) {
  const cache = cacheFor(ctx);
  if (cache.has(url)) return cache.get(url);
  const promise = (async () => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('http ' + resp.status);
      const arr = await resp.arrayBuffer();
      return await ctx.decodeAudioData(arr);
    } catch (err) {
      console.warn('[radioChrome] sample load failed', url, err?.message);
      return null;
    }
  })();
  cache.set(url, promise);
  return promise;
}

// ─── Chrome builder ─────────────────────────────────────────────────────

function buildChrome(ctx) {
  const localBus = ctx.createGain();
  localBus.gain.value = 1;
  localBus.connect(ctx.destination);

  // ── Squelch bed ────────────────────────────────────────────────────
  // The bed is now driven by one of 4 real SRS recordings, loaded lazily
  // and swapped by setBand(). Each loop seamlessly thanks to the samples
  // being 5–30 s long. If the sample hasn't loaded yet, we fall through
  // to the synthesis path (pink noise + 4-pole brick-wall) so there's
  // never a silent gap on first PTT.
  let bedSrc = null;             // AudioBufferSourceNode (sample path) OR null
  let bedBand = 'VHF';           // current band id
  const bedTap = ctx.createGain(); // post-sample tap → fadeMod
  bedTap.gain.value = 1.0;

  // Synthesized fallback bed (same as pre-sample code)
  const synBuf = makePinkNoiseBuffer(ctx, 2.0);
  const synSrc = ctx.createBufferSource();
  synSrc.buffer = synBuf;
  synSrc.loop = true;
  const synCutA = ctx.createBiquadFilter(); synCutA.type = 'lowpass'; synCutA.frequency.value = 4500; synCutA.Q.value = 0.707;
  const synCutB = ctx.createBiquadFilter(); synCutB.type = 'lowpass'; synCutB.frequency.value = 4500; synCutB.Q.value = 0.707;
  const synTap = ctx.createGain(); synTap.gain.value = 1.0;
  synSrc.connect(synCutA); synCutA.connect(synCutB); synCutB.connect(synTap);
  try { synSrc.start(); } catch {}

  // The "live bed" switch — one of (sample bedTap) or (synthesis synTap)
  // feeds into fadeMod. We maintain both; whichever is active connects.
  const fadeMod = ctx.createGain();
  fadeMod.gain.value = 1.0;
  const fadeLFO = ctx.createOscillator();
  fadeLFO.type = 'sine'; fadeLFO.frequency.value = 1.5;
  const fadeDepth = ctx.createGain(); fadeDepth.gain.value = 0;
  fadeLFO.connect(fadeDepth); fadeDepth.connect(fadeMod.gain);
  try { fadeLFO.start(); } catch {}

  const bedGain = ctx.createGain();
  bedGain.gain.value = 0;
  fadeMod.connect(bedGain);
  bedGain.connect(localBus);

  // Start on synthesis; swap in sample as it loads.
  synTap.connect(fadeMod);
  let bedConnectedNode = synTap;

  const outboundDelay = ctx.createDelay(0.5);
  outboundDelay.delayTime.value = 0.08;

  // Per-source bed intensities. Lets Crew's full bed (1.0) and Command's
  // light accent (0.35) coexist without one source overriding another —
  // we take the max of all active sources. Legacy call-site signature
  // (just `on`) still works: it addresses source 'default' at full strength.
  const bedSources = new Map();  // source -> intensity when active
  const setBedActive = (on, intensity = 1.0, source = 'default') => {
    if (on) {
      bedSources.set(source, Math.max(0, Math.min(1, intensity)));
    } else {
      bedSources.delete(source);
    }
    const now = ctx.currentTime;
    const base = 0.06;
    let maxI = 0;
    for (const v of bedSources.values()) if (v > maxI) maxI = v;
    const target = base * maxI;
    const tau = maxI > 0 ? 0.04 : 0.22;
    bedGain.gain.cancelScheduledValues(now);
    bedGain.gain.setTargetAtTime(target, now, tau);
  };

  const swapBedTo = (newNode) => {
    if (newNode === bedConnectedNode) return;
    try { bedConnectedNode.disconnect(fadeMod); } catch {}
    try { newNode.connect(fadeMod); } catch {}
    bedConnectedNode = newNode;
  };

  const setBand = async (band) => {
    const b = (BED_URL[band]) ? band : 'VHF';
    if (b === bedBand && bedSrc) return;
    bedBand = b;
    const buf = await loadBuffer(ctx, BED_URL[b]);
    if (!buf) return; // synthesis stays active
    // Tear down old sample source if any.
    try { bedSrc?.stop(); } catch {}
    try { bedSrc?.disconnect(); } catch {}
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(bedTap);
    try { src.start(); } catch {}
    bedSrc = src;
    swapBedTo(bedTap);
  };

  // Legacy setChannel is still useful — adjusts synthesis cutoff + fade.
  // On the SAMPLE bed path the LFO fade still applies (the samples are
  // already band-limited by nature of being recorded).
  const setChannel = (freqString) => {
    const h = hashString(String(freqString || ''));
    const u = (n) => ((h >> (n * 4)) & 0xff) / 0xff;
    const cutoff = Math.round(3100 + u(0) * 2700);
    const now = ctx.currentTime;
    synCutA.frequency.setTargetAtTime(cutoff, now, 0.05);
    synCutB.frequency.setTargetAtTime(cutoff, now, 0.05);
    const fade = u(1) > 0.66;
    fadeLFO.frequency.setTargetAtTime(0.8 + u(2) * 1.6, now, 0.05);
    fadeDepth.gain.setTargetAtTime(fade ? (0.04 + u(3) * 0.06) : 0, now, 0.08);
  };

  // ── Clicks ──────────────────────────────────────────────────────────
  // Prefer real .wav samples; fall back to synthesis.
  const playSample = async (urls, synthFallback, { gain = 0.5 } = {}) => {
    // Pick a random variant each fire for variety.
    const url = urls[Math.floor(Math.random() * urls.length)];
    const buf = await loadBuffer(ctx, url);
    if (!buf) { synthFallback(); return; }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g); g.connect(localBus);
    try { src.start(); } catch { synthFallback(); }
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch {} };
  };

  // Cue-set aware key clicks.
  // Backwards-compatible API: calling playKeyUp() / playKeyDown() with no
  // arguments plays the current "classic" .wav samples at the current
  // volume — identical to pre-v0.9 behavior. Callers can pass a cueSet
  // object (shape from cueSets.json) to override the sound family. The
  // "command" set adds a SELCAL-style 2-tone pre-chirp before the click.
  const playKeyUp = async (cueSet) => {
    const set = cueSet || null;
    if (set?.pre?.kind === 'chord') await playPreChord(ctx, localBus, set.pre);
    const urls = set?.up || CLICK_URLS.up;
    const gain = (typeof set?.clickGain === 'number') ? set.clickGain : 0.45;
    playSample(urls, () => synthClick(ctx, localBus, 'up'), { gain });
  };
  const playKeyDown = (cueSet) => {
    const set = cueSet || null;
    const urls = set?.down || CLICK_URLS.down;
    const gain = (typeof set?.clickGain === 'number') ? set.clickGain : 0.45;
    playSample(urls, () => synthClick(ctx, localBus, 'down'), { gain });
  };

  // Kick off the default VHF bed load eagerly so it's warm before the
  // user first keys up.
  setBand('VHF').catch(() => {});

  return {
    localBus, bedGain,
    outboundDelay,
    setBedActive,
    setChannel,
    setBand,
    playKeyUp, playKeyDown,
  };
}

/**
 * SELCAL-style 2-tone pre-chirp. Pure Web Audio synthesis — no samples,
 * no license concern. Called inline before the key-up click when a cueSet
 * with a `pre.kind === 'chord'` is active. Resolves when the chord has
 * fully released so the subsequent click doesn't collide with its tail.
 *
 * @param {AudioContext} ctx
 * @param {AudioNode}    dest   Where to route the chord output
 * @param {{freqs:number[], ms:number, gain:number, attackMs?:number, releaseMs?:number, waveform?:OscillatorType}} spec
 */
async function playPreChord(ctx, dest, spec) {
  try {
    const now = ctx.currentTime;
    const durSec   = Math.max(0.05, (spec.ms || 400) / 1000);
    const peak     = Math.max(0.01, Math.min(0.8, spec.gain ?? 0.3));
    const atkSec   = Math.max(0.001, (spec.attackMs  ?? 8)  / 1000);
    const relSec   = Math.max(0.005, (spec.releaseMs ?? 80) / 1000);
    const waveform = spec.waveform || 'sine';

    // Shared envelope so both tones share phase of attack/sustain/release.
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(peak,   now + atkSec);
    bus.gain.setValueAtTime(peak, now + durSec - relSec);
    bus.gain.linearRampToValueAtTime(0.0001, now + durSec);
    bus.connect(dest);

    const oscs = [];
    for (const f of (spec.freqs || [1250, 1850])) {
      const osc = ctx.createOscillator();
      osc.type = waveform;
      osc.frequency.value = f;
      // Per-tone gain divides so the sum doesn't clip at the bus.
      const perToneGain = ctx.createGain();
      perToneGain.gain.value = 1 / Math.max(1, spec.freqs?.length || 2);
      osc.connect(perToneGain);
      perToneGain.connect(bus);
      osc.start(now);
      osc.stop(now + durSec + 0.02);
      oscs.push({ osc, perToneGain });
    }

    // Resolve shortly after the release ends so the caller can chain a click.
    await new Promise((r) => setTimeout(r, (durSec * 1000) + 10));
    // Tidy up — oscillators auto-stop; disconnect to free GC.
    for (const { osc, perToneGain } of oscs) {
      try { osc.disconnect(); perToneGain.disconnect(); } catch {}
    }
    try { bus.disconnect(); } catch {}
  } catch {
    /* synthesis failure is non-fatal — the click still plays */
  }
}

// ─── Synthesis fallbacks (unchanged from v1.0 for behavior continuity) ──

function synthClick(ctx, dest, type) {
  const now = ctx.currentTime;
  const woofFreq  = type === 'up' ? 360 : 280;
  const crackFreq = type === 'up' ? 1600 : 1200;
  const dur = type === 'up' ? 0.09 : 0.11;
  const hiss = type === 'up' ? 0.035 : 0.15;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = woofFreq;
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.linearRampToValueAtTime(0.18, now + 0.002);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(oscGain); oscGain.connect(dest);
  osc.start(now);
  osc.stop(now + dur + 0.02);

  const noise = ctx.createBufferSource();
  noise.buffer = makeWhiteNoiseBuffer(ctx, dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = crackFreq;
  bp.Q.value = 1.6;
  const g = ctx.createGain();
  const t0 = now + 0.001;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.22, t0 + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.6);
  noise.connect(bp); bp.connect(g); g.connect(dest);
  noise.start(t0);
  noise.stop(t0 + dur + 0.02);

  if (hiss > 0) {
    const tail = ctx.createBufferSource();
    tail.buffer = makePinkNoiseBuffer(ctx, hiss + 0.1);
    const tailLp = ctx.createBiquadFilter();
    tailLp.type = 'lowpass';
    tailLp.frequency.value = 2800;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.045, now);
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
    d[i] = pink * 0.11;
  }
  return buf;
}

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
