const mongoose = require('mongoose');

const RPLedgerSchema = new mongoose.Schema({
  player_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  mission_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Mission', default: null },
  ship_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Ship', default: null },
  event_code: { type: String, required: true },
  points: { type: Number, required: true },
  applied_ts: { type: Date, default: Date.now },
});

module.exports = mongoose.model('RPLedger', RPLedgerSchema);
