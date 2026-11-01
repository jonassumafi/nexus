const mongoose = require('mongoose');

const MissionTypeSchema = new mongoose.Schema({
  name: String,
  description: String,
  emoji: String,
}, { _id: false });

const ShipTypeSchema = new mongoose.Schema({
  name: String,
  emoji: String,
}, { _id: false });

const CrewRoleSchema = new mongoose.Schema({
  name: String,
  emoji: String,
  description: String,
}, { _id: false });

const RpRankSchema = new mongoose.Schema({
  min_rp: Number,
  max_rp: { type: Number, default: null },
  title: String,
  emoji: String,
  unlocks: [String],
}, { _id: false });

const PlatformConfigSchema = new mongoose.Schema({
  mission_types: [MissionTypeSchema],
  ship_types: [ShipTypeSchema],
  crew_roles: [CrewRoleSchema],
  rp_settings: {
    points: {
      MISSION_LAUNCHED: { type: Number, default: 1 },
      POST_MISSION_LOG: { type: Number, default: 3 },
      SHIP_FILL_BONUS: { type: Number, default: 3 },
    },
    crew_fill: {
      min: {
        threshold: { type: Number, default: 50 },
        points: { type: Number, default: 1 },
      },
      max: {
        threshold: { type: Number, default: 70 },
        points: { type: Number, default: 2 },
      },
    },
    ship_fill_threshold: { type: Number, default: 75 },
  },
  rp_ranks: [RpRankSchema],
  max_ships_per_player: { type: Number, default: 2 },
  max_ships_per_mission: { type: Number, default: 3 },
  ai_summary_enabled: { type: Boolean, default: true },
  display_timezone: { type: String, default: 'UTC' },
}, { timestamps: false });

module.exports = mongoose.model('PlatformConfig', PlatformConfigSchema);
