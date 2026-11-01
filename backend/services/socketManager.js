const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Mission = require('../models/Mission');
const Ship = require('../models/Ship');
const MissionLog = require('../models/MissionLog');
const ShipAccessRequest = require('../models/ShipAccessRequest');
const radioModels = require('./radioModels');

let io;

// Map freq-room name → Set of socketIds currently holding PTT down. Used
// to detect simultaneous-transmission collisions in the PTT relay below.
const pttActiveByFreq = new Map();

async function verifyCrewAccess(userId, discordId, missionId) {
  try {
    const ships = await Ship.find({ current_mission_id: missionId });
    for (const ship of ships) {
      for (const roleData of Object.values(ship.crew_roles || {})) {
        for (const id of roleData.filled || []) {
          const s = String(id);
          if (s === userId || s === discordId) return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

function init(socketIo) {
  io = socketIo;

  io.use(async (socket, next) => {
    const token = socket.handshake.query.token || socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (!user) return next(new Error('User not found'));
      socket.user        = user;
      socket.userId      = user._id.toString();
      socket.discordId   = user.discord_id;
      socket.citizenName = user.citizen_name || user.username || 'UNKNOWN';
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // Expire pending requests (1hr) and active loans (4hr) every 60s.
  setInterval(async () => {
    try {
      const now = new Date();

      const pendingExpired = await ShipAccessRequest.find({
        status: 'pending',
        expires_at: { $lte: now },
      });
      for (const r of pendingExpired) {
        r.status = 'expired';
        await r.save();
        const ship = await Ship.findById(r.ship_id).select('ship_name').lean();
        emitToUser(r.requester_id.toString(), 'ship:access_expired', {
          requestId: r._id,
          shipId: r.ship_id,
          shipName: ship?.ship_name || '',
        });
      }

      const loanExpired = await ShipAccessRequest.find({
        status: 'approved',
        loan_expires_at: { $lte: now },
      });
      for (const r of loanExpired) {
        r.status = 'expired';
        await r.save();
        await User.findByIdAndUpdate(r.requester_id, {
          $pull: { borrowed_ships: { request_id: r._id } },
        });
        const ship = await Ship.findById(r.ship_id).select('ship_name').lean();
        emitToUser(r.requester_id.toString(), 'ship:access_expired', {
          requestId: r._id,
          shipId: r.ship_id,
          shipName: ship?.ship_name || '',
        });
      }
    } catch (err) {
      console.error('[AccessRequest expiry]', err.message);
    }
  }, 60000);

  io.on('connection', (socket) => {
    socket.join('global');
    if (socket.user.org_id) {
      socket.join(`org_${socket.user.org_id}`);
    }
    socket.join(`user_${socket.user._id}`);

    // Live online-player count. Broadcast after this socket joins so the
    // joiner also sees the up-to-date number. Deduped per userId so that
    // a single operator with two browser tabs doesn't double-count.
    (async () => {
      try {
        const all = await io.in('global').fetchSockets();
        const unique = new Set(all.map(s => String(s.userId)));
        io.to('global').emit('presence:online_count', { count: unique.size });
      } catch {}
    })();

    socket.emit('presence:hello');

    // Request-current — the client can nudge us whenever it mounts in
    // case it missed the broadcast between page load and socket attach.
    socket.on('presence:ping', async () => {
      try {
        const all = await io.in('global').fetchSockets();
        const unique = new Set(all.map(s => String(s.userId)));
        socket.emit('presence:online_count', { count: unique.size });
      } catch {}
    });

    (async () => {
      try {
        const cutoff = new Date(Date.now() - 60000);
        const recent = await MissionLog.findOne({
          event_type: 'player_connected',
          citizen_name: socket.citizenName,
          timestamp: { $gt: cutoff },
        });
        if (!recent) {
          await MissionLog.create({
            event_type: 'player_connected',
            citizen_name: socket.citizenName,
            timestamp: new Date(),
          });
          emitToAll('activity_event', {
            event_type: 'player_connected',
            citizen_name: socket.citizenName,
            timestamp: new Date(),
          });
        }
      } catch {}
    })();

    // ── JOIN FREQUENCY ──────────────────────────────────────────────────────
    socket.on('radio:join', async (data) => {
      try {
        const { frequency, missionId } = data || {};
        if (!frequency) {
          socket.emit('radio:error', { message: 'frequency required' });
          return;
        }

        if (missionId) {
          const mission = await Mission.findById(missionId);
          if (!mission) {
            socket.emit('radio:error', { message: 'MISSION NOT FOUND' });
            return;
          }
        }

        const room = `freq_${frequency}`;

        // Leave any previous frequency rooms
        const prevRooms = [...socket.rooms].filter(r => r.startsWith('freq_'));
        for (const r of prevRooms) {
          socket.leave(r);
          socket.to(r).emit('radio:peer-left', {
            socketId: socket.id,
            userId: socket.userId,
            citizenName: socket.citizenName,
          });
        }

        // Evict any stale sockets for this same user already in the target room
        // (e.g. lingering old socket from a browser refresh).
        const existingSockets = await io.in(room).fetchSockets();
        for (const s of existingSockets) {
          if (s.userId === socket.userId && s.id !== socket.id) {
            s.leave(room);
            io.to(room).emit('radio:peer-left', {
              socketId: s.id,
              userId: s.userId,
              citizenName: s.citizenName,
            });
          }
        }

        socket.join(room);

        socket.to(room).emit('radio:peer-joined', {
          userId: socket.userId,
          citizenName: socket.citizenName,
          socketId: socket.id,
        });

        const roomSockets = await io.in(room).fetchSockets();
        const peers = roomSockets
          .filter(s => s.id !== socket.id)
          .map(s => ({
            userId: s.userId,
            citizenName: s.citizenName,
            socketId: s.id,
          }));

        socket.emit('radio:room-peers', { frequency, peers });
      } catch (err) {
        socket.emit('radio:error', { message: err.message });
      }
    });

    // ── LEAVE FREQUENCY ─────────────────────────────────────────────────────
    socket.on('radio:leave', (data) => {
      const { frequency } = data || {};
      if (!frequency) return;
      const room = `freq_${frequency}`;
      socket.leave(room);
      socket.to(room).emit('radio:peer-left', {
        socketId: socket.id,
        userId: socket.userId,
        citizenName: socket.citizenName,
      });
    });

    // ── WEBRTC OFFER ────────────────────────────────────────────────────────
    socket.on('radio:offer', (data) => {
      const { targetSocketId, offer, frequency } = data || {};
      if (!targetSocketId || !offer) return;
      io.to(targetSocketId).emit('radio:offer', {
        offer,
        fromSocketId: socket.id,
        fromUserId: socket.userId,
        fromCitizenName: socket.citizenName,
        frequency,
      });
    });

    // ── WEBRTC ANSWER ───────────────────────────────────────────────────────
    socket.on('radio:answer', (data) => {
      const { targetSocketId, answer } = data || {};
      if (!targetSocketId || !answer) return;
      io.to(targetSocketId).emit('radio:answer', {
        answer,
        fromSocketId: socket.id,
      });
    });

    // ── ICE CANDIDATE ───────────────────────────────────────────────────────
    socket.on('radio:ice-candidate', (data) => {
      const { targetSocketId, candidate } = data || {};
      if (!targetSocketId || !candidate) return;
      io.to(targetSocketId).emit('radio:ice-candidate', {
        candidate,
        fromSocketId: socket.id,
      });
    });

    // ── PTT RELAY ───────────────────────────────────────────────────────────
    // Per-frequency live-transmitter tracking so we can detect collisions
    // and tag ptt-start events with crypto status for the KY-58 chirp.
    socket.on('radio:ptt-start', async (data) => {
      const { frequency } = data || {};
      if (!frequency) return;
      const room = `freq_${frequency}`;

      // Resolve this operator's radio type → crypto flag. Lookup is in
      // memory via radioModels (28 presets, cheap).
      let crypto = false;
      try {
        const u = socket.user;
        const rig = u?.radio_type ? radioModels.byId(u.radio_type) : null;
        crypto = !!(rig?.spec?.encryptionEffect?.$type === 'cvsd');
      } catch {}

      // Detect simultaneous transmission on this frequency — if any
      // other socket in this room is already transmitting, broadcast
      // a collision event to EVERYONE on the freq (including the
      // transmitters themselves so they hear the clash too).
      const activeTxers = pttActiveByFreq.get(room);
      if (activeTxers && activeTxers.size > 0 && !activeTxers.has(socket.id)) {
        io.to(room).emit('radio:collision', {
          frequency,
          transmitters: [...activeTxers, socket.id],
        });
      }
      if (!activeTxers) pttActiveByFreq.set(room, new Set([socket.id]));
      else activeTxers.add(socket.id);

      socket.to(room).emit('radio:ptt-start', {
        userId: socket.userId,
        citizenName: socket.citizenName,
        socketId: socket.id,
        crypto,
      });
    });

    socket.on('radio:ptt-stop', (data) => {
      const { frequency } = data || {};
      if (!frequency) return;
      const room = `freq_${frequency}`;
      const active = pttActiveByFreq.get(room);
      if (active) {
        active.delete(socket.id);
        if (active.size === 0) pttActiveByFreq.delete(room);
      }
      socket.to(room).emit('radio:ptt-stop', {
        userId: socket.userId,
        citizenName: socket.citizenName,
        socketId: socket.id,
      });
    });

    // ── DISCONNECT CLEANUP ──────────────────────────────────────────────────
    // We listen on `disconnecting` — not `disconnect` — because Socket.IO
    // clears `socket.rooms` *before* firing `disconnect`, which meant the
    // freq-room filter below found nothing and no `radio:peer-left` was
    // ever broadcast. Symptom: on browser refresh the leaving user's name
    // lingered in every remaining client's UI, and their fresh
    // connection appeared as a *second* entry alongside the ghost.
    // At `disconnecting` time the socket is still in its rooms so the
    // broadcast reaches all remaining peers cleanly.
    socket.on('disconnecting', () => {
      // Broadcast the new online count AFTER this socket leaves. Using
      // setImmediate so the socket.io room exit has flushed before we count.
      setImmediate(async () => {
        try {
          const all = await io.in('global').fetchSockets();
          const unique = new Set(all.map(s => String(s.userId)));
          io.to('global').emit('presence:online_count', { count: unique.size });
        } catch {}
      });

      const freqRooms = [...socket.rooms].filter(r => r.startsWith('freq_'));
      for (const room of freqRooms) {
        // Clear this socket from the room's active-PTT set so a
        // disconnect-mid-transmission doesn't leave a ghost that
        // triggers phantom collisions.
        const active = pttActiveByFreq.get(room);
        if (active) {
          active.delete(socket.id);
          if (active.size === 0) pttActiveByFreq.delete(room);
        }
        socket.to(room).emit('radio:peer-left', {
          socketId: socket.id,
          userId: socket.userId,
          citizenName: socket.citizenName,
        });
      }
      (async () => {
        try {
          const cutoff = new Date(Date.now() - 60000);
          const recent = await MissionLog.findOne({
            event_type: 'player_disconnected',
            citizen_name: socket.citizenName,
            timestamp: { $gt: cutoff },
          });
          if (!recent) {
            await MissionLog.create({
              event_type: 'player_disconnected',
              citizen_name: socket.citizenName,
              timestamp: new Date(),
            });
            emitToAll('activity_event', {
              event_type: 'player_disconnected',
              citizen_name: socket.citizenName,
              timestamp: new Date(),
            });
          }
        } catch {}
      })();
    });
  });
}

function emitToAll(event, data) {
  if (io) io.to('global').emit(event, data);
}

function emitToOrg(orgId, event, data) {
  if (io) io.to(`org_${orgId}`).emit(event, data);
}

function emitToUser(userId, event, data) {
  if (io) io.to(`user_${userId}`).emit(event, data);
}

module.exports = { init, emitToAll, emitToOrg, emitToUser };
