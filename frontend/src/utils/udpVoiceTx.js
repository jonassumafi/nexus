// Renderer-side UDP voice TX.
//
// AudioWorklet batcher node that posts 20 ms Int16 frames back to the
// main thread. Each frame is forwarded to window.electronAPI.udp.send()
// for Opus encoding + transmit.
//
// v0.9.27: hosts in the caller's existing AudioContext instead of
// spinning up its own. Prior builds created a second 48 kHz context
// and read the mic chain's MediaStream via createMediaStreamSource().
// Chromium silently produces silence from a cross-context
// MediaStreamSource after a prior context in the same page has been
// closed, which is exactly what happens on every view switch — the
// first session's TX worked, every subsequent one went dead quiet
// even though PTT socket events still fired (see the voice-continuity
// bug on Full↔Companion↔Radio-only switches).
//
// Separate from useRadioConnection so WebRTC stays unaffected during
// the UDP migration. A caller passes the ctx + a post-DSP AudioNode
// output (the SRS chain's last node) and gets back start/stop.

// Served statically from frontend/public/worklets/ — matches the pattern
// used by srsChain.js's CVSD worklet, so no bundler plumbing is needed.
const WORKLET_URL = '/worklets/udp_pcm_batcher.js';

const SAMPLE_RATE = 48_000;

/**
 * @param {{ ctx: AudioContext, sourceNode?: AudioNode, stream?: MediaStream }} opts
 *   ctx:        the mic-chain's AudioContext. Required.
 *   sourceNode: an AudioNode in `ctx` whose output is the fully-DSP'd
 *               mic audio (preferred — keeps everything in one graph).
 *   stream:     legacy alternative. A MediaStream to wrap in
 *               ctx.createMediaStreamSource(). Only use when sourceNode
 *               isn't available; subject to Chromium's cross-context
 *               silencing on re-mount.
 * @returns {Promise<{ start: () => void, stop: () => void, close: () => Promise<void> }>}
 */
export async function createUdpVoiceTx(opts) {
  if (!window.electronAPI?.udp) {
    throw new Error('UDP voice unavailable (not running in Electron)');
  }

  // Back-compat: old call sites pass a MediaStream directly. Treat it
  // as the legacy `stream` field.
  if (opts instanceof MediaStream) opts = { stream: opts };
  const { ctx, sourceNode, stream } = opts || {};
  if (!ctx) throw new Error('createUdpVoiceTx requires { ctx }');
  if (!sourceNode && !stream) throw new Error('createUdpVoiceTx requires sourceNode or stream');
  if (ctx.sampleRate !== SAMPLE_RATE) {
    console.warn('[udp-tx] ctx sampleRate is', ctx.sampleRate, '— worklet expects', SAMPLE_RATE);
  }

  await ctx.audioWorklet.addModule(WORKLET_URL);

  const source = sourceNode || ctx.createMediaStreamSource(stream);
  // Track whether we own the source (and thus should disconnect it on close).
  const ownsSource = !sourceNode;
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
      // Only disconnect the source if we created it ourselves (legacy
      // stream path). When the caller provided a sourceNode, it's part
      // of their graph and they'll clean it up.
      if (ownsSource) {
        try { source.disconnect(); } catch {}
        try { stream?.getAudioTracks()?.forEach(t => t.stop()); } catch {}
      }
      // Context is owned by the caller — don't close it. Prior builds
      // owned the context and closed it here; the renderer now shares
      // its mic-chain ctx, so closing it would kill the whole pipeline.
    },
    stats() { return { framesSent, bytesEncoded }; },
  };
}
