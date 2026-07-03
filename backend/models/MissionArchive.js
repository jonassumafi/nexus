const mongoose = require('mongoose');

const ShipSnapshotSchema = new mongoose.Schema({
  ship_id: mongoose.Schema.Types.ObjectId,
  ship_name: String,
  ship_model: String,
  ship_type: String,
  crew_fill_percentage: Number,
  crew_roles_at_completion: mongoose.Schema.Types.Mixed,
}, { _id: false });

const CrewMemberSchema = new mongoose.Schema({
  ship_id: mongoose.Schema.Types.ObjectId,
  ship_name: String,
  role: String,
  user_id: mongoose.Schema.Types.ObjectId,
  citizen_name: String,
  rp_awarded: { type: Number, default: 0 },
}, { _id: false });

const MissionArchiveSchema = new mongoose.Schema({
  original_mission_id: mongoose.Schema.Types.ObjectId,
  name: String,
  mission_type: String,
  objectives: String,
  status: {
    type: String,
    enum: ['COMPLETE', 'ABORT'],
    required: true,
    default: 'COMPLETE',
  },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  org_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
  is_public: Boolean,
  ship_ids: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Ship' }],
    default: [],
  },
  primary_ship_snapshot: ShipSnapshotSchema,
  supporting_ships_snapshot: [ShipSnapshotSchema],
  mission_time: Date,
  start_time: Date,
  end_time: Date,
  completed_at: { type: Date, default: Date.now },
  crew_snapshot: [CrewMemberSchema],
  total_rp_awarded: { type: Number, default: 0 },
  elapsed_seconds: { type: Number, default: 0 },
});

MissionArchiveSchema.index({ ship_ids: 1, completed_at: -1 });

module.exports = mongoose.model('MissionArchive', MissionArchiveSchema);
