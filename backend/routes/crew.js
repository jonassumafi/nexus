const express = require('express');
const Ship = require('../models/Ship');
const User = require('../models/User');
const Mission = require('../models/Mission');
const RPLedger = require('../models/RPLedger');
const { isAuthenticated } = require('../middleware/permissions');
const { addRPForCrewSlotFilled, incrementUserRPAndUpdateRank } = require('../services/rpService');
const { emitToAll, emitToOrg } = require('../services/socketManager');
const { dispatch } = require('../services/nexusDispatch');

const router = express.Router();

router.post('/reserve', isAuthenticated, async (req, res) => {
  try {
    const { ship_id, role } = req.body;
    if (!ship_id || !role) return res.status(400).json({ error: 'ship_id and role required' });

    console.log('[Crew Reserve] body:', req.body);
    console.log('[Crew Reserve] user:', req.user?._id, req.user?.discord_id);
    const ship = await Ship.findById(ship_id);
    if (!ship) return res.status(404).json({ error: 'Ship not found' });
    if (!ship.is_mission) return res.status(400).json({ error: 'Ship is not on a mission' });

    const roleData = ship.crew_roles && ship.crew_roles[role];
    if (!roleData) return res.status(400).json({ error: `Role ${role} not found on ship` });

    const filled = roleData.filled || [];
    if (filled.length >= roleData.slots) {
      return res.status(409).json({ error: 'Role is full' });
    }

    // FIX 6 — one slot per ship: check all roles before allowing reserve
    const userId = req.user._id.toString();
    const discordId = req.user.discord_id ?? '';
    for (const rd of Object.values(ship.crew_roles)) {
      for (const entry of (rd.filled || [])) {
        const eStr = entry && typeof entry === 'object' ? (entry.discord_id ?? '') : String(entry);
        if (eStr === userId || (discordId && eStr === discordId)) {
          return res.status(400).json({ error: 'Already assigned to a slot on this ship.' });
        }
      }
    }

    filled.push(req.user.discord_id ?? req.user._id.toString());
    ship.crew_roles[role].filled = filled;
    ship.markModified('crew_roles');

    let total = 0;
    let filledCount = 0;
    for (const rd of Object.values(ship.crew_roles)) {
      total += rd.slots || 0;
      filledCount += (rd.filled || []).length;
    }
    ship.crew_fill_percentage = total > 0 ? Math.round((filledCount / total) * 100) : 0;

    await ship.save();

    await User.findByIdAndUpdate(req.user._id, {
      current_mission_assignment: { ship_id, role, mission_id: ship.current_mission_id },
    });

    let rp_earned = 0;
    if (ship.current_mission_id) {
      rp_earned = (await addRPForCrewSlotFilled(req.user._id, ship.current_mission_id, ship_id, ship.crew_fill_percentage)) ?? 0;
    }

    const emit = ship.org_id ? emitToOrg.bind(null, ship.org_id) : emitToAll;
    emit('slot_reserved', {
      shipId: ship._id, role, userId: req.user._id, crew_fill_percentage: ship.crew_fill_percentage,
      citizen_name: req.user.citizen_name ?? req.user.username ?? 'UNKNOWN OPERATOR',
      ship_name: ship.ship_name, role_name: role, rp_earned,
    });
    emit('crew_fill_updated', { shipId: ship._id, crew_fill_percentage: ship.crew_fill_percentage });

    {
      const missionDoc = ship.current_mission_id
        ? await Mission.findById(ship.current_mission_id).select('name').lean()
        : null;
      dispatch('crewSlotFilled', {
        operatorName: req.user.citizen_name || req.user.username,
        role,
        missionName: missionDoc?.name,
        vessel: ship.ship_name,
      });
    }

    res.json(ship);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/withdraw', isAuthenticated, async (req, res) => {
  try {
    const { ship_id, role } = req.body;
    if (!ship_id || !role) return res.status(400).json({ error: 'ship_id and role required' });

    console.log('[Withdraw]', { ship_id, role, user: req.user?.discord_id ?? req.user?._id?.toString() });
    const ship = await Ship.findById(ship_id);
    if (!ship) return res.status(404).json({ error: 'Ship not found' });

    const roleData = ship.crew_roles && ship.crew_roles[role];
    if (!roleData) return res.status(400).json({ error: `Role ${role} not found` });

    // FIX 8 — handle both MongoDB ObjectId entries and discord_id string entries
    const userId = req.user._id.toString();
    const discordId = req.user.discord_id ?? '';
    roleData.filled = (roleData.filled || []).filter((f) => {
      const fStr = f && typeof f === 'object' ? (f.discord_id ?? '') : String(f);
      return fStr !== userId && (!discordId || fStr !== discordId);
    });
    ship.markModified('crew_roles');

    let total = 0;
    let filledCount = 0;
    for (const rd of Object.values(ship.crew_roles)) {
      total += rd.slots || 0;
      filledCount += (rd.filled || []).length;
    }
    ship.crew_fill_percentage = total > 0 ? Math.round((filledCount / total) * 100) : 0;

    await ship.save();
    await User.findByIdAndUpdate(req.user._id, { current_mission_assignment: null });

    let rp_deducted = 0;
    if (ship.current_mission_id) {
      const originalRp = await RPLedger.findOne({
        player_id: req.user._id,
        mission_id: ship.current_mission_id,
        event_code: 'CREW_SLOT_FILLED',
      }).sort({ applied_ts: -1 });

      if (originalRp && originalRp.points > 0) {
        await RPLedger.create({
          player_id: req.user._id,
          mission_id: ship.current_mission_id,
          event_code: 'CREW_SLOT_WITHDRAWN',
          points: -originalRp.points,
        });
        await incrementUserRPAndUpdateRank(req.user._id, -originalRp.points);
        rp_deducted = originalRp.points;
      }
    }

    const emit = ship.org_id ? emitToOrg.bind(null, ship.org_id) : emitToAll;
    emit('slot_withdrawn', {
      shipId: ship._id, role, userId: req.user._id, crew_fill_percentage: ship.crew_fill_percentage,
      citizen_name: req.user.citizen_name ?? req.user.username ?? 'UNKNOWN OPERATOR',
      ship_name: ship.ship_name, role_name: role, rp_deducted,
    });
    emit('crew_fill_updated', { shipId: ship._id, crew_fill_percentage: ship.crew_fill_percentage });

    {
      const missionDoc = ship.current_mission_id
        ? await Mission.findById(ship.current_mission_id).select('name').lean()
        : null;
      dispatch('crewSlotWithdrawn', {
        operatorName: req.user.citizen_name || req.user.username,
        role,
        missionName: missionDoc?.name,
        vessel: ship.ship_name,
      });
    }

    res.json(ship);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
