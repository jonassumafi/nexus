const mongoose = require('mongoose');

const ShipAccessRequestSchema = new mongoose.Schema({
  requester_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  owner_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ship_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Ship', required: true },
  status:          { type: String, enum: ['pending', 'approved', 'denied', 'expired', 'withdrawn'], default: 'pending' },
  requested_at:    { type: Date, default: Date.now },
  expires_at:      { type: Date },
  loan_expires_at: { type: Date, default: null },
});

ShipAccessRequestSchema.pre('save', function (next) {
  if (!this.expires_at) {
    this.expires_at = new Date((this.requested_at || Date.now()) + 60 * 60 * 1000);
  }
  next();
});

module.exports = mongoose.model('ShipAccessRequest', ShipAccessRequestSchema);
