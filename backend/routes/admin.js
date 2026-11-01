const express = require('express');
const PlatformConfig = require('../models/PlatformConfig');
const User = require('../models/User');
const { isAuthenticated, isPlatformOwner } = require('../middleware/permissions');

const router = express.Router();

router.use(isAuthenticated, isPlatformOwner);

// Minimal user list for the admin radio-reassignment panel.
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, {
      _id: 1, citizen_name: 1, username: 1, discord_id: 1,
      radio_type: 1, rp_rank: 1, created_at: 1,
    }).sort({ citizen_name: 1 }).lean();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/config', async (req, res) => {
  try {
    const config = await PlatformConfig.findOne();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config/mission-types', async (req, res) => {
  try {
    const config = await PlatformConfig.findOneAndUpdate(
      {},
      { mission_types: req.body },
      { new: true }
    );
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config/ship-types', async (req, res) => {
  try {
    const config = await PlatformConfig.findOneAndUpdate(
      {},
      { ship_types: req.body },
      { new: true }
    );
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config/crew-roles', async (req, res) => {
  try {
    const config = await PlatformConfig.findOneAndUpdate(
      {},
      { crew_roles: req.body },
      { new: true }
    );
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config/rp-settings', async (req, res) => {
  try {
    const config = await PlatformConfig.findOneAndUpdate(
      {},
      { rp_settings: req.body },
      { new: true }
    );
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config/rp-ranks', async (req, res) => {
  try {
    const config = await PlatformConfig.findOneAndUpdate(
      {},
      { rp_ranks: req.body },
      { new: true }
    );
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config/ship-limits', async (req, res) => {
  try {
    const { max_ships_per_player, max_ships_per_mission } = req.body;
    const updates = {};
    if (max_ships_per_player !== undefined) updates.max_ships_per_player = max_ships_per_player;
    if (max_ships_per_mission !== undefined) updates.max_ships_per_mission = max_ships_per_mission;

    const config = await PlatformConfig.findOneAndUpdate({}, updates, { new: true });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config/ai-summary', async (req, res) => {
  try {
    const { ai_summary_enabled } = req.body;
    const config = await PlatformConfig.findOneAndUpdate(
      {},
      { ai_summary_enabled },
      { new: true }
    );
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
