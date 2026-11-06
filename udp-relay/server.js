// Nexus UDP voice relay — v0.
//
// Fans out voice packets to everyone else on the same {frequency, tunerId}
// room. No decoding, no mixing, no auth yet — this is step 1 of the UDP
// migration (see conversation thread). Opus encoding and session tokens
// land in later steps.
//
// Packet format (binary) v1:
//   [1 byte ] version   0x01 (reject anything else)
//   [1 byte ] tunerId   0=left, 1=right
//   [1 byte ] freqLen   N (max 16)
//   [N bytes] freq      ASCII, e.g. "160.4"
//   [2 bytes] userIdLen M (big-endian uint16, max 64)
//   [M bytes] userId    ASCII
//   [1 byte ] senderBand 0=unknown, 1=UHF, 2=VHF, 3=HF, 4=FM, 5=KY58
//   [rest   ] payload   opus (or 1-byte keepalive)
//
// A hello/bye frame isn't needed: a client that sends is implicitly a
// member, and membership is reaped on 30s silence.

const dgram = require('node:dgram');

const PORT        = Number(process.env.UDP_PORT || 41234);
const HOST        = process.env.UDP_HOST || '0.0.0.0';
const REAP_MS     = 30_000;
const REAP_EVERY  = 10_000;

const sock = dgram.createSocket('udp4');

// freqKey ("tuner|freq") -> Map<peerKey ("addr:port") -> { addr, port, userId, lastSeen }>
const rooms = new Map();

function roomKey(tunerId, freq) {
  return `${tunerId}|${freq}`;
}

function peerKey(rinfo) {
  return `${rinfo.address}:${rinfo.port}`;
}

const WIRE_VERSION = 0x01;
let wrongVersionLogged = false;

function parse(buf) {
  // v1 minimum: 1 (ver) + 1 (tuner) + 1 (freqLen) + 2 (uidLen) + 1 (band) = 6
  if (buf.length < 6) return null;
  if (buf[0] !== WIRE_VERSION) {
    if (!wrongVersionLogged) {
      console.warn(`[parse] dropping non-v1 packet (version=${buf[0]})`);
      wrongVersionLogged = true;
    }
    return null;
  }
  const tunerId = buf[1];
  if (tunerId !== 0 && tunerId !== 1) return null;
  const freqLen = buf[2];
  if (freqLen < 1 || freqLen > 16) return null;
  if (buf.length < 3 + freqLen + 2) return null;
  const freq = buf.slice(3, 3 + freqLen).toString('ascii');
  const userIdLen = buf.readUInt16BE(3 + freqLen);
  if (userIdLen > 64) return null;
  const uidStart = 3 + freqLen + 2;
  if (buf.length < uidStart + userIdLen + 1) return null;
  const userId = buf.slice(uidStart, uidStart + userIdLen).toString('ascii');
  const senderBand = buf[uidStart + userIdLen];
  return { tunerId, freq, userId, senderBand, headerLen: uidStart + userIdLen + 1 };
}

sock.on('message', (buf, rinfo) => {
  const hdr = parse(buf);
  if (!hdr) return; // silently drop malformed; no amplification surface

  const key = roomKey(hdr.tunerId, hdr.freq);
  let room = rooms.get(key);
  if (!room) {
    room = new Map();
    rooms.set(key, room);
  }

  const pk = peerKey(rinfo);
  const existed = room.has(pk);
  room.set(pk, {
    addr: rinfo.address,
    port: rinfo.port,
    userId: hdr.userId,
    lastSeen: Date.now(),
  });

  if (!existed) {
    console.log(`[join] ${hdr.userId} @ ${pk} → room=${key} (members=${room.size})`);
  }

  // Fanout to every OTHER member of the same room.
  for (const [opk, peer] of room) {
    if (opk === pk) continue;
    sock.send(buf, peer.port, peer.addr, (err) => {
      if (err) console.error(`[send] ${opk}: ${err.message}`);
    });
  }
});

sock.on('error', (err) => {
  console.error(`[sock-error] ${err.stack}`);
  sock.close();
  process.exit(1);
});

sock.on('listening', () => {
  const a = sock.address();
  console.log(`[listening] udp://${a.address}:${a.port}`);
});

// Reap silent peers. Simpler than tracking explicit bye frames and robust
// to clients that just vanish (crash, network loss).
setInterval(() => {
  const now = Date.now();
  for (const [key, room] of rooms) {
    for (const [pk, peer] of room) {
      if (now - peer.lastSeen > REAP_MS) {
        room.delete(pk);
        console.log(`[reap] ${peer.userId} @ ${pk} ← room=${key} (members=${room.size})`);
      }
    }
    if (room.size === 0) rooms.delete(key);
  }
}, REAP_EVERY).unref();

// Simple diagnostics on SIGUSR2 — print room table. Useful under pm2
// without needing to add an HTTP endpoint yet.
process.on('SIGUSR2', () => {
  const lines = [`[rooms] ${rooms.size} active:`];
  for (const [key, room] of rooms) {
    lines.push(`  ${key} → ${room.size} members`);
    for (const [pk, peer] of room) {
      lines.push(`    - ${peer.userId} @ ${pk} (idle=${Date.now() - peer.lastSeen}ms)`);
    }
  }
  console.log(lines.join('\n'));
});

sock.bind(PORT, HOST);
