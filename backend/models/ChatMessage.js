// Global chat message. One collection shared by all operators; messages
// are capped at ~500 recent entries (older ones trimmed on insert to keep
// the collection light). Enough history to catch up on recent chatter
// without unbounded growth.

const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
  sender_id    : { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  citizen_name : { type: String, required: true }, // denormalized for render speed
  avatar_url   : { type: String },                 // denormalized at send time
  discord_id   : { type: String },                 // for falling back to Discord CDN avatar
  text         : { type: String, required: true, maxlength: 500 },
  timestamp    : { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
