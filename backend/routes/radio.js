const express = require('express');
const crypto = require('crypto');
const Mission = require('../models/Mission');
const Ship = require('../models/Ship');
const { isAuthenticated } = require('../middleware/permissions');

const router = express.Router();

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
