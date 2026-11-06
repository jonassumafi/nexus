// Friend-system endpoints. Pending/accepted rows live in Friend. Socket
// events fan out via socketManager.emitToUser so both sides update live.
const express = require('express');
const mongoose = require('mongoose');
const Friend = require('../models/Friend');
const User = require('../models/User');
const Ship = require('../models/Ship');
const { isAuthenticated } = require('../middleware/permissions');
const { emitToUser } = require('../services/socketManager');

const router = express.Router();

// Presence hints are cheap-computed: online = socket joined to global; on
// mission = user.current_mission_assignment set. No dedicated presence
// store — the socketManager's global room is the source of truth.
async function computePresence(userIds, io) {
  const out = {};
  const want = new Set(userIds.map(String));
  if (!io || want.size === 0) {
    userIds.forEach(id => { out[String(id)] = { online: false }; });
    return out;
  }
  try {
    const sockets = await io.in('global').fetchSockets();
    const online = new Set(sockets.map(s => String(s.userId)));
    for (const id of want) out[id] = { online: online.has(id) };
  } catch {
    for (const id of want) out[id] = { online: false };
  }
  return out;
}

function otherOf(row, meId) {
  return String(row.a) === String(meId) ? row.b : row.a;
}

async function shapeFriend(row, meId, io) {
  const otherId = otherOf(row, meId);
  const u = await User.findById(otherId).select('citizen_name username avatar discord_id discord_avatar_hash current_mission_assignment created_at');
  if (!u) return null;
  const pres = await computePresence([otherId], io);
  const p = pres[String(otherId)] || { online: false };
  const onMission = u.current_mission_assignment?.mission_id || null;
  let statusLine = 'Offline';
  if (p.online) statusLine = onMission ? 'On a mission' : 'Online';
  return {
    id: String(u._id),
    userId: String(u._id),
    name: u.citizen_name || u.username || 'Unknown',
    handle: u.username || '',
    avatar: u.avatar || null,
    discord_id: u.discord_id,
    online: !!p.online,
    on_mission: !!onMission,
    status_line: statusLine,
    friend_since: row.accepted_at,
  };
}

// GET /api/friends — your friends list
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const meId = req.user._id;
    const rows = await Friend.find({ status: 'accepted', $or: [{ a: meId }, { b: meId }] });
    const io = req.app.get('io');
    const shaped = (await Promise.all(rows.map(r => shapeFriend(r, meId, io)))).filter(Boolean);
    res.json(shaped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/friends/requests — received + sent
router.get('/requests', isAuthenticated, async (req, res) => {
  try {
    const meId = req.user._id;
    const rows = await Friend.find({ status: 'pending', $or: [{ a: meId }, { b: meId }] });
    const received = [];
    const sent = [];
    for (const r of rows) {
      const otherId = otherOf(r, meId);
      const u = await User.findById(otherId).select('citizen_name username avatar discord_id');
      if (!u) continue;
      const entry = {
        requestId: String(r._id),
        userId: String(u._id),
        name: u.citizen_name || u.username || 'Unknown',
        handle: u.username || '',
        avatar: u.avatar || null,
        created_at: r.created_at,
      };
      if (String(r.requester) === String(meId)) sent.push(entry);
      else received.push(entry);
    }
    res.json({ received, sent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/friends/request { handle } — send a request (or auto-accept
// if the other person already sent one). Returns a discriminated status.
router.post('/request', isAuthenticated, async (req, res) => {
  try {
    const meId = req.user._id;
    const handle = String(req.body?.handle || '').trim();
    if (!handle) return res.status(400).json({ status: 'not_found' });

    const target = await User.findOne({
      $or: [
        { username: new RegExp(`^${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        { citizen_name: new RegExp(`^${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      ],
    }).select('_id citizen_name username avatar');
    if (!target) return res.json({ status: 'not_found' });
    if (String(target._id) === String(meId)) return res.json({ status: 'self' });

    const [a, b] = Friend.pair(meId, target._id);
    const existing = await Friend.findOne({ a, b });
    if (existing) {
      if (existing.status === 'accepted') return res.json({ status: 'already_friend' });
      // pending — if the other person sent it to us, auto-accept
      if (String(existing.requester) !== String(meId)) {
        existing.status = 'accepted';
        existing.accepted_at = new Date();
        await existing.save();
        emitToUser(String(target._id), 'friend:accepted', { userId: String(meId) });
        emitToUser(String(meId),       'friend:accepted', { userId: String(target._id) });
        return res.json({ status: 'auto_accepted', userId: String(target._id) });
      }
      return res.json({ status: 'already_sent' });
    }

    const row = await Friend.create({ a, b, status: 'pending', requester: meId });
    emitToUser(String(target._id), 'friend:request_received', { requestId: String(row._id), userId: String(meId) });
    emitToUser(String(meId),       'friend:request_sent',     { requestId: String(row._id), userId: String(target._id) });
    return res.json({ status: 'sent', requestId: String(row._id), userId: String(target._id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/friends/accept/:requestId
router.post('/accept/:requestId', isAuthenticated, async (req, res) => {
  try {
    const meId = req.user._id;
    const row = await Friend.findById(req.params.requestId);
    if (!row || row.status !== 'pending') return res.status(404).json({ error: 'request not found' });
    // Only the non-requester can accept
    if (String(row.requester) === String(meId)) return res.status(403).json({ error: 'cannot accept own request' });
    if (String(row.a) !== String(meId) && String(row.b) !== String(meId)) return res.status(403).json({ error: 'forbidden' });
    row.status = 'accepted';
    row.accepted_at = new Date();
    await row.save();
    const otherId = otherOf(row, meId);
    emitToUser(String(meId),   'friend:accepted', { userId: String(otherId) });
    emitToUser(String(otherId),'friend:accepted', { userId: String(meId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/friends/decline/:requestId
router.post('/decline/:requestId', isAuthenticated, async (req, res) => {
  try {
    const meId = req.user._id;
    const row = await Friend.findById(req.params.requestId);
    if (!row || row.status !== 'pending') return res.status(404).json({ error: 'request not found' });
    if (String(row.a) !== String(meId) && String(row.b) !== String(meId)) return res.status(403).json({ error: 'forbidden' });
    const senderId = row.requester;
    await row.deleteOne();
    emitToUser(String(senderId), 'friend:declined', { userId: String(meId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/friends/cancel/:requestId — sender rescinds
router.post('/cancel/:requestId', isAuthenticated, async (req, res) => {
  try {
    const meId = req.user._id;
    const row = await Friend.findById(req.params.requestId);
    if (!row || row.status !== 'pending') return res.status(404).json({ error: 'request not found' });
    if (String(row.requester) !== String(meId)) return res.status(403).json({ error: 'only the requester can cancel' });
    const otherId = otherOf(row, meId);
    await row.deleteOne();
    emitToUser(String(otherId), 'friend:canceled', { userId: String(meId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/friends/:userId
router.delete('/:userId', isAuthenticated, async (req, res) => {
  try {
    const meId = req.user._id;
    const otherId = req.params.userId;
    if (!mongoose.isValidObjectId(otherId)) return res.status(400).json({ error: 'bad id' });
    const [a, b] = Friend.pair(meId, otherId);
    const row = await Friend.findOneAndDelete({ a, b, status: 'accepted' });
    if (!row) return res.status(404).json({ error: 'not friends' });
    emitToUser(String(otherId), 'friend:removed', { userId: String(meId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/friends/:userId/card — compact id-card payload used by popovers
router.get('/:userId/card', isAuthenticated, async (req, res) => {
  try {
    const meId = req.user._id;
    const otherId = req.params.userId;
    if (!mongoose.isValidObjectId(otherId)) return res.status(400).json({ error: 'bad id' });
    const u = await User.findById(otherId).populate('org_id').select('citizen_name username avatar discord_id rp_rank org_id created_at current_mission_assignment');
    if (!u) return res.status(404).json({ error: 'not found' });
    const ships = await Ship.find({ owner_id: otherId }).select('ship_name is_locked current_mission_id').lean();
    const availableShips = ships.filter(s => !s.is_locked && !s.current_mission_id).length;
    const io = req.app.get('io');
    const pres = await computePresence([otherId], io);
    const online = !!pres[String(otherId)]?.online;

    let relationship = 'none';
    let requestId = null;
    if (String(meId) === String(otherId)) {
      relationship = 'self';
    } else {
      const [a, b] = Friend.pair(meId, otherId);
      const row = await Friend.findOne({ a, b });
      if (row) {
        if (row.status === 'accepted') relationship = 'friends';
        else if (String(row.requester) === String(meId)) { relationship = 'request_sent'; requestId = String(row._id); }
        else { relationship = 'request_received'; requestId = String(row._id); }
      }
    }

    res.json({
      id: String(u._id),
      name: u.citizen_name || u.username || 'Unknown',
      handle: u.username || '',
      avatar: u.avatar || null,
      rank: u.rp_rank?.name || null,
      organization: u.org_id?.name || (u.is_freelancer ? 'Freelancer' : null),
      ships_total: ships.length,
      ships_available: availableShips,
      member_since: u.created_at,
      online,
      on_mission: !!u.current_mission_assignment?.mission_id,
      relationship,
      requestId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
