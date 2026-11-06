// Round-trip test client for the UDP relay.
//
// Usage (two terminals):
//   terminal A:  node test-client.js recv alice 160.4
//   terminal B:  node test-client.js send bob 160.4
//
// Terminal A will print whatever terminal B sends. The relay must be
// running on 127.0.0.1:41234. Both clients default to tuner 1 (right).

const dgram = require('node:dgram');
const readline = require('node:readline');

const mode   = process.argv[2];
const userId = process.argv[3] || 'anon';
const freq   = process.argv[4] || '160.4';
const tuner  = Number(process.argv[5] ?? 1);
const host   = process.env.RELAY_HOST || '127.0.0.1';
const port   = Number(process.env.RELAY_PORT || 41234);

if (mode !== 'send' && mode !== 'recv') {
  console.error('Usage: node test-client.js <send|recv> <userId> [freq] [tunerId]');
  process.exit(2);
}

function buildHeader(tunerId, freq, userId) {
  const freqBuf = Buffer.from(freq, 'ascii');
  const uidBuf  = Buffer.from(userId, 'ascii');
  const hdr = Buffer.alloc(1 + 1 + freqBuf.length + 2 + uidBuf.length);
  let o = 0;
  hdr[o++] = tunerId;
  hdr[o++] = freqBuf.length;
  freqBuf.copy(hdr, o); o += freqBuf.length;
  hdr.writeUInt16BE(uidBuf.length, o); o += 2;
  uidBuf.copy(hdr, o);
  return hdr;
}

function parseIncoming(buf) {
  const tunerId   = buf[0];
  const freqLen   = buf[1];
  const freq      = buf.slice(2, 2 + freqLen).toString('ascii');
  const uidLen    = buf.readUInt16BE(2 + freqLen);
  const uidStart  = 2 + freqLen + 2;
  const userId    = buf.slice(uidStart, uidStart + uidLen).toString('ascii');
  const payload   = buf.slice(uidStart + uidLen).toString('utf8');
  return { tunerId, freq, userId, payload };
}

const sock = dgram.createSocket('udp4');
const hdr  = buildHeader(tuner, freq, userId);

sock.on('message', (buf) => {
  if (mode !== 'recv') return;
  const m = parseIncoming(buf);
  console.log(`← ${m.userId} [${m.freq}, tuner=${m.tunerId}]: ${m.payload}`);
});

sock.on('listening', () => {
  const a = sock.address();
  console.log(`[client] bound to ${a.address}:${a.port}, mode=${mode}, me=${userId}, freq=${freq}, tuner=${tuner}`);
  // Send one heartbeat so the server knows about us (recv-only clients
  // still need to be in the room to receive fanouts).
  const hb = Buffer.concat([hdr, Buffer.from('__hello__', 'utf8')]);
  sock.send(hb, port, host);
  // Keep membership alive with a quiet heartbeat every 10s.
  setInterval(() => {
    const beat = Buffer.concat([hdr, Buffer.from('__ping__', 'utf8')]);
    sock.send(beat, port, host);
  }, 10_000).unref();
});

sock.bind();

if (mode === 'send') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  console.log('[client] type a message + Enter to transmit (Ctrl+C to quit)');
  rl.on('line', (line) => {
    const pkt = Buffer.concat([hdr, Buffer.from(line, 'utf8')]);
    sock.send(pkt, port, host, (err) => {
      if (err) console.error('[send-error]', err.message);
    });
  });
}
