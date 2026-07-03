const mongoose = require('mongoose');

const MissionLogSchema = new mongoose.Schema({
  mission_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Mission' },
  user_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  log_text:     { type: String },
  event_type:   { type: String, default: 'post_mission_log' },
  citizen_name: { type: String, default: '' },
  mission_name: { type: String, default: '' },
  ship_name:    { type: String, default: '' },
  role_name:    { type: String, default: '' },
  rp_earned:    { type: Number, default: 0 },
  rank_name:    { type: String, default: '' },
  summary_text: { type: String, default: '' },
  timestamp:    { type: Date, default: Date.now },
});

MissionLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('MissionLog', MissionLogSchema);
