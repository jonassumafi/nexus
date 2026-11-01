const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const OrganizationSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  prefix: { type: String, uppercase: true },
  invite_code: {
    type: String,
    unique: true,
    default: () => uuidv4().replace(/-/g, '').substring(0, 6).toUpperCase(),
  },
  commander_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  member_count: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Organization', OrganizationSchema);
