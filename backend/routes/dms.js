// Direct messages — 1:1 only, plain text, no read receipts, no attachments.
// Only friends can DM each other.
const express = require('express');
const mongoose = require('mongoose');
const DirectMessage = require('../models/DirectMessage');
const Friend = require('../models/Friend');
const User = require('../models/User');
const { isAuthenticated } = require('../middleware/permissions');
const { emitToUser } = require('../services/socketManager');

const router = express.Router();

async function areFriends(meId, peerId) {
  const [a, b] = Friend.pair(meId, peerId);
  const row = await Friend.findOne({ a, b, status: 'accepted' });
  return !!row;
}

function shape(m) {
  return {
    id:         String(m._id),
    from:       String(m.from),
    to:         String(m.to),
    body:       m.body,
    created_at: m.created_at,
  };
}

// GET /api/dms/threads — one row per peer, newest message included.
router.get('/threads', isAuthenticated, async (req, res) => {
  const meId = req.user._id;
  const meObj = new mongoose.Types.ObjectId(meId);
  try {
    // Latest message per pair where I'm a participant.
    const rows = await DirectMessage.aggregate([
      { $match: { $or: [{ from: meObj }, { to: meObj }] } },
      { $sort: { created_at: -1 } },
      { $group: { _id: '$pair', last: { $first: '$$ROOT' } } },
      { $sort: { 'last.created_at': -1 } },
      { $limit: 100 },
    ]);
    const peerIds = rows.map(r => {
      const m = r.last;
      return String(m.from) === String(meId) ? m.to : m.from;
    });
    const users = await User.find({ _id: { $in: peerIds } })
      .select('citizen_name username avatar discord_id discord_avatar_hash');
    const byId = new Map(users.map(u => [String(u._id), u]));
    const threads = rows.map(r => {
      const m = r.last;
      const peerId = String(m.from) === String(meId) ? String(m.to) : String(m.from);
      const u = byId.get(peerId);
      return {
        peerId,
        name: u?.citizen_name || u?.username || 'Unknown',
        avatar: u?.avatar || null,
        last: shape(m),
      };
    });
    res.json({ threads });
  } catch (err) {
    console.error('[dms] threads', err);
    res.status(500).json({ error: 'FAILED_TO_LIST_THREADS' });
  }
});

// GET /api/dms/:peerId?before=<ISO>&limit=50 — older first order.
router.get('/:peerId', isAuthenticated, async (req, res) => {
  const meId = req.user._id;
  const peerId = req.params.peerId;
  if (!mongoose.isValidObjectId(peerId)) return res.status(400).json({ error: 'BAD_PEER' });
  if (!(await areFriends(meId, peerId))) return res.status(403).json({ error: 'NOT_FRIENDS' });
  const pair = DirectMessage.pairKey(meId, peerId);
  const before = req.query.before ? new Date(req.query.before) : null;
  const limit  = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
  const q = { pair };
  if (before && !isNaN(before.getTime())) q.created_at = { $lt: before };
  const rows = await DirectMessage.find(q).sort({ created_at: -1 }).limit(limit);
  res.json({ messages: rows.reverse().map(shape) });
});

// POST /api/dms/:peerId — { body }
router.post('/:peerId', isAuthenticated, async (req, res) => {
  const meId = req.user._id;
  const peerId = req.params.peerId;
  if (!mongoose.isValidObjectId(peerId)) return res.status(400).json({ error: 'BAD_PEER' });
  if (String(meId) === String(peerId))   return res.status(400).json({ error: 'CANNOT_DM_SELF' });
  if (!(await areFriends(meId, peerId))) return res.status(403).json({ error: 'NOT_FRIENDS' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'EMPTY_BODY' });
  if (body.length > 2000) return res.status(400).json({ error: 'TOO_LONG' });
  const pair = DirectMessage.pairKey(meId, peerId);
  const doc = await DirectMessage.create({ pair, from: meId, to: peerId, body });
  // Per-pair cap: keep only the 500 newest. Cheap because the compound
  // {pair, created_at} index is already present.
  const PAIR_CAP = 500;
  const total = await DirectMessage.countDocuments({ pair });
  if (total > PAIR_CAP) {
    const oldest = await DirectMessage.find({ pair })
      .sort({ created_at: 1 })
      .limit(total - PAIR_CAP)
      .select('_id');
    if (oldest.length) await DirectMessage.deleteMany({ _id: { $in: oldest.map(o => o._id) } });
  }
  const payload = shape(doc);
  emitToUser(String(peerId), 'dm:new', payload);
  emitToUser(String(meId),   'dm:new', payload);
  res.json({ message: payload });
});

module.exports = router;
