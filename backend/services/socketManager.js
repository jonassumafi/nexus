const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Mission = require('../models/Mission');
const Ship = require('../models/Ship');
const MissionLog = require('../models/MissionLog');
const ShipAccessRequest = require('../models/ShipAccessRequest');

let io;

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
    socket.on('radio:ptt-start', (data) => {
      const { frequency } = data || {};
      if (!frequency) return;
      socket.to(`freq_${frequency}`).emit('radio:ptt-start', {
        userId: socket.userId,
        citizenName: socket.citizenName,
        socketId: socket.id,
      });
    });

    socket.on('radio:ptt-stop', (data) => {
      const { frequency } = data || {};
      if (!frequency) return;
      socket.to(`freq_${frequency}`).emit('radio:ptt-stop', {
        userId: socket.userId,
        citizenName: socket.citizenName,
        socketId: socket.id,
      });
    });

    // ── DISCONNECT CLEANUP ──────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const freqRooms = [...socket.rooms].filter(r => r.startsWith('freq_'));
      for (const room of freqRooms) {
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
