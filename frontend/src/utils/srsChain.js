// SRS JSON spec → Web Audio graph.
//
// Takes a radio-model spec (the `txEffect` object from one of the
// files in backend/data/radio_models/) and returns a chain of Web
// Audio nodes you can splice into a mic/voice signal path. Supports
// every $type SRS uses across the 28 presets:
//
//   chain | filters | highpass | lowpass | peak | gain | saturation
//   compressor | sidechainCompressor | cvsd
//
// Where SRS runs on .NET's audio stack, Web Audio has close-but-not-
// identical primitives. The mapping choices:
//
//   highpass / lowpass / peak    → BiquadFilterNode (same math)
//   gain (dB)                     → GainNode (10^(dB/20))
//   saturation                    → WaveShaperNode with soft-knee curve
//                                   above threshold, hard-cap +gain dB
//   compressor                    → DynamicsCompressorNode (direct)
//   sidechainCompressor           → DynamicsCompressorNode; the sidechain
//                                   path isn't natively routable in Web
//                                   Audio, so we apply the sidechainEffect
//                                   inline on the main signal and let the
//                                   compressor react to the filtered
//                                   content (perceptually close for most
//                                   SRS use cases, which key the sidechain
//                                   off a highpass of the main signal)
//   cvsd                          → bitcrush approximation: a lightweight
//                                   AudioWorklet-free sample-and-hold
//                                   via WaveShaper + implicit SR reduction
//                                   is overkill here; we use a GainNode
//                                   that just marks the chain as "crypto"
//                                   and relies on the surrounding filter
//                                   + saturation to carry the character.
//                                   True CVSD vocoder emulation is a
//                                   future upgrade.
//
// Usage:
//   const { input, output, dispose } = buildSrsChain(ctx, spec.txEffect);
//   source.connect(input); output.connect(dest);
//   // later: dispose();

const DEBUG = false;

export function buildSrsChain(ctx, effect) {
  if (!ctx || !effect) return null;
  const nodes = [];
  const { head, tail } = buildEffect(ctx, effect, nodes);
  return {
    input: head,
    output: tail,
    dispose() {
      for (const n of nodes) {
        try { n.disconnect(); } catch {}
      }
    },
  };
}

/** Walks the effect tree and returns { head, tail } nodes. All intermediate
 *  nodes are pushed into `nodes` so dispose() can disconnect them cleanly. */
function buildEffect(ctx, effect, nodes) {
  const type = effect?.$type;
  if (!type) return passthrough(ctx, nodes);

  switch (type) {
    case 'chain': {
      // Serial chain of child effects. Hook head of first to passthrough,
      // then connect each next effect's input to the previous tail.
      let head = null, prevTail = null;
      for (const child of (effect.effects || [])) {
        const { head: h, tail: t } = buildEffect(ctx, child, nodes);
        if (!head) head = h;
        if (prevTail) prevTail.connect(h);
        prevTail = t;
      }
      if (!head) return passthrough(ctx, nodes);
      return { head, tail: prevTail };
    }

    case 'filters': {
      // Series stack of individual filter nodes.
      let head = null, prevTail = null;
      for (const child of (effect.filters || [])) {
        const { head: h, tail: t } = buildEffect(ctx, child, nodes);
        if (!head) head = h;
        if (prevTail) prevTail.connect(h);
        prevTail = t;
      }
      if (!head) return passthrough(ctx, nodes);
      return { head, tail: prevTail };
    }

    case 'highpass':
    case 'lowpass':
    case 'peak': {
      const b = ctx.createBiquadFilter();
      b.type = (type === 'peak') ? 'peaking' : type;
      if (effect.frequency != null) b.frequency.value = effect.frequency;
      if (effect.q != null)         b.Q.value = effect.q;
      if (effect.gain != null)      b.gain.value = effect.gain;
      nodes.push(b);
      return { head: b, tail: b };
    }

    case 'gain': {
      const g = ctx.createGain();
      // SRS gain is dB → amplitude multiplier
      g.gain.value = dbToLinear(effect.gain ?? 0);
      nodes.push(g);
      return { head: g, tail: g };
    }

    case 'saturation': {
      // Two-stage: pre-gain (dB) → waveshaper (soft knee above threshold).
      const pre = ctx.createGain();
      pre.gain.value = dbToLinear(effect.gain ?? 0);
      const shaper = ctx.createWaveShaper();
      shaper.oversample = '2x';
      shaper.curve = makeSaturationCurve(effect.threshold ?? -20);
      pre.connect(shaper);
      nodes.push(pre, shaper);
      return { head: pre, tail: shaper };
    }

    case 'compressor':
    case 'sidechainCompressor': {
      // Web Audio DynamicsCompressor doesn't accept an external sidechain
      // input, so we approximate: run the sidechain-filtered signal
      // through the compressor on the main path. For most SRS presets
      // the sidechain is just a highpass of the main signal, so the
      // perceptual result is close.
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = clamp(effect.threshold ?? -24, -100, 0);
      c.ratio.value     = clamp(effect.ratio ?? 2.0, 1, 20);
      c.attack.value    = clamp(effect.attack ?? 0.003, 0, 1);
      c.release.value   = clamp(effect.release ?? 0.25, 0, 1);
      c.knee.value      = 2;
      const post = ctx.createGain();
      post.gain.value = dbToLinear(effect.makeUp ?? 0);
      c.connect(post);
      nodes.push(c, post);

      if (type === 'sidechainCompressor' && effect.sidechainEffect) {
        // Prepend the sidechain filter inline so the compressor hears
        // its intended key signal. Not a true sidechain but perceptually
        // in the ballpark for highpass-keyed de-essing / taming.
        const { head: sh, tail: st } = buildEffect(ctx, effect.sidechainEffect, nodes);
        st.connect(c);
        return { head: sh, tail: post };
      }
      return { head: c, tail: post };
    }

    case 'cvsd': {
      // CVSD vocoder approximation. True implementation would need an
      // AudioWorklet with 16-kbit delta-modulation + reconstruction;
      // for now we insert a mild bitcrush-via-WaveShaper so there's SOME
      // digital artifact signature on crypto-enabled radios. Marked as
      // a known approximation in the file header above.
      const shaper = ctx.createWaveShaper();
      shaper.oversample = 'none';
      shaper.curve = makeBitcrushCurve(10); // 10-bit effective resolution
      nodes.push(shaper);
      return { head: shaper, tail: shaper };
    }

    default:
      if (DEBUG) console.warn('[srsChain] unknown $type:', type);
      return passthrough(ctx, nodes);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

function passthrough(ctx, nodes) {
  const g = ctx.createGain();
  g.gain.value = 1;
  nodes.push(g);
  return { head: g, tail: g };
}

function dbToLinear(db) { return Math.pow(10, db / 20); }

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/** Soft-knee saturation curve above the dBFS threshold. Below threshold
 *  the response is linear. Above, tanh-shaped soft limiting with a
 *  gentle ceiling that keeps peaks under 0 dBFS. */
function makeSaturationCurve(thresholdDb) {
  const SIZE = 2048;
  const thresh = Math.pow(10, thresholdDb / 20);
  const curve = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    const x = (i / (SIZE - 1)) * 2 - 1;        // -1..+1
    const absX = Math.abs(x);
    let y;
    if (absX <= thresh) {
      y = x;
    } else {
      // Soft tanh-knee above threshold, mapped so threshold->threshold
      // and ±1 asymptotes to ~0.95.
      const over = (absX - thresh) / (1 - thresh + 1e-6);
      const shaped = thresh + (0.95 - thresh) * Math.tanh(over * 2.0);
      y = Math.sign(x) * shaped;
    }
    curve[i] = y;
  }
  return curve;
}

/** Bitcrush curve for the CVSD approximation. Quantizes amplitude to
 *  2^bits levels, giving a mild digital stair-step distortion. */
function makeBitcrushCurve(bits) {
  const SIZE = 2048;
  const steps = Math.pow(2, bits);
  const curve = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    const x = (i / (SIZE - 1)) * 2 - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}
