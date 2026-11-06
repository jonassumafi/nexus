// Friend relationships. `a` and `b` are the two user ids stored
// in lexicographic order so (a, b) is a unique pair regardless of
// who sent the request. `requester` records who initiated it, so
// pending rows know who is waiting on whom.
const mongoose = require('mongoose');

const FriendSchema = new mongoose.Schema({
  a: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  b: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted'], required: true, index: true },
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  created_at: { type: Date, default: Date.now },
  accepted_at: { type: Date, default: null },
});

FriendSchema.index({ a: 1, b: 1 }, { unique: true });
FriendSchema.index({ a: 1, status: 1 });
FriendSchema.index({ b: 1, status: 1 });

// Order a pair lexicographically so lookups are deterministic.
FriendSchema.statics.pair = function (x, y) {
  const sx = String(x);
  const sy = String(y);
  return sx < sy ? [x, y] : [y, x];
};

module.exports = mongoose.model('Friend', FriendSchema);
