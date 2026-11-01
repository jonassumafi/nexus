// Global chat — GET recent messages, POST a new one.
// Socket broadcast happens in socketManager; this file only handles REST.

const express = require('express');
const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');
const { isAuthenticated } = require('../middleware/permissions');
const { emitToAll } = require('../services/socketManager');

const router = express.Router();

const MAX_KEEP = 500;              // hard cap on stored messages
const DEFAULT_LIMIT = 100;         // how many a client fetches on open
const MIN_INTERVAL_MS = 400;       // per-user cooldown — anti-flood

// In-memory last-send timestamp per user. Cheap, resets on server restart,
// deliberately not persisted — a server restart is not a free-flood pass
// because the collection-cap and client-side batching mean an operator
// can't actually overwhelm the room.
const lastSend = new Map();

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, 500);
    const msgs = await ChatMessage.find().sort({ timestamp: -1 }).limit(limit).lean();
    // Return oldest-first so the client renders bottom-anchored naturally.
    res.json(msgs.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', isAuthenticated, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    if (text.length > 500) return res.status(400).json({ error: 'text too long' });

    const uid = String(req.user._id);
    const last = lastSend.get(uid) || 0;
    const now  = Date.now();
    if (now - last < MIN_INTERVAL_MS) {
      return res.status(429).json({ error: 'slow down' });
    }
    lastSend.set(uid, now);

    const u = req.user;
    const msg = await ChatMessage.create({
      sender_id   : u._id,
      citizen_name: u.citizen_name || u.username || 'Operator',
      avatar_url  : u.portrait_url || u.avatar_url || null,
      discord_id  : u.discord_id || null,
      text,
      timestamp   : new Date(),
    });

    // Trim old messages to keep the collection light. Done async; we don't
    // need to wait before responding.
    (async () => {
      try {
        const count = await ChatMessage.countDocuments();
        if (count > MAX_KEEP) {
          const over = count - MAX_KEEP;
          const old = await ChatMessage.find().sort({ timestamp: 1 }).limit(over).select('_id').lean();
          await ChatMessage.deleteMany({ _id: { $in: old.map(d => d._id) } });
        }
      } catch {}
    })();

    const payload = msg.toObject();
    emitToAll('chat:message', payload);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
