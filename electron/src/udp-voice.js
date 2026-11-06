// UDP voice transport for Nexus Companion.
//
// Wire format v1:
//   [1]  version        0x01
//   [1]  tunerId        0=left, 1=right
//   [1]  freqLen        N (1..16)
//   [N]  freq ASCII     e.g. "160.4"
//   [2]  userIdLen BE   M (0..64)
//   [M]  userId ASCII
//   [1]  senderBand     0=unknown, 1=UHF, 2=VHF, 3=HF, 4=FM, 5=KY58
//   [...] opus payload
//
// Version byte is the first byte of every packet so clients and the relay
// can cleanly reject anything other than v1. Chose this over sniffing the
// senderBand range because it's strictly unambiguous and cheap.

const dgram = require('node:dgram');

const SAMPLE_RATE  = 48_000;
const CHANNELS     = 1;
const FRAME_MS     = 20;
const FRAME_SIZE   = (SAMPLE_RATE / 1000) * FRAME_MS;      // 960 samples
const FRAME_BYTES  = FRAME_SIZE * 2;                       // 1920 bytes

const WIRE_VERSION = 0x01;

const BAND_TO_BYTE = {
  unknown: 0, UHF: 1, VHF: 2, HF: 3, FM: 4, KY58: 5,
};
function bandStringToByte(band) {
  if (typeof band === 'number') return (band >= 0 && band <= 5) ? band : 0;
  const key = String(band || '').toUpperCase();
  return BAND_TO_BYTE[key] ?? 0;
}

const DECODER_IDLE_MS = 30_000;
const DECODER_SWEEP_MS = 10_000;

let OpusEncoder = null;
try {
  OpusEncoder = require('@discordjs/opus').OpusEncoder;
} catch (err) {
  console.error('[udp-voice] @discordjs/opus failed to load:', err.message);
}

let session = null;

function parsePacket(buf) {
  // v1 minimum header: 1 (ver) + 1 (tuner) + 1 (freqLen) + 2 (uidLen) + 1 (band) = 6
  if (buf.length < 6) return null;
  if (buf[0] !== WIRE_VERSION) return null;
  const t = buf[1];
  if (t !== 0 && t !== 1) return null;
  const freqLen = buf[2];
  if (freqLen < 1 || freqLen > 16) return null;
  if (buf.length < 3 + freqLen + 2) return null;
  const uidLen = buf.readUInt16BE(3 + freqLen);
  if (uidLen > 64) return null;
  const uidStart = 3 + freqLen + 2;
  const bandOffset = uidStart + uidLen;
  if (buf.length < bandOffset + 1) return null;
  const senderBand = buf[bandOffset];
  const payloadStart = bandOffset + 1;
  return {
    tunerId: t,
    freq: buf.slice(3, 3 + freqLen).toString('ascii'),
    userId: buf.slice(uidStart, bandOffset).toString('ascii'),
    senderBand,
    payload: buf.slice(payloadStart),
  };
}

function buildHeader(tunerId, freq, userId, senderBand = 0) {
  const freqBuf = Buffer.from(String(freq), 'ascii');
  const uidBuf  = Buffer.from(String(userId), 'ascii');
  if (freqBuf.length < 1 || freqBuf.length > 16) {
    throw new Error(`freq must be 1..16 ascii bytes, got ${freqBuf.length}`);
  }
  if (uidBuf.length > 64) {
    throw new Error(`userId must be <=64 ascii bytes, got ${uidBuf.length}`);
  }
  const bandByte = bandStringToByte(senderBand);
  const hdr = Buffer.alloc(1 + 1 + 1 + freqBuf.length + 2 + uidBuf.length + 1);
  let o = 0;
  hdr[o++] = WIRE_VERSION;
  hdr[o++] = tunerId === 'left' ? 0 : (tunerId === 'right' ? 1 : Number(tunerId));
  hdr[o++] = freqBuf.length;
  freqBuf.copy(hdr, o); o += freqBuf.length;
  hdr.writeUInt16BE(uidBuf.length, o); o += 2;
  uidBuf.copy(hdr, o); o += uidBuf.length;
  hdr[o++] = bandByte;
  return hdr;
}

function getOrCreateDecoder(userId) {
  let entry = session.decoders.get(userId);
  if (entry) {
    entry.lastSeen = Date.now();
    return entry.decoder;
  }
  const decoder = new OpusEncoder(SAMPLE_RATE, CHANNELS);
  entry = { decoder, lastSeen: Date.now() };
  session.decoders.set(userId, entry);
  return decoder;
}

function sweepDecoders() {
  if (!session) return;
  const now = Date.now();
  for (const [uid, entry] of session.decoders) {
    if (now - entry.lastSeen > DECODER_IDLE_MS) {
      session.decoders.delete(uid);
      console.log(`[udp-voice] evict decoder for ${uid} (idle ${now - entry.lastSeen}ms)`);
    }
  }
}

function open(opts = {}) {
  if (!OpusEncoder) {
    throw new Error('Opus encoder not available (prebuild load failed)');
  }
  if (session) throw new Error('UDP voice session already open');
  const {
    host    = '127.0.0.1',
    port    = 41234,
    tunerId = 'right',
    freq    = '160.4',
    userId  = 'anon',
    bitrate = 24_000,
    senderBand = 0,
  } = opts;

  const sock = dgram.createSocket('udp4');
  const encoder = new OpusEncoder(SAMPLE_RATE, CHANNELS);
  try { encoder.setBitrate(bitrate); } catch {}

  session = {
    sock,
    encoder,
    decoders: new Map(),  // userId -> { decoder, lastSeen }
    host,
    port,
    senderBand: bandStringToByte(senderBand),
    header: buildHeader(tunerId, freq, userId, senderBand),
    tunerId, freq, userId,
    rxHandlers: new Set(),
    closing: false,
    sweepTimer: null,
  };

  session.sweepTimer = setInterval(sweepDecoders, DECODER_SWEEP_MS);
  session.sweepTimer.unref?.();

  sock.on('message', (buf) => {
    if (!session || session.closing) return;
    const m = parsePacket(buf);
    if (!m) return;
    if (m.userId === session.userId) return;
    if (m.payload.length < 2) return;
    let pcm;
    try {
      const decoder = getOrCreateDecoder(m.userId);
      pcm = decoder.decode(m.payload, FRAME_SIZE);
    } catch (err) {
      return;
    }
    const frame = {
      tunerId: m.tunerId,
      freq: m.freq,
      userId: m.userId,
      senderBand: m.senderBand,
      pcm: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
    };
    for (const h of session.rxHandlers) {
      try { h(frame); } catch (err) { console.error('[udp-voice rx handler]', err); }
    }
  });

  sock.on('error', (err) => {
    console.error('[udp-voice sock error]', err.message);
  });

  return { host, port, frameSize: FRAME_SIZE, frameBytes: FRAME_BYTES };
}

function retune({ tunerId, freq, userId, senderBand } = {}) {
  if (!session) throw new Error('not open');
  if (tunerId !== undefined) session.tunerId = tunerId;
  if (freq    !== undefined) session.freq    = freq;
  if (userId  !== undefined) session.userId  = userId;
  if (senderBand !== undefined) session.senderBand = bandStringToByte(senderBand);
  session.header = buildHeader(session.tunerId, session.freq, session.userId, session.senderBand);
}

function send(pcm) {
  if (!session) throw new Error('not open');
  const buf = Buffer.isBuffer(pcm)
    ? pcm
    : Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  if (buf.length !== FRAME_BYTES) {
    throw new Error(`expected ${FRAME_BYTES} bytes (${FRAME_SIZE} samples), got ${buf.length}`);
  }
  const encoded = session.encoder.encode(buf, FRAME_SIZE);
  const pkt = Buffer.concat([session.header, encoded]);
  session.sock.send(pkt, session.port, session.host, (err) => {
    if (err) console.error('[udp-voice send]', err.message);
  });
  return encoded.length;
}

function onRx(handler) {
  if (!session) throw new Error('not open');
  session.rxHandlers.add(handler);
  return () => { session?.rxHandlers.delete(handler); };
}

function keepalive() {
  if (!session) return;
  session.sock.send(Buffer.concat([session.header, Buffer.from([0])]),
    session.port, session.host, () => {});
}

function close() {
  if (!session) return;
  session.closing = true;
  try { clearInterval(session.sweepTimer); } catch {}
  try { session.sock.close(); } catch {}
  session = null;
}

function status() {
  if (!session) return { open: false };
  return {
    open: true,
    host: session.host, port: session.port,
    tunerId: session.tunerId, freq: session.freq, userId: session.userId,
    senderBand: session.senderBand,
    frameSize: FRAME_SIZE, frameBytes: FRAME_BYTES,
  };
}

module.exports = {
  open, close, send, retune, onRx, keepalive, status,
  bandStringToByte,
  FRAME_SIZE, FRAME_BYTES, SAMPLE_RATE, WIRE_VERSION,
};
