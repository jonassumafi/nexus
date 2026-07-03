const cron = require('node-cron');
const Mission = require('../models/Mission');
const Ship = require('../models/Ship');
const MissionArchive = require('../models/MissionArchive');
const MissionLog = require('../models/MissionLog');
const AISummary = require('../models/AISummary');
const PlatformConfig = require('../models/PlatformConfig');
const { resetMissionAssociations } = require('../services/missionService');
const { generateMissionSummary } = require('../services/aiService');
const { emitToAll } = require('../services/socketManager');

function startScheduler() {
  // Every 5 minutes: expire queued missions
  cron.schedule('*/5 * * * *', async () => {
    try {
      const expired = await Mission.find({
        status: 'WAITING FOR CREW',
        queue_expires_at: { $lt: new Date() },
      });

      for (const mission of expired) {
        await resetMissionAssociations(mission);
        await Mission.findByIdAndDelete(mission._id);
        emitToAll('mission_aborted', { missionId: mission._id, missionName: mission.name });
      }
    } catch (err) {
      console.error('[Scheduler] Queue expiry error:', err.message);
    }
  });

  // Every 60 minutes: clean up stale finalized/waiting missions older than 4 hours
  cron.schedule('0 * * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
      const stale = await Mission.find({
        status: { $in: ['FINALIZED', 'WAITING FOR CREW'] },
        mission_time: { $lt: cutoff },
      });

      for (const mission of stale) {
        await resetMissionAssociations(mission);
        await Mission.findByIdAndDelete(mission._id);
      }
    } catch (err) {
      console.error('[Scheduler] Stale mission cleanup error:', err.message);
    }
  });

  // Every 2 minutes: recalculate crew fill percentages
  cron.schedule('*/2 * * * *', async () => {
    try {
      const activeShips = await Ship.find({ is_mission: true });

      for (const ship of activeShips) {
        let total = 0;
        let filled = 0;

        if (ship.crew_roles) {
          for (const roleData of Object.values(ship.crew_roles)) {
            total += roleData.slots || 0;
            filled += (roleData.filled || []).length;
          }
        }

        const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
        await Ship.findByIdAndUpdate(ship._id, { crew_fill_percentage: pct });
      }
    } catch (err) {
      console.error('[Scheduler] Crew fill recalc error:', err.message);
    }
  });

  // Every 72 hours: AI summary
  cron.schedule('0 0 */3 * *', async () => {
    try {
      const config = await PlatformConfig.findOne();
      if (!config || !config.ai_summary_enabled) return;

      const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const missions = await MissionArchive.find({ completed_at: { $gte: since } });
      const missionIds = missions.map((m) => m.original_mission_id);
      const logs = await MissionLog.find({ mission_id: { $in: missionIds } });

      if (missions.length === 0) return;

      const text = await generateMissionSummary(missions, logs);

      await AISummary.create({
        summary_text: text,
        missions_count: missions.length,
        period_start: since,
        period_end: new Date(),
      });
    } catch (err) {
      console.error('[Scheduler] AI summary error:', err.message);
    }
  });

  // Every 1 minute: set hidden_at on COMPLETE/ABORT missions that are missing it
  cron.schedule('* * * * *', async () => {
    try {
      await Mission.updateMany(
        { status: { $in: ['COMPLETE', 'ABORT'] }, hidden_at: null },
        { $set: { hidden_at: new Date() } }
      );
    } catch (err) {
      console.error('[Scheduler] Hidden_at backfill error:', err.message);
    }
  });

  console.log('[Scheduler] All jobs started');
}

module.exports = { startScheduler };
