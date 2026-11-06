// Decode harness — joins a room and writes decoded PCM to a WAV file.
//
// Usage:
//   node decode-test.js <userId> <freq> <tunerId> <outWav> [durationSec] [senderBand]
//
// The relay must be running on 127.0.0.1:41234 (or set RELAY_HOST/PORT).
// Writes a 48 kHz mono 16-bit WAV.

const dgram = require('node:dgram');
const fs = require('node:fs');
const { OpusEncoder } = require('@discordjs/opus');

const userId     = process.argv[2] || 'decoder';
const freq       = process.argv[3] || '160.4';
const tunerId    = Number(process.argv[4] ?? 1);
const outPath    = process.argv[5] || '/tmp/decoded.wav';
const seconds    = Number(process.argv[6] ?? 5);
const senderBand = Number(process.argv[7] ?? 0);
const host       = process.env.RELAY_HOST || '127.0.0.1';
const port       = Number(process.env.RELAY_PORT || 41234);

const SR = 48_000;
const FRAME_SIZE = 960;

const WIRE_VERSION = 0x01;

// Per-sender decoders so Opus PLC stays coherent across streams.
const decoders = new Map();  // userId -> { decoder, lastSeen }
function getDecoder(uid) {
  let e = decoders.get(uid);
  if (e) { e.lastSeen = Date.now(); return e.decoder; }
  const d = new OpusEncoder(SR, 1);
  decoders.set(uid, { decoder: d, lastSeen: Date.now() });
  return d;
}

const sock = dgram.createSocket('udp4');

function buildHeader(tunerId, freq, userId, senderBand = 0) {
  const freqBuf = Buffer.from(String(freq), 'ascii');
  const uidBuf  = Buffer.from(String(userId), 'ascii');
  const hdr = Buffer.alloc(1 + 1 + 1 + freqBuf.length + 2 + uidBuf.length + 1);
  let o = 0;
  hdr[o++] = WIRE_VERSION;
  hdr[o++] = tunerId;
  hdr[o++] = freqBuf.length;
  freqBuf.copy(hdr, o); o += freqBuf.length;
  hdr.writeUInt16BE(uidBuf.length, o); o += 2;
  uidBuf.copy(hdr, o); o += uidBuf.length;
  hdr[o++] = senderBand & 0xff;
  return hdr;
}

function parse(buf) {
  if (buf.length < 6) return null;
  if (buf[0] !== WIRE_VERSION) return null;
  const t = buf[1];
  const freqLen = buf[2];
  if (buf.length < 3 + freqLen + 2) return null;
  const uidLen = buf.readUInt16BE(3 + freqLen);
  const uidStart = 3 + freqLen + 2;
  const bandOffset = uidStart + uidLen;
  if (buf.length < bandOffset + 1) return null;
  return {
    tunerId: t,
    freq: buf.slice(3, 3 + freqLen).toString('ascii'),
    userId: buf.slice(uidStart, bandOffset).toString('ascii'),
    senderBand: buf[bandOffset],
    payload: buf.slice(bandOffset + 1),
  };
}

const chunks = [];
let packets = 0;
let decoded = 0;
let dropped = 0;

const header = buildHeader(tunerId, freq, userId, senderBand);

sock.on('message', (buf) => {
  const m = parse(buf);
  if (!m) return;
  if (m.payload.length < 2) return;
  if (m.userId === userId) return;
  packets++;
  try {
    const dec = getDecoder(m.userId);
    const pcm = dec.decode(m.payload, FRAME_SIZE);
    chunks.push(pcm);
    decoded++;
    if (decoded === 1) {
      console.log(`[decode-test] first frame from ${m.userId} senderBand=${m.senderBand}`);
    }
  } catch (err) {
    dropped++;
    if (dropped < 3) console.error('[decode error]', err.message);
  }
});

sock.on('listening', () => {
  const a = sock.address();
  console.log(`[decode-test] listening ${a.address}:${a.port}, writing to ${outPath}, duration=${seconds}s, senderBand=${senderBand}`);
  sock.send(Buffer.concat([header, Buffer.from([0])]), port, host);
  const beat = setInterval(() => {
    sock.send(Buffer.concat([header, Buffer.from([0])]), port, host);
  }, 5_000);
  setTimeout(() => {
    clearInterval(beat);
    const pcm = Buffer.concat(chunks);
    const wav = toWav(pcm, SR, 1);
    fs.writeFileSync(outPath, wav);
    console.log(`[decode-test] done. packets=${packets} decoded=${decoded} dropped=${dropped} bytes=${pcm.length} → ${outPath}`);
    sock.close();
    process.exit(0);
  }, seconds * 1000);
});

sock.bind();

function toWav(pcm, sampleRate, channels) {
  const dataLen = pcm.length;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  pcm.copy(buf, 44);
  return buf;
}
