// AudioWorkletProcessor that batches mic PCM into 20 ms Int16 frames.
//
// Loaded via audioContext.audioWorklet.addModule(url). The Web Audio
// callback hands us 128-sample Float32 blocks at the context's sample
// rate; this processor accumulates them into 960-sample (20 ms @ 48 kHz)
// Int16 frames and posts each completed frame to the main thread via
// port.postMessage(). Resampling is NOT done here — the parent context
// MUST be instantiated with { sampleRate: 48000 }.

/* global AudioWorkletProcessor, registerProcessor, sampleRate */

const FRAME_SIZE = 960;

class UdpPcmBatcher extends AudioWorkletProcessor {
  constructor() {
    super();
    this._int16 = new Int16Array(FRAME_SIZE);
    this._filled = 0;
    this._active = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this._active = false;
    };
    // Fail fast if the renderer created the context at the wrong rate.
    if (typeof sampleRate === 'number' && sampleRate !== 48000) {
      this.port.postMessage({ warn: 'sampleRate', value: sampleRate });
    }
  }

  process(inputs) {
    if (!this._active) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];                        // mono
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      // Clamp + convert Float32 [-1, 1] → Int16 [-32768, 32767].
      let s = ch[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      this._int16[this._filled++] = (s * 32767) | 0;

      if (this._filled === FRAME_SIZE) {
        // Transferable buffer — zero-copy to main thread.
        const frame = new Int16Array(FRAME_SIZE);
        frame.set(this._int16);
        this.port.postMessage({ pcm: frame.buffer }, [frame.buffer]);
        this._filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('udp-pcm-batcher', UdpPcmBatcher);
