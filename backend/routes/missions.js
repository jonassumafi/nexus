const express = require('express');
const Mission = require('../models/Mission');
const MissionArchive = require('../models/MissionArchive');
const MissionLog = require('../models/MissionLog');
const Ship = require('../models/Ship');
const User = require('../models/User');
const PlatformConfig = require('../models/PlatformConfig');
const { isAuthenticated } = require('../middleware/permissions');
const { validateMissionForLaunch, completeMission, resetMissionAssociations, abortMission } = require('../services/missionService');
const { addRPForMissionLaunch } = require('../services/rpService');
const { emitToAll, emitToOrg } = require('../services/socketManager');

const router = express.Router();

function generateFrequency() {
  const raw = Math.floor(Math.random() * 190) + 1180;
  return (raw / 10).toFixed(1);
}

router.get('/check-name', isAuthenticated, async (req, res) => {
  try {
    const name = (req.query.name || '').trim();
    if (!name) return res.json({ available: false });
    const existing = await Mission.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    res.json({ available: !existing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/archive', isAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 20;
    const skip = (page - 1) * perPage;
    const archives = await MissionArchive.find()
      .sort({ completed_at: -1 })
      .skip(skip)
      .limit(perPage)
      .populate('created_by', 'username citizen_name');
    const total = await MissionArchive.countDocuments();
    res.json({ archives, total, page, perPage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', isAuthenticated, async (req, res) => {
  try {
    const config = await PlatformConfig.findOne();
    const maxShips = config ? config.max_ships_per_mission : 3;

    const {
      name, mission_type, objectives, primary_ship, supporting_ships,
      mission_time, is_public, org_id, queue_expires_minutes, crew_roles,
      frequency,
    } = req.body;

    if (!name || !primary_ship) return res.status(400).json({ error: 'name and primary_ship required' });

    const supporting = supporting_ships || [];
    if (supporting.length > maxShips - 1) {
      return res.status(400).json({ error: `Max ${maxShips - 1} supporting ships` });
    }

    const missionTimeDate = mission_time ? new Date(mission_time) : null;
    let queueExpiresAt = null;
    if (queue_expires_minutes != null) {
      const baseTime = missionTimeDate ? missionTimeDate.getTime() : Date.now();
      queueExpiresAt = new Date(baseTime + parseInt(queue_expires_minutes, 10) * 60 * 1000);
    }

    // Verify all ships are available (not already on an active mission)
    for (const shipId of [primary_ship, ...(supporting_ships || [])]) {
      const sc = await Ship.findById(shipId).select('ship_name is_mission current_mission_id');
      if (!sc) return res.status(404).json({ error: `Ship ${shipId} not found` });
      if (sc.is_mission || sc.current_mission_id) {
        return res.status(400).json({
          error: 'SHIP_UNAVAILABLE',
          message: `${sc.ship_name} is already assigned to an active mission`,
        });
      }
    }

    const mission = await Mission.create({
      name,
      mission_type,
      objectives,
      created_by: req.user._id,
      org_id: org_id || req.user.org_id || null,
      is_public: is_public !== undefined ? is_public : true,
      status: 'WAITING FOR CREW',
      primary_ship,
      supporting_ships: supporting,
      mission_time: missionTimeDate,
      queue_expires_at: queueExpiresAt,
      frequency: frequency || generateFrequency(),
    });

    // Update each ship's crew_roles (from body if present, else from node_positions)
    // and mark as on-mission. Emit ship_borrowed for any supporting ship not owned by creator.
    const allShipIds = [primary_ship, ...supporting];
    const creatorIdStr = req.user._id.toString();
    for (const shipId of allShipIds) {
      const ship = await Ship.findById(shipId);
      if (!ship) continue;

      let nextCrewRoles = (crew_roles && crew_roles[shipId.toString()]) || null;
      if (!nextCrewRoles && Array.isArray(ship.node_positions) && ship.node_positions.length) {
        nextCrewRoles = {};
        for (const n of ship.node_positions) {
          if (!nextCrewRoles[n.role]) nextCrewRoles[n.role] = { slots: 0, filled: [] };
          nextCrewRoles[n.role].slots += 1;
        }
      }
      const update = { is_mission: true, current_mission_id: mission._id };
      if (nextCrewRoles) update.crew_roles = nextCrewRoles;
      await Ship.findByIdAndUpdate(shipId, update);

      // Borrowed-ship event for supporting ships not owned by the creator
      if (shipId.toString() !== primary_ship.toString() &&
          ship.owner_id && ship.owner_id.toString() !== creatorIdStr) {
        try {
          await MissionLog.create({
            mission_id: mission._id,
            user_id: req.user._id,
            event_type: 'ship_borrowed',
            citizen_name: req.user.citizen_name || req.user.username || 'Unknown',
            mission_name: mission.name,
            ship_name: ship.ship_name,
          });
          emitToAll('ship_borrowed', {
            event_type: 'ship_borrowed',
            citizen_name: req.user.citizen_name || req.user.username || 'Unknown',
            mission_name: mission.name,
            ship_name: ship.ship_name,
            timestamp: new Date().toISOString(),
          });
        } catch (e) {
          console.error('[CreateMission] ship_borrowed emit failed:', e.message);
        }
      }
    }

    const emit = mission.org_id ? emitToOrg.bind(null, mission.org_id) : emitToAll;
    emit('mission_created', { missionId: mission._id, name: mission.name });

    res.status(201).json(mission);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Mission name already taken' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    const orgId = user.org_id ? user.org_id.toString() : null;

    // TODO: re-enable org filtering after real player
    // relationships are established
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    } else if (!req.query.all) {
      const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
      filter.$or = [
        { hidden_at: null },
        { hidden_at: { $gt: cutoff } },
      ];
    }

    const missions = await Mission.find(filter)
      .populate('primary_ship')
      .populate('supporting_ships')
      .populate('created_by', 'username citizen_name discord_id');

    // Collect both string discord_ids and ObjectId entries so InProgressView
    // can render citizen names for registered web-native crew, not just
    // legacy Discord-native entries.
    const OID_RE = /^[a-f0-9]{24}$/i;
    const discordIdSet = new Set();
    const objectIdSet = new Set();
    for (const m of missions) {
      const ships = [m.primary_ship, ...(m.supporting_ships || [])].filter(Boolean);
      for (const ship of ships) {
        for (const roleDef of Object.values(ship.crew_roles || {})) {
          for (const id of (roleDef.filled || [])) {
            const s = String(id);
            if (OID_RE.test(s)) objectIdSet.add(s);
            else discordIdSet.add(s);
          }
        }
      }
    }

    const orClauses = [];
    if (discordIdSet.size) orClauses.push({ discord_id: { $in: [...discordIdSet] } });
    if (objectIdSet.size)  orClauses.push({ _id: { $in: [...objectIdSet] } });
    const crewUsers = orClauses.length
      ? await User.find({ $or: orClauses }, { discord_id: 1, citizen_name: 1 })
      : [];
    const nameMap = {};
    for (const u of crewUsers) {
      if (u.discord_id) nameMap[u.discord_id] = u.citizen_name;
      nameMap[u._id.toString()] = u.citizen_name;
    }

    const enrichShip = (ship) => {
      if (!ship || !ship.crew_roles) return ship;
      const roles = {};
      for (const [role, def] of Object.entries(ship.crew_roles)) {
        roles[role] = {
          ...def,
          filled: (def.filled || []).map(id => {
            const discordId = id.toString();
            return { discord_id: discordId, citizen_name: nameMap[discordId] || 'Unknown' };
          }),
        };
      }
      return { ...ship, crew_roles: roles };
    };

    const result = missions.map(m => {
      const obj = m.toObject();
      return {
        ...obj,
        is_org_mission: !!(orgId && obj.org_id && obj.org_id.toString() === orgId),
        primary_ship: enrichShip(obj.primary_ship),
        supporting_ships: (obj.supporting_ships || []).map(enrichShip),
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/types', async (req, res) => {
  try {
    const config = await PlatformConfig.findOne({}, { mission_types: 1 });
    res.json(config ? config.mission_types : []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', isAuthenticated, async (req, res) => {
  try {
    const mission = await Mission.findById(req.params.id)
      .populate('primary_ship')
      .populate('supporting_ships')
      .populate('created_by', 'username citizen_name discord_id');
    if (!mission) return res.status(404).json({ error: 'Mission not found' });
    res.json(mission);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/finalize', isAuthenticated, async (req, res) => {
  try {
    const mission = await Mission.findById(req.params.id);
    if (!mission) return res.status(404).json({ error: 'Mission not found' });

    mission.status = 'FINALIZED';
    await mission.save();

    emitToAll('mission_finalized', {
      missionId: mission._id,
      mission_name: mission.name,
      citizen_name: req.user.citizen_name ?? req.user.username ?? 'UNKNOWN OPERATOR',
    });
    res.json(mission);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/launch', isAuthenticated, async (req, res) => {
  try {
    const mission = await Mission.findById(req.params.id);
    if (!mission) return res.status(404).json({ error: 'Mission not found' });

    const { emptyShips } = await validateMissionForLaunch(mission);

    for (const shipId of emptyShips) {
      await Ship.findByIdAndUpdate(shipId, { is_mission: false, current_mission_id: null });
      mission.supporting_ships = mission.supporting_ships.filter((s) => s.toString() !== shipId.toString());
    }

    mission.status = 'IN PROGRESS';
    const launchTs = new Date();
    mission.start_time = launchTs;
    mission.launched_at = launchTs;
    await mission.save();

    const rp_awarded = (await addRPForMissionLaunch(req.user._id, mission._id)) ?? 0;

    emitToAll('mission_launched', {
      missionId: mission._id,
      mission_name: mission.name,
      citizen_name: req.user.citizen_name ?? req.user.username ?? 'UNKNOWN OPERATOR',
      rp_awarded,
    });
    res.json(mission);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/complete', isAuthenticated, async (req, res) => {
  try {
    const mission = await Mission.findById(req.params.id);
    if (!mission) return res.status(404).json({ error: 'Mission not found' });
    if (mission.status !== 'IN PROGRESS') {
      return res.status(400).json({ error: 'Mission must be IN PROGRESS to complete' });
    }
    if (String(mission.created_by) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Not mission commander' });
    }
    const citizenName = req.user.citizen_name ?? req.user.username ?? 'UNKNOWN OPERATOR';
    const result = await completeMission(req.params.id, citizenName);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/post-mission-log — crew log submission fired from the modal
// prompt. Storage lives in MissionLog (same collection the activity feed
// reads from), with a per-user-per-mission duplicate guard.
router.post('/:id/post-mission-log', isAuthenticated, async (req, res) => {
  try {
    const { log_content } = req.body;
    const text = (log_content || '').trim();
    if (!text) return res.status(400).json({ error: 'log_content required' });
    if (text.length > 1000) return res.status(400).json({ error: 'log_content max 1000 chars' });

    const mission = await Mission.findById(req.params.id).select('name status');
    if (!mission) return res.status(404).json({ error: 'Mission not found' });
    if (mission.status !== 'IN PROGRESS' && mission.status !== 'COMPLETE') {
      return res.status(400).json({ error: 'Mission must be launched or complete to submit a log' });
    }

    const existing = await MissionLog.findOne({
      mission_id: mission._id,
      user_id: req.user._id,
      event_type: 'post_mission_log',
    });
    if (existing) return res.status(409).json({ error: 'Log already submitted for this mission' });

    const citizen_name = req.user.citizen_name || req.user.username || 'Unknown';
    const log = await MissionLog.create({
      mission_id: mission._id,
      user_id: req.user._id,
      log_text: text,
      event_type: 'post_mission_log',
      citizen_name,
      mission_name: mission.name,
      rp_earned: 3,
    });

    const { addRPForPostMissionLog } = require('../services/rpService');
    await addRPForPostMissionLog(req.user._id, mission._id);

    emitToAll('post_mission_log_submitted', {
      citizen_name,
      mission_name: mission.name,
      rp_earned: 3,
      timestamp: log.timestamp,
    });

    res.status(201).json({ success: true, rp_earned: 3 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/abort', isAuthenticated, async (req, res) => {
  try {
    const result = await abortMission(req.params.id);
    res.json(result);
  } catch (err) {
    const status = err.message === 'Mission not found' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PATCH /api/missions/:id/status — creator-only status transitions
router.patch('/:id/status', isAuthenticated, async (req, res) => {
  try {
    const { status } = req.body;
    const VALID = ['FINALIZED', 'IN PROGRESS', 'COMPLETE', 'ABORTED'];
    if (!VALID.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const mission = await Mission.findById(req.params.id)
      .populate('primary_ship')
      .populate('supporting_ships');
    if (!mission) return res.status(404).json({ error: 'Mission not found' });

    if (String(mission.created_by) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Not mission creator' });
    }

    // Map frontend 'ABORTED' → DB 'ABORT'
    const dbStatus = status === 'ABORTED' ? 'ABORT' : status;

    if (status === 'FINALIZED') {
      const pShip = mission.primary_ship;
      // TEMPORARY: Pilot requirement disabled for solo testing.
      // Restore before public launch.
      // TODO: re-enable Pilot check
      // const pilotFilled = (pShip?.crew_roles?.['Pilot']?.filled || []).length > 0;
      let totalFilled = 0;
      for (const ship of [pShip, ...mission.supporting_ships].filter(Boolean)) {
        for (const rd of Object.values(ship.crew_roles || {})) {
          totalFilled += (rd.filled || []).length;
        }
      }
      // TEMPORARY: minimum crew = 1 for solo testing.
      // Change back to original value before public launch.
      // Original value: 2 (and pilotFilled required)
      if (totalFilled < 1) {
        return res.status(400).json({ error: 'Minimum crew not met — 1 crew required' });
      }
    }

    if (status === 'IN PROGRESS' && mission.status !== 'FINALIZED') {
      return res.status(400).json({ error: 'Mission must be FINALIZED before launch' });
    }

    const terminal = ['COMPLETE', 'ABORT'];
    if (status === 'ABORTED' && terminal.includes(mission.status)) {
      return res.status(400).json({ error: 'Cannot abort a completed or already-aborted mission' });
    }

    if (status === 'ABORTED') {
      await abortMission(mission._id);
      return res.json({ success: true });
    }

    mission.status = dbStatus;
    if (status === 'IN PROGRESS') {
      const launchTs = new Date();
      mission.start_time = launchTs;
      mission.launched_at = launchTs;
    }
    if (status === 'COMPLETE') mission.hidden_at = new Date();
    await mission.save();

    const emit = mission.org_id ? emitToOrg.bind(null, mission.org_id) : emitToAll;
    const cn = req.user.citizen_name ?? req.user.username ?? 'UNKNOWN OPERATOR';
    if (status === 'FINALIZED')   emit('mission_finalized', { missionId: mission._id, mission_name: mission.name, citizen_name: cn });
    if (status === 'IN PROGRESS') emit('mission_launched',  { missionId: mission._id, mission_name: mission.name, citizen_name: cn, rp_awarded: 0 });

    res.json(mission);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
