const mongoose = require('mongoose');

const ShipRPLedgerSchema = new mongoose.Schema({
  ship_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Ship', required: true },
  mission_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Mission', required: true },
  role: String,
  capacity_at_launch: Number,
  filled_at_launch: Number,
  fill_rate: Number,
  points_awarded: Number,
  threshold_snapshot: mongoose.Schema.Types.Mixed,
  awarded_ts: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ShipRPLedger', ShipRPLedgerSchema);
