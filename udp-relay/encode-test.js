// Encode harness — generates a tone and sends it through the relay using
// the exact same udp-voice module the Electron shell uses. Running this
// against decode-test.js in another terminal gives us a full round-trip
// proof-of-life without needing the real Electron app yet.
//
// Usage:
//   node encode-test.js <userId> <freq> <tunerId> [freqHz] [seconds] [senderBand]
//
// Example:
//   node encode-test.js bob 160.4 1 440 3 2   # senderBand=2 (VHF)

const path = require('node:path');
const udpVoice = require(path.join(__dirname, '..', 'electron', 'src', 'udp-voice.js'));

const userId   = process.argv[2] || 'tone-bot';
const freq     = process.argv[3] || '160.4';
const tunerId  = Number(process.argv[4] ?? 1);
const toneHz   = Number(process.argv[5] ?? 440);
const seconds  = Number(process.argv[6] ?? 3);
const senderBand = Number(process.argv[7] ?? 2);  // default VHF
const host     = process.env.RELAY_HOST || '127.0.0.1';
const port     = Number(process.env.RELAY_PORT || 41234);

const info = udpVoice.open({ host, port, tunerId, freq, userId, senderBand });
console.log(`[encode-test] open: ${JSON.stringify(info)}, tone=${toneHz}Hz, dur=${seconds}s`);

const SR = udpVoice.SAMPLE_RATE;        // 48000
const FRAME_SIZE = udpVoice.FRAME_SIZE; // 960
const totalFrames = Math.floor((seconds * SR) / FRAME_SIZE);
const amp = 0.3 * 32767;

let sampleIdx = 0;
let framesSent = 0;
let totalEncodedBytes = 0;
let errored = 0;

// 20 ms frames at 50 fps. Use setInterval — close enough for a soak test.
const timer = setInterval(() => {
  if (framesSent >= totalFrames) {
    clearInterval(timer);
    udpVoice.close();
    console.log(`[encode-test] done. frames=${framesSent} encodedBytes=${totalEncodedBytes} errors=${errored}`);
    process.exit(0);
  }
  const pcm = Buffer.alloc(FRAME_SIZE * 2);
  for (let i = 0; i < FRAME_SIZE; i++) {
    const s = Math.sin(2 * Math.PI * toneHz * sampleIdx / SR) * amp;
    pcm.writeInt16LE(Math.round(s), i * 2);
    sampleIdx++;
  }
  try {
    const n = udpVoice.send(pcm);
    totalEncodedBytes += n;
    framesSent++;
  } catch (err) {
    errored++;
    if (errored < 3) console.error('[encode-test] send error:', err.message);
  }
}, 20);
