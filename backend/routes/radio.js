const express = require('express');
const crypto = require('crypto');
const Mission = require('../models/Mission');
const Ship = require('../models/Ship');
const User = require('../models/User');
const { isAuthenticated } = require('../middleware/permissions');
const radioModels = require('../services/radioModels');

const router = express.Router();

// ── Radio-model catalog ─────────────────────────────────────────────────
router.get('/models', isAuthenticated, (req, res) => {
  res.json(radioModels.pickerList().map(r => ({
    ...r,
    spec: radioModels.byId(r.id)?.spec,
  })));
});

// ── Player's own radio ──────────────────────────────────────────────────
// If the user hasn't been assigned one yet, randomly pick + persist.
router.get('/my-radio', isAuthenticated, async (req, res) => {
  try {
    let u = await User.findById(req.user._id);
    if (!u) return res.status(404).json({ error: 'user not found' });
    if (!u.radio_type || !radioModels.byId(u.radio_type)) {
      u.radio_type = radioModels.randomRadio();
      await u.save();
    }
    const entry = radioModels.byId(u.radio_type);
    res.json({
      radio_type: u.radio_type,
      radio: entry ? { ...entry } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin / platform-owner only: force a specific radio onto a player, or
// `{ reroll: true }` to randomly re-assign.
router.put('/user/:userId/radio', isAuthenticated, async (req, res) => {
  try {
    if (!req.user.is_platform_owner) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const u = await User.findById(req.params.userId);
    if (!u) return res.status(404).json({ error: 'user not found' });

    if (req.body?.reroll) {
      u.radio_type = radioModels.randomRadio();
    } else {
      const next = String(req.body?.radio_type || '');
      if (!radioModels.byId(next)) {
        return res.status(400).json({ error: 'unknown radio_type' });
      }
      u.radio_type = next;
    }
    await u.save();
    res.json({ radio_type: u.radio_type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radio/turn-credentials
router.get('/turn-credentials', isAuthenticated, (req, res) => {
  try {
    const secret = process.env.TURN_SECRET;
    if (!secret) return res.status(500).json({ error: 'TURN_SECRET not configured' });

    const ttl = 86400;
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${timestamp}:${req.user.discord_id}`;
    const credential = crypto
      .createHmac('sha1', secret)
      .update(username)
      .digest('base64');

    const turnServer = process.env.TURN_SERVER;
    const turnsServer = turnServer.replace('turn:', 'turns:').replace('3478', '5349');

    res.json({ urls: [turnServer, turnsServer], username, credential, ttl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radio/frequency/:missionId
// Returns mission frequency only if the requesting user has a reserved crew slot.
router.get('/frequency/:missionId', isAuthenticated, async (req, res) => {
  try {
    const mission = await Mission.findById(req.params.missionId);
    if (!mission) return res.status(404).json({ error: 'Mission not found' });

    const ships = await Ship.find({ current_mission_id: mission._id });

    const userId = req.user._id.toString();
    const discordId = req.user.discord_id;

    let hasAccess = false;
    outer: for (const ship of ships) {
      for (const roleData of Object.values(ship.crew_roles || {})) {
        for (const id of roleData.filled || []) {
          const s = String(id);
          if (s === userId || s === discordId) {
            hasAccess = true;
            break outer;
          }
        }
      }
    }

    if (!hasAccess) {
      return res.status(403).json({ error: 'ACCESS DENIED — CREW ONLY' });
    }

    res.json({ frequency: mission.frequency });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
