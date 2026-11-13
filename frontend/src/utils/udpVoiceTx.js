// Renderer-side UDP voice TX.
//
// Owns a 48 kHz AudioContext + an AudioWorklet batcher node that posts
// 20 ms Int16 frames back to the main thread. Each frame is forwarded
// to window.electronAPI.udp.send() for Opus encoding + transmit.
//
// Separate from useRadioConnection so WebRTC stays unaffected during
// the UDP migration. A caller feeds it a MediaStream (presumably the
// post-DSP filtered stream so transmit gets the SRS character baked
// in before Opus) and gets back a start/stop API.

// Served statically from frontend/public/worklets/ — matches the pattern
// used by srsChain.js's CVSD worklet, so no bundler plumbing is needed.
const WORKLET_URL = '/worklets/udp_pcm_batcher.js';

const SAMPLE_RATE = 48_000;

/**
 * @param {MediaStream} stream — mic stream (post-DSP ideally)
 * @returns {Promise<{ start: () => void, stop: () => void, close: () => Promise<void> }>}
 */
export async function createUdpVoiceTx(stream) {
  if (!window.electronAPI?.udp) {
    throw new Error('UDP voice unavailable (not running in Electron)');
  }

  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: SAMPLE_RATE });
  await ctx.audioWorklet.addModule(WORKLET_URL);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'udp-pcm-batcher', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
  });

  let framesSent = 0;
  let bytesEncoded = 0;
  let txEnabled = false;

  node.port.onmessage = (e) => {
    const data = e.data;
    if (data?.warn === 'sampleRate') {
      console.warn('[udp-tx] worklet reports unexpected sampleRate:', data.value);
      return;
    }
    if (!txEnabled) return;
    const pcm = data?.pcm;
    if (!pcm) return;
    try {
      window.electronAPI.udp.send(pcm);
      framesSent++;
      bytesEncoded += pcm.byteLength;
    } catch (err) {
      // Rare — the IPC handler returns a result but doesn't throw.
      console.error('[udp-tx] send threw:', err);
    }
  };

  source.connect(node);

  return {
    start() { txEnabled = true; },
    stop()  { txEnabled = false; },
    async close() {
      txEnabled = false;
      try { node.port.postMessage('stop'); } catch {}
      try { node.disconnect(); } catch {}
      try { source.disconnect(); } catch {}
      try { stream.getAudioTracks().forEach(t => t.stop()); } catch {}
      try { await ctx.close(); } catch {}
    },
    stats() { return { framesSent, bytesEncoded }; },
  };
}
