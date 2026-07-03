const User = require('../models/User');
const RPLedger = require('../models/RPLedger');
const ShipRPLedger = require('../models/ShipRPLedger');
const MissionArchive = require('../models/MissionArchive');
const PlatformConfig = require('../models/PlatformConfig');
const { emitToUser } = require('./socketManager');

async function getConfig() {
  return PlatformConfig.findOne();
}

function determineRank(ranks, totalRp) {
  for (const rank of ranks) {
    if (totalRp >= rank.min_rp && (rank.max_rp === null || totalRp <= rank.max_rp)) {
      return rank;
    }
  }
  return ranks[ranks.length - 1];
}

async function incrementUserRPAndUpdateRank(userId, points) {
  const config = await getConfig();
  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { total_rp: points } },
    { new: true }
  );

  const newRank = determineRank(config.rp_ranks, user.total_rp);
  const prevRankTitle = user.rp_rank ? user.rp_rank.title : null;

  await User.findByIdAndUpdate(userId, { rp_rank: newRank });

  if (prevRankTitle && newRank.title !== prevRankTitle) {
    emitToUser(userId, 'rank_advanced', { userId, newRank, total_rp: user.total_rp });
  }

  return user;
}

async function addRPForMissionLaunch(userId, missionId) {
  const config = await getConfig();
  const points = config.rp_settings.points.MISSION_LAUNCHED;

  await RPLedger.create({
    player_id: userId,
    mission_id: missionId,
    event_code: 'MISSION_LAUNCHED',
    points,
  });

  await incrementUserRPAndUpdateRank(userId, points);
  emitToUser(userId, 'rp_earned', { userId, event_code: 'MISSION_LAUNCHED', points });
  return points;
}

async function addRPForCrewSlotFilled(userId, missionId, shipId, crewFillPercent) {
  const config = await getConfig();
  const { min, max } = config.rp_settings.crew_fill;

  let points = 0;
  if (crewFillPercent >= max.threshold) {
    points = max.points;
  } else if (crewFillPercent >= min.threshold) {
    points = min.points;
  }

  if (points === 0) return;

  await RPLedger.create({
    player_id: userId,
    mission_id: missionId,
    ship_id: shipId,
    event_code: 'CREW_SLOT_FILLED',
    points,
  });

  await incrementUserRPAndUpdateRank(userId, points);
  emitToUser(userId, 'rp_earned', { userId, event_code: 'CREW_SLOT_FILLED', points });
  return points;
}

async function addRPForPostMissionLog(userId, missionId) {
  const config = await getConfig();
  const points = config.rp_settings.points.POST_MISSION_LOG;

  await RPLedger.create({
    player_id: userId,
    mission_id: missionId,
    event_code: 'POST_MISSION_LOG',
    points,
  });

  await MissionArchive.findOneAndUpdate(
    { original_mission_id: missionId },
    { $inc: { total_rp_awarded: points } }
  );

  await incrementUserRPAndUpdateRank(userId, points);
  emitToUser(userId, 'rp_earned', { userId, event_code: 'POST_MISSION_LOG', points });
}

async function awardShipFillBonus(shipId, missionId, capacityAtLaunch, filledAtLaunch, role) {
  const config = await getConfig();
  const threshold = config.rp_settings.ship_fill_threshold;
  const points = config.rp_settings.points.SHIP_FILL_BONUS;

  const fillRate = capacityAtLaunch > 0 ? (filledAtLaunch / capacityAtLaunch) * 100 : 0;

  if (fillRate < threshold) return;

  await ShipRPLedger.create({
    ship_id: shipId,
    mission_id: missionId,
    role,
    capacity_at_launch: capacityAtLaunch,
    filled_at_launch: filledAtLaunch,
    fill_rate: fillRate,
    points_awarded: points,
    threshold_snapshot: { threshold },
  });
}

async function computeAllPlayerRanks() {
  const config = await getConfig();

  const totals = await RPLedger.aggregate([
    { $group: { _id: '$player_id', total: { $sum: '$points' } } },
  ]);

  for (const entry of totals) {
    const rank = determineRank(config.rp_ranks, entry.total);
    await User.findByIdAndUpdate(entry._id, { total_rp: entry.total, rp_rank: rank });
  }
}

async function fetchLeaderboardPage(page = 1, perPage = 20) {
  const skip = (page - 1) * perPage;
  const users = await User.find({ total_rp: { $gt: 0 } })
    .sort({ total_rp: -1 })
    .skip(skip)
    .limit(perPage)
    .select('discord_id username avatar citizen_name total_rp rp_rank missions_completed');

  const total = await User.countDocuments({ total_rp: { $gt: 0 } });
  return { users, total, page, perPage };
}

module.exports = {
  incrementUserRPAndUpdateRank,
  addRPForMissionLaunch,
  addRPForCrewSlotFilled,
  addRPForPostMissionLog,
  awardShipFillBonus,
  computeAllPlayerRanks,
  fetchLeaderboardPage,
};
