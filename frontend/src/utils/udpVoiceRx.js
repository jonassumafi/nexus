// Renderer-side UDP voice RX.
//
// Subscribes to window.electronAPI.udp.onRx (fired by the main process
// after it decodes an incoming Opus frame to PCM) and schedules the
// resulting 20 ms audio buffer for playback through a per-peer
// MediaStreamDestination. That destination's stream can be plugged
// into the same consumer that the WebRTC path uses — most importantly
// the SRS rx DSP chain and the <audio> element with the RX volume
// slider — so the two transports are interchangeable from the
// listener graph's perspective.
//
// Each peer gets its own small jitter buffer: incoming frames are
// scheduled sequentially starting at AudioContext.currentTime +
// JITTER_PREROLL_SEC, extending by 20 ms per packet. If packets arrive
// faster than real time, scheduling clock drifts ahead; if they stall,
// we re-anchor the next frame to currentTime + preroll (producing a
// gap, which sounds like a brief squelch — same behavior as the
// WebRTC path when a peer underruns).

const SAMPLE_RATE = 48_000;
const FRAME_SIZE = 960;
const FRAME_SEC = FRAME_SIZE / SAMPLE_RATE;      // 0.02
const JITTER_PREROLL_SEC = 0.04;                 // 2 frames of safety

/**
 * @param {AudioContext} audioCtx — shared with the SRS rx chain
 * @param {(peer: { userId: string, stream: MediaStream, destination: MediaStreamAudioDestinationNode }) => void} onPeer
 *   Called the first time a given userId sends audio. The consumer wires
 *   `peer.stream` into its DSP + <audio> graph.
 * @param {object} [opts]
 * @param {(ctx: AudioContext) => ({ input: AudioNode, output: AudioNode, dispose?: () => void }) | null} [opts.rxEffectBuilder]
 *   Optional per-peer DSP factory. If provided, each new peer's buffer
 *   sources are routed through builder().input → builder().output →
 *   MediaStreamDestination instead of straight to the destination. UDP's
 *   PCM pipeline doesn't hit the Web Audio MediaStreamSource→DSP→
 *   MediaStreamDestination silencing bug, so RX-side SRS DSP works here.
 * @returns {{ close: () => void, stats: () => object, rebuildAllPeerRxGraphs: () => void }}
 */
export function createUdpVoiceRx(audioCtx, onPeer, opts = {}) {
  const rxEffectBuilder = opts.rxEffectBuilder || null;
  if (!window.electronAPI?.udp) {
    throw new Error('UDP voice unavailable (not running in Electron)');
  }
  if (audioCtx.sampleRate !== SAMPLE_RATE) {
    console.warn('[udp-rx] audioCtx sampleRate is', audioCtx.sampleRate,
      '— playback will resample. Prefer 48000 for exact fidelity.');
  }

  // userId -> { destination, nextStartSec, framesPlayed, lastPacketAt }
  const peers = new Map();

  function buildPeerDsp(peer) {
    peer.dspInput = null;
    peer.dspOutput = null;
    peer.dspDispose = null;
    peer.fmDeemphasis = null;
    if (!rxEffectBuilder) {
      // No listener rxEffect, but we still want FM de-emphasis for FM senders.
      if (peer.senderBand === 4) {
        try {
          const de = audioCtx.createBiquadFilter();
          de.type = 'highshelf';
          de.frequency.value = 2122;
          de.gain.value = -6;
          de.connect(peer.destination);
          peer.fmDeemphasis = de;
          peer.dspInput = de;
          peer.dspOutput = de;
        } catch {}
      }
      return;
    }
    try {
      const dsp = rxEffectBuilder(audioCtx);
      if (dsp && dsp.input && dsp.output) {
        peer.dspInput = dsp.input;
        peer.dspOutput = dsp.output;
        peer.dspDispose = dsp.dispose || null;
        try { peer.dspOutput.connect(peer.destination); } catch {}
        // Prepend FM de-emphasis when the sender is on FM — mirrors the
        // TX-side +6 dB pre-emphasis so listeners hear a flat spectrum.
        if (peer.senderBand === 4) {
          try {
            const de = audioCtx.createBiquadFilter();
            de.type = 'highshelf';
            de.frequency.value = 2122;
            de.gain.value = -6;
            de.connect(peer.dspInput);
            peer.fmDeemphasis = de;
            peer.dspInput = de;
          } catch {}
        }
      }
    } catch (err) {
      console.error('[udp-rx] rxEffectBuilder threw:', err);
    }
  }

  function disposePeerDsp(peer) {
    try { peer.fmDeemphasis?.disconnect(); } catch {}
    try { peer.dspOutput?.disconnect(); } catch {}
    try { peer.dspInput?.disconnect(); } catch {}
    try { peer.dspDispose?.(); } catch {}
    peer.dspInput = null;
    peer.dspOutput = null;
    peer.dspDispose = null;
    peer.fmDeemphasis = null;
  }

  function ensurePeer(userId, senderBand = 0) {
    let p = peers.get(userId);
    if (p) {
      // If sender swapped rigs mid-session, rebuild DSP so FM de-emphasis
      // (or lack thereof) matches the new band.
      if (p.senderBand !== senderBand) {
        p.senderBand = senderBand;
        disposePeerDsp(p);
        buildPeerDsp(p);
      }
      return p;
    }
    const destination = audioCtx.createMediaStreamDestination();
    p = {
      destination,
      stream: destination.stream,
      senderBand,
      nextStartSec: 0,
      framesPlayed: 0,
      framesDropped: 0,
      lastPacketAt: 0,
      dspInput: null,
      dspOutput: null,
      dspDispose: null,
    };
    buildPeerDsp(p);
    peers.set(userId, p);
    try { onPeer({ userId, stream: p.stream, destination, senderBand }); }
    catch (err) { console.error('[udp-rx] onPeer handler threw:', err); }
    return p;
  }

  function handleFrame(frame) {
    const { userId, pcm, senderBand } = frame || {};
    if (!userId || !pcm) return;
    const peer = ensurePeer(userId, senderBand || 0);

    // pcm is a transferred ArrayBuffer of 1920 bytes = 960 Int16 samples.
    const int16 = new Int16Array(pcm);
    if (int16.length !== FRAME_SIZE) {
      peer.framesDropped++;
      return;
    }

    const audioBuf = audioCtx.createBuffer(1, FRAME_SIZE, SAMPLE_RATE);
    const ch = audioBuf.getChannelData(0);
    for (let i = 0; i < FRAME_SIZE; i++) ch[i] = int16[i] / 32768;

    const now = audioCtx.currentTime;
    // Re-anchor if we underran (next-start fell behind clock) OR if this
    // is the first frame for this peer.
    if (peer.nextStartSec < now + 0.001) {
      peer.nextStartSec = now + JITTER_PREROLL_SEC;
    }

    const src = audioCtx.createBufferSource();
    src.buffer = audioBuf;
    // Route through the per-peer DSP chain if present; the DSP's output is
    // already connected to peer.destination at peer-create time.
    src.connect(peer.dspInput || peer.destination);
    src.start(peer.nextStartSec);
    peer.nextStartSec += FRAME_SEC;
    peer.framesPlayed++;
    peer.lastPacketAt = Date.now();
  }

  const unsubscribe = window.electronAPI.udp.onRx(handleFrame);

  return {
    close() {
      try { unsubscribe?.(); } catch {}
      for (const p of peers.values()) disposePeerDsp(p);
      peers.clear();
    },
    // Called when the listener's radio spec changes mid-session: tear down
    // every peer's DSP and rebuild from the current rxEffectBuilder. Buffer
    // sources already scheduled on the old chain finish out on it; new
    // frames land on the fresh chain.
    rebuildAllPeerRxGraphs() {
      for (const p of peers.values()) {
        disposePeerDsp(p);
        buildPeerDsp(p);
      }
    },
    stats() {
      const out = {};
      for (const [uid, p] of peers) {
        out[uid] = {
          framesPlayed: p.framesPlayed,
          framesDropped: p.framesDropped,
          idleMs: Date.now() - p.lastPacketAt,
        };
      }
      return out;
    },
  };
}
