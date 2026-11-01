// CVSD (Continuously Variable Slope Delta) vocoder — the compression
// scheme used by KY-57/KY-58 military crypto radios and modeled by
// SRS for its secure-voice presets. Encodes a 1-bit stream at a
// vocoder sample rate well below the audio sample rate, then decodes
// back to audible waveform. The characteristic "granular" / "walkie-
// talkie-through-crypto" sound comes from the step-size adaptation
// chasing the signal slope.
//
// Algorithm:
//   1. Downsample input to VOCODER_RATE (default 16 kHz) via a simple
//      cumulative average.
//   2. For each vocoder-rate sample:
//        - Compare current input to the predicted (reconstructed) value
//        - Emit a 1-bit sign (+1 or -1)
//        - Adapt step size via the "3-of-3 rule": if the last three
//          bits all agree, double the step; otherwise, decay toward
//          minimum.
//        - Update predicted value by adding sign × step.
//   3. Decode on the same side (we're not actually transmitting bits —
//      this is a local DSP that models what crypto encode→decode
//      would do to the voice character).
//   4. Upsample reconstructed signal back to the audio sample rate.
//
// Params (settable via port.postMessage):
//   enabled   — bool, pass through when false
//   bitRate   — vocoder bit rate (effective sample rate), 8000–32000 Hz
//   stepMin   — min step size (dB-space equivalent)
//   stepMax   — max step size
//   decay     — step-size decay factor per non-agreeing bit (0.95–0.999)

class CvsdVocoderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled   = true;
    this.bitRate   = 16000;
    this.stepMin   = 0.0012;
    this.stepMax   = 0.12;
    this.decay     = 0.985;
    this.grow      = 2.0;

    // Internal state carried across process() calls:
    this.predicted = 0;      // reconstructed voice sample at vocoder rate
    this.step      = this.stepMin;
    this.lastBits  = [0, 0, 0]; // ring of last 3 output bits for 3-of-3 rule
    this.lastBitIdx = 0;

    this.downAccum = 0;      // downsample accumulator (sum)
    this.downCount = 0;      // samples accumulated
    this.upHold    = 0;      // last decoded sample held for upsample
    this.upFrac    = 0;      // fractional-sample interpolation position

    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.enabled !== undefined) this.enabled = !!d.enabled;
      if (d.bitRate !== undefined) this.bitRate = Math.max(4000, Math.min(32000, Number(d.bitRate) || 16000));
      if (d.stepMin !== undefined) this.stepMin = Number(d.stepMin);
      if (d.stepMax !== undefined) this.stepMax = Number(d.stepMax);
      if (d.decay   !== undefined) this.decay   = Number(d.decay);
    };
  }

  process(inputs, outputs) {
    const inChan  = inputs[0]?.[0];
    const outChan = outputs[0]?.[0];
    if (!inChan || !outChan) return true;

    if (!this.enabled) {
      for (let i = 0; i < inChan.length; i++) outChan[i] = inChan[i];
      return true;
    }

    const srIn = sampleRate;             // AudioContext sample rate (worklet global)
    const srVoc = this.bitRate;          // vocoder sample rate
    const downRatio = srIn / srVoc;      // >1 (e.g. 48000/16000 = 3)
    const upRatio   = srVoc / srIn;      // <1

    const stepMin = this.stepMin;
    const stepMax = this.stepMax;
    const decay   = this.decay;
    const grow    = this.grow;

    for (let i = 0; i < inChan.length; i++) {
      const x = inChan[i];

      // Accumulate samples until we have one vocoder-rate frame.
      this.downAccum += x;
      this.downCount += 1;
      if (this.downCount >= downRatio) {
        const avg = this.downAccum / this.downCount;
        this.downAccum = 0;
        this.downCount = 0;

        // Encode: 1 bit = sign(input - predicted).
        const err  = avg - this.predicted;
        const bit  = err >= 0 ? 1 : -1;

        // Adaptive step: if the last 3 bits (including this one) all
        // agree, grow fast; else decay toward stepMin.
        this.lastBits[this.lastBitIdx] = bit;
        this.lastBitIdx = (this.lastBitIdx + 1) % 3;
        const allAgree = this.lastBits[0] === bit && this.lastBits[1] === bit && this.lastBits[2] === bit;
        if (allAgree) {
          this.step = Math.min(stepMax, this.step * grow);
        } else {
          this.step = Math.max(stepMin, this.step * decay);
        }

        // Decode: predicted += bit * step.
        this.predicted += bit * this.step;
        // Soft clamp to [-1, 1] via tanh so step runaway doesn't clip violently.
        if (this.predicted >  1.1) this.predicted = Math.tanh(this.predicted);
        if (this.predicted < -1.1) this.predicted = Math.tanh(this.predicted);

        this.upHold = this.predicted;
      }

      // Zero-order hold upsample — the reconstructed value stays constant
      // between vocoder-rate updates. Classic CVSD sound; characteristic
      // granularity comes from the step-chase.
      outChan[i] = this.upHold;
    }

    return true;
  }
}

registerProcessor('cvsd-vocoder', CvsdVocoderProcessor);
