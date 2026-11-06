// 1:1 direct messages. `pair` is the two user ids sorted and joined
// with `:` so a single index can fetch an ordered thread without a
// compound $or. No read receipts — the spec is plain text only.
const mongoose = require('mongoose');

const DirectMessageSchema = new mongoose.Schema({
  pair:       { type: String, required: true, index: true },
  from:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body:       { type: String, required: true, maxlength: 2000 },
  created_at: { type: Date, default: Date.now, index: true },
});

DirectMessageSchema.index({ pair: 1, created_at: -1 });

// 30-day TTL — Mongo prunes expired docs on its own schedule (≈60s).
// Pair cap (500 newest) is enforced on insert in routes/dms.js.
DirectMessageSchema.index({ created_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

DirectMessageSchema.statics.pairKey = function (x, y) {
  const sx = String(x);
  const sy = String(y);
  return sx < sy ? `${sx}:${sy}` : `${sy}:${sx}`;
};

module.exports = mongoose.model('DirectMessage', DirectMessageSchema);
