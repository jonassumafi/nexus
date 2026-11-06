// DevTools-exposed harness for the UDP voice path.
//
// Import this once from main.jsx to expose window.nexusUdp.* in the
// Electron webview. Lets you prove the TX+RX pipeline end-to-end
// without touching real radio UI.
//
// Quick smoke test (DevTools console in the running app, with the
// relay already running on 127.0.0.1:41234):
//
//   // 1. Open UDP session
//   await nexusUdp.open({ userId: 'me', freq: '160.4', tunerId: 'right' });
//
//   // 2. Start sending mic (grants mic permission)
//   await nexusUdp.startMic();
//
//   // 3. Press PTT (just enables outbound tracks)
//   nexusUdp.pttDown();
//   // ...talk...
//   nexusUdp.pttUp();
//
//   // 4. Listen to incoming peer audio
//   nexusUdp.startRx();   // attaches peer streams to <audio> elements
//
//   // 5. Inspect
//   nexusUdp.status();    // { txFrames, txBytes, peers: {...} }
//
//   // 6. Tear down
//   await nexusUdp.close();

import { createUdpVoiceTx } from './udpVoiceTx';
import { createUdpVoiceRx } from './udpVoiceRx';

let tx = null;
let rx = null;
let rxCtx = null;
const peerAudios = new Map();   // userId -> HTMLAudioElement

async function open(opts = {}) {
  const defaults = { userId: 'devuser', freq: '160.4', tunerId: 'right', host: '127.0.0.1', port: 41234 };
  const merged = { ...defaults, ...opts };
  const r = await window.electronAPI.udp.open(merged);
  console.log('[nexusUdp] open ->', r);
  return r;
}

async function close() {
  pttUp();
  if (tx) { await tx.close(); tx = null; }
  if (rx) { rx.close(); rx = null; }
  if (rxCtx) { try { await rxCtx.close(); } catch {} rxCtx = null; }
  for (const [, a] of peerAudios) {
    try { a.pause(); a.srcObject = null; } catch {}
  }
  peerAudios.clear();
  const r = await window.electronAPI.udp.close();
  console.log('[nexusUdp] close ->', r);
  return r;
}

async function startMic() {
  if (tx) { console.warn('[nexusUdp] mic already started'); return; }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  tx = await createUdpVoiceTx(stream);
  console.log('[nexusUdp] mic running (muted until pttDown)');
}

function pttDown() { tx?.start(); }
function pttUp()   { tx?.stop(); }

function startRx() {
  if (rx) { console.warn('[nexusUdp] rx already started'); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  rxCtx = new Ctx({ sampleRate: 48000 });
  rx = createUdpVoiceRx(rxCtx, ({ userId, stream }) => {
    console.log('[nexusUdp] new peer:', userId);
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = stream;
    audio.play().catch(err => console.warn('[nexusUdp] play failed:', err));
    peerAudios.set(userId, audio);
  });
  console.log('[nexusUdp] rx running');
}

function status() {
  return {
    tx: tx?.stats() ?? null,
    rx: rx?.stats() ?? null,
    peers: [...peerAudios.keys()],
  };
}

async function retune(opts) {
  const r = await window.electronAPI.udp.retune(opts);
  console.log('[nexusUdp] retune ->', r);
  return r;
}

export function installDevHarness() {
  window.nexusUdp = { open, close, startMic, pttDown, pttUp, startRx, retune, status };
  console.log('[nexusUdp] dev harness installed — try nexusUdp.open(), then startMic(), startRx()');
}
