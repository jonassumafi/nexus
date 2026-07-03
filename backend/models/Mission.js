const mongoose = require('mongoose');

const MISSION_STATUSES = ['WAITING FOR CREW', 'FINALIZED', 'IN PROGRESS', 'COMPLETE', 'ABORT'];

const MissionSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  mission_type: String,
  objectives: String,
  status: { type: String, enum: MISSION_STATUSES, default: 'WAITING FOR CREW' },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  org_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
  is_public: { type: Boolean, default: true },
  primary_ship: { type: mongoose.Schema.Types.ObjectId, ref: 'Ship', required: true },
  supporting_ships: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Ship' }],
  mission_time: Date,
  start_time: { type: Date, default: null },
  launched_at: { type: Date, default: null },
  end_time: { type: Date, default: null },
  elapsed_seconds: { type: Number, default: 0 },
  queue_expires_at: Date,
  created_at: { type: Date, default: Date.now },
  hidden_at: { type: Date, default: null },
  frequency: { type: String, default: null },
});

module.exports = mongoose.model('Mission', MissionSchema);
