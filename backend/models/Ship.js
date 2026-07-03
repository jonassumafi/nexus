const mongoose = require('mongoose');

const ShipSchema = new mongoose.Schema({
  ship_name: { type: String, uppercase: true },
  description: { type: String, maxlength: 1000 },
  owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  org_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
  type: String,
  prefix: String,
  is_mission: { type: Boolean, default: false },
  current_mission_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  // NOTE: crew_roles is intentionally left as Mixed because the existing
  // registration flow writes a node_positions-derived shape. New code should
  // prefer crew_roles_structured below; both fields may coexist during the
  // transition. Do not change the type without a data migration.
  crew_roles: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  crew_roles_structured: {
    type: Map,
    of: new mongoose.Schema({
      slots: { type: Number, default: 1 },
      filled: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    }, { _id: false }),
    default: {},
  },
  crew_fill_percentage: { type: Number, default: 0 },
  missions_completed: { type: Number, default: 0 },
  ship_model: { type: String, default: '' },
  model_image_url: { type: String, default: null },
  scorg_ship_id: { type: Number, default: null },
  node_positions: {
    type: [{
      role: { type: String },
      x: { type: Number },
      y: { type: Number },
    }],
    default: [],
  },
  recalled_mid_mission: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Ship', ShipSchema);
