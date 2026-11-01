const Mission = require('../models/Mission');
const MissionArchive = require('../models/MissionArchive');
const Ship = require('../models/Ship');
const User = require('../models/User');
const RPLedger = require('../models/RPLedger');
const ShipRPLedger = require('../models/ShipRPLedger');
const { addRPForMissionLaunch, awardShipFillBonus, addRPForCrewSlotFilled } = require('./rpService');
const { emitToUser, emitToAll } = require('./socketManager');
const { dispatch } = require('./nexusDispatch');

function formatElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// Crew slot `filled[]` entries can be either MongoDB ObjectIds (registered web
// users) or Discord ID strings (legacy/seed users). Split a flat list into both
// shapes so we can build the correct user lookup without casting failures.
const OID_RE = /^[a-f0-9]{24}$/i;
function partitionUserIds(ids) {
  const objectIds = [];
  const discordIds = [];
  for (const id of ids) {
    if (!id) continue;
    const s = String(id);
    if (OID_RE.test(s)) objectIds.push(s);
    else discordIds.push(s);
  }
  return { objectIds, discordIds };
}

async function validateMissionForLaunch(mission) {
  const primaryShip = await Ship.findById(mission.primary_ship);
  if (!primaryShip) throw new Error('Primary ship not found');

  // TEMPORARY: Pilot requirement disabled for solo testing.
  // Restore before public launch.
  // TODO: re-enable Pilot check
  // const pilotRole = primaryShip.crew_roles && primaryShip.crew_roles['Pilot'];
  // if (!pilotRole || !pilotRole.filled || pilotRole.filled.length === 0) {
  //   throw new Error('Primary ship must have a pilot assigned');
  // }

  let totalCrew = 0;
  const allShipIds = [mission.primary_ship, ...(mission.supporting_ships || [])];
  const emptyShips = [];

  for (const shipId of allShipIds) {
    const ship = await Ship.findById(shipId);
    if (!ship) continue;

    let shipCrew = 0;
    if (ship.crew_roles) {
      for (const role of Object.values(ship.crew_roles)) {
        shipCrew += (role.filled || []).length;
      }
    }

    totalCrew += shipCrew;
    if (shipCrew === 0 && shipId.toString() !== mission.primary_ship.toString()) {
      emptyShips.push(shipId);
    }
  }

  // TEMPORARY: minimum crew = 1 for solo testing.
  // Change back to original value before public launch.
  // Original value: 2
  if (totalCrew < 1) throw new Error('Mission requires minimum 1 total crew');

  return { valid: true, emptyShips };
}

async function resetMissionAssociations(mission) {
  const allShipIds = [mission.primary_ship, ...(mission.supporting_ships || [])];

  for (const shipId of allShipIds) {
    const ship = await Ship.findById(shipId);
    if (!ship) continue;

    const updatedRoles = {};
    if (ship.crew_roles) {
      for (const [roleName, roleData] of Object.entries(ship.crew_roles)) {
        updatedRoles[roleName] = { slots: roleData.slots, filled: [] };
        for (const userId of roleData.filled || []) {
          const s = String(userId);
          // Look up by _id when the entry is a real ObjectId; otherwise by discord_id
          // (legacy/seed entries store the raw Discord snowflake string).
          if (OID_RE.test(s)) {
            await User.findByIdAndUpdate(s, { current_mission_assignment: null });
          } else {
            await User.findOneAndUpdate({ discord_id: s }, { current_mission_assignment: null });
          }
        }
      }
    }

    await Ship.findByIdAndUpdate(shipId, {
      is_mission: false,
      current_mission_id: null,
      crew_roles: updatedRoles,
      crew_fill_percentage: 0,
      recalled_mid_mission: false,
    });
  }
}

function buildShipSnapshot(ship) {
  if (!ship) return null;
  const shipId = ship._id || ship.id;
  return {
    ship_id: shipId,
    ship_name: ship.ship_name,
    ship_model: ship.ship_model,
    ship_type: ship.type,
    crew_fill_percentage: ship.crew_fill_percentage,
    crew_roles_at_completion: ship.crew_roles,
  };
}

async function buildCrewSnapshot(allShips, missionId) {
  const userIds = new Set();
  for (const ship of allShips) {
    if (!ship) continue;
    for (const roleData of Object.values(ship.crew_roles || {})) {
      for (const uid of roleData.filled || []) {
        if (uid) userIds.add(String(uid));
      }
    }
  }

  const { objectIds, discordIds } = partitionUserIds([...userIds]);
  const orClauses = [];
  if (objectIds.length) orClauses.push({ _id: { $in: objectIds } });
  if (discordIds.length) orClauses.push({ discord_id: { $in: discordIds } });

  const users = orClauses.length
    ? await User.find({ $or: orClauses }).select('citizen_name discord_id')
    : [];
  // Map by both _id and discord_id so we can resolve either entry shape.
  const userByKey = new Map();
  for (const u of users) {
    userByKey.set(u._id.toString(), u);
    if (u.discord_id) userByKey.set(u.discord_id, u);
  }

  // RPLedger.player_id is ObjectId only; restrict to known ObjectIds.
  const rpRows = objectIds.length
    ? await RPLedger.find({ mission_id: missionId, player_id: { $in: objectIds } })
    : [];
  const rpByOid = new Map();
  for (const row of rpRows) {
    const key = row.player_id.toString();
    rpByOid.set(key, (rpByOid.get(key) || 0) + (row.points || 0));
  }

  const crewSnapshot = [];
  for (const ship of allShips) {
    if (!ship) continue;
    const shipId = ship._id || ship.id;
    for (const [roleName, roleData] of Object.entries(ship.crew_roles || {})) {
      for (const uid of roleData.filled || []) {
        const key = String(uid);
        const user = userByKey.get(key);
        const userOid = user ? user._id.toString() : (OID_RE.test(key) ? key : null);
        crewSnapshot.push({
          ship_id: shipId,
          ship_name: ship.ship_name,
          role: roleName,
          // user_id schema is ObjectId — leave undefined when no real user resolved.
          ...(userOid ? { user_id: userOid } : {}),
          citizen_name: user?.citizen_name || '',
          rp_awarded: userOid ? (rpByOid.get(userOid) || 0) : 0,
        });
      }
    }
  }

  return crewSnapshot;
}

async function computeMissionTotalRp(missionId) {
  const [playerRows, shipRows] = await Promise.all([
    RPLedger.find({ mission_id: missionId }),
    ShipRPLedger.find({ mission_id: missionId }),
  ]);
  const playerSum = playerRows.reduce((s, r) => s + (r.points || 0), 0);
  const shipSum = shipRows.reduce((s, r) => s + (r.points_awarded || 0), 0);
  return playerSum + shipSum;
}

async function completeMission(missionId, citizenName = 'UNKNOWN OPERATOR') {
  const mission = await Mission.findById(missionId)
    .populate('primary_ship')
    .populate('supporting_ships')
    .populate('created_by');

  if (!mission) throw new Error('Mission not found');

  const allShips = [mission.primary_ship, ...(mission.supporting_ships || [])].filter(Boolean);
  const shipIds = allShips.map((s) => s._id);

  // Compute elapsed time from launch. Falls back to start_time for missions
  // launched before the launched_at field existed.
  const launchAnchor = mission.launched_at || mission.start_time;
  const elapsedSeconds = launchAnchor
    ? Math.max(0, Math.floor((Date.now() - new Date(launchAnchor).getTime()) / 1000))
    : 0;

  const primarySnap = buildShipSnapshot(mission.primary_ship);
  const supportingSnap = (mission.supporting_ships || []).map(buildShipSnapshot);
  const crewSnapshot = await buildCrewSnapshot(allShips, missionId);

  await Mission.findByIdAndUpdate(missionId, {
    status: 'COMPLETE',
    end_time: new Date(),
    hidden_at: new Date(),
    elapsed_seconds: elapsedSeconds,
  });

  if (mission.created_by) {
    const existingLaunchRp = await RPLedger.findOne({
      player_id: mission.created_by._id,
      mission_id: missionId,
      event_code: 'MISSION_LAUNCHED',
    });
    if (!existingLaunchRp) {
      await addRPForMissionLaunch(mission.created_by._id, missionId);
    }
  }

  // SHIP_FILL_BONUS is per-ship (dedup by ship+mission). Uses aggregated
  // ship-wide capacity/filled so a fully-crewed ship gets one bonus, not one
  // per role. Ships recalled mid-mission (owner withdrew access) are excluded.
  for (const ship of allShips) {
    if (ship.recalled_mid_mission) continue;
    const existing = await ShipRPLedger.findOne({ ship_id: ship._id, mission_id: missionId });
    if (existing) continue;
    let capacity = 0, filled = 0;
    for (const rd of Object.values(ship.crew_roles || {})) {
      capacity += rd.slots || 0;
      filled += (rd.filled || []).length;
    }
    if (capacity === 0) continue;
    await awardShipFillBonus(ship._id, missionId, capacity, filled, 'SHIP');
  }

  // Award CREW_SLOT_FILLED RP at completion for any crew who missed it at reservation
  for (const ship of allShips) {
    for (const roleData of Object.values(ship.crew_roles || {})) {
      for (const uid of (roleData.filled || [])) {
        const uidStr = String(uid);
        if (!OID_RE.test(uidStr)) continue;
        const existingSlotRp = await RPLedger.findOne({
          player_id: uid,
          mission_id: missionId,
          event_code: 'CREW_SLOT_FILLED',
        });
        if (!existingSlotRp) {
          await addRPForCrewSlotFilled(uid, missionId, ship._id, ship.crew_fill_percentage);
        }
      }
    }
  }

  const totalRp = await computeMissionTotalRp(missionId);

  await MissionArchive.create({
    original_mission_id: mission._id,
    name: mission.name,
    mission_type: mission.mission_type,
    objectives: mission.objectives,
    status: 'COMPLETE',
    created_by: mission.created_by ? mission.created_by._id : null,
    org_id: mission.org_id,
    is_public: mission.is_public,
    ship_ids: shipIds,
    primary_ship_snapshot: primarySnap,
    supporting_ships_snapshot: supportingSnap,
    mission_time: mission.mission_time,
    start_time: mission.start_time,
    end_time: new Date(),
    crew_snapshot: crewSnapshot,
    total_rp_awarded: totalRp,
    elapsed_seconds: elapsedSeconds,
  });

  const allCrewIds = new Set();
  for (const ship of allShips) {
    for (const roleData of Object.values(ship.crew_roles || {})) {
      for (const uid of roleData.filled || []) {
        allCrewIds.add(uid.toString());
      }
    }
  }

  for (const uid of allCrewIds) {
    emitToUser(uid, 'log_requested', { missionId, missionName: mission.name });
    const s = String(uid);
    if (OID_RE.test(s)) {
      await User.findByIdAndUpdate(s, { $inc: { missions_completed: 1 } });
    } else {
      await User.findOneAndUpdate({ discord_id: s }, { $inc: { missions_completed: 1 } });
    }
  }

  await resetMissionAssociations(mission);

  emitToAll('mission_complete', {
    missionId,
    mission_name: mission.name,
    citizen_name: citizenName,
    total_rp_awarded: totalRp,
    elapsed_seconds: elapsedSeconds,
  });

  dispatch('missionComplete', {
    missionName: mission.name,
    elapsedTime: formatElapsed(elapsedSeconds),
    commanderName: citizenName,
    crewCount: crewSnapshot.length,
  });

  // Fire the post-mission log modal prompt for registered users on filled
  // crew slots. Dedup by user_id (a player on multiple ships/roles only gets
  // one prompt).
  const uniqueCrew = new Map();
  for (const c of crewSnapshot) {
    if (c.user_id && !uniqueCrew.has(String(c.user_id))) {
      uniqueCrew.set(String(c.user_id), {
        userId: String(c.user_id),
        citizen_name: c.citizen_name || '',
      });
    }
  }
  emitToAll('post_mission_log_prompt', {
    missionId,
    mission_name: mission.name,
    crew: [...uniqueCrew.values()],
  });

  return {
    success: true,
    total_rp_awarded: totalRp,
    elapsed_seconds: elapsedSeconds,
  };
}

async function abortMission(missionId) {
  const mission = await Mission.findById(missionId)
    .populate('primary_ship')
    .populate('supporting_ships')
    .populate('created_by');

  if (!mission) throw new Error('Mission not found');

  const allShips = [mission.primary_ship, ...(mission.supporting_ships || [])].filter(Boolean);
  const shipIds = allShips.map((s) => s._id);

  const primarySnap = buildShipSnapshot(mission.primary_ship);
  const supportingSnap = (mission.supporting_ships || []).map(buildShipSnapshot);
  const crewSnapshot = await buildCrewSnapshot(allShips, missionId);
  const totalRp = await computeMissionTotalRp(missionId);

  await MissionArchive.create({
    original_mission_id: mission._id,
    name: mission.name,
    mission_type: mission.mission_type,
    objectives: mission.objectives,
    status: 'ABORT',
    created_by: mission.created_by ? mission.created_by._id : null,
    org_id: mission.org_id,
    is_public: mission.is_public,
    ship_ids: shipIds,
    primary_ship_snapshot: primarySnap,
    supporting_ships_snapshot: supportingSnap,
    mission_time: mission.mission_time,
    start_time: mission.start_time,
    end_time: new Date(),
    crew_snapshot: crewSnapshot,
    total_rp_awarded: totalRp,
  });

  await resetMissionAssociations(mission);
  await Mission.findByIdAndUpdate(missionId, { status: 'ABORT', hidden_at: new Date() });

  const citizenName = mission.created_by
    ? (mission.created_by.citizen_name ?? mission.created_by.username ?? 'UNKNOWN OPERATOR')
    : 'UNKNOWN OPERATOR';
  emitToAll('mission_aborted', { missionId, mission_name: mission.name, citizen_name: citizenName });

  dispatch('missionAborted', {
    missionName: mission.name,
    commanderName: citizenName,
  });

  return { success: true };
}

module.exports = {
  validateMissionForLaunch,
  resetMissionAssociations,
  completeMission,
  abortMission,
};
