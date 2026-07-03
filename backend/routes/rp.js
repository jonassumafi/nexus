const express = require('express');
const RPLedger = require('../models/RPLedger');
const ShipRPLedger = require('../models/ShipRPLedger');
const PlatformConfig = require('../models/PlatformConfig');
const { isAuthenticated } = require('../middleware/permissions');
const { fetchLeaderboardPage } = require('../services/rpService');

const router = express.Router();

router.get('/ranks', async (req, res) => {
  try {
    const config = await PlatformConfig.findOne();
    res.json(config ? config.rp_ranks : []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/leaderboard', isAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 20;
    const data = await fetchLeaderboardPage(page, perPage);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/player/:id', isAuthenticated, async (req, res) => {
  try {
    const ledger = await RPLedger.find({ player_id: req.params.id })
      .sort({ applied_ts: -1 })
      .populate('mission_id', 'name mission_type')
      .populate('ship_id', 'ship_name');
    res.json(ledger);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ship/:id', isAuthenticated, async (req, res) => {
  try {
    const ledger = await ShipRPLedger.find({ ship_id: req.params.id })
      .sort({ awarded_ts: -1 })
      .populate('mission_id', 'name mission_type');
    res.json(ledger);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
