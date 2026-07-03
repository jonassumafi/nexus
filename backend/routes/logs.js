const express = require('express');
const MissionLog = require('../models/MissionLog');
const Mission = require('../models/Mission');
const { isAuthenticated } = require('../middleware/permissions');
const { addRPForPostMissionLog } = require('../services/rpService');
const { emitToAll } = require('../services/socketManager');

const router = express.Router();

router.post('/', isAuthenticated, async (req, res) => {
  try {
    const { mission_id, log_text } = req.body;
    if (!mission_id || !log_text) return res.status(400).json({ error: 'mission_id and log_text required' });

    const mission = await Mission.findById(mission_id).select('name');
    const citizen_name = req.user.citizen_name || req.user.username || 'Unknown';

    const log = await MissionLog.create({
      mission_id,
      user_id:      req.user._id,
      log_text,
      event_type:   'post_mission_log',
      citizen_name,
      mission_name: mission?.name || '',
      rp_earned:    3,
    });

    await addRPForPostMissionLog(req.user._id, mission_id);

    emitToAll('post_mission_log_submitted', {
      citizen_name,
      mission_name: mission?.name || '',
      rp_earned:    3,
      timestamp:    log.timestamp,
    });

    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 50);
    const logs = await MissionLog.find({
      event_type: { $nin: ['player_connected', 'player_disconnected'] },
    })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    const items = logs.map(l => ({
      _id:          l._id,
      event_type:   l.event_type || 'post_mission_log',
      citizen_name: l.citizen_name || '',
      mission_name: l.mission_name || '',
      ship_name:    l.ship_name || '',
      role_name:    l.role_name || '',
      rp_earned:    l.rp_earned || 0,
      rank_name:    l.rank_name || '',
      summary_text: l.summary_text || '',
      timestamp:    l.timestamp,
    }));

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:mission_id', isAuthenticated, async (req, res) => {
  try {
    const logs = await MissionLog.find({ mission_id: req.params.mission_id })
      .sort({ timestamp: -1 })
      .populate('user_id', 'username citizen_name avatar');
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
