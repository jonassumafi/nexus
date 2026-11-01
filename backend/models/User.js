const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  discord_id: { type: String, required: true, unique: true },
  username: String,
  avatar: String,
  citizen_name: String,
  place_of_birth: String,
  citizenship: String,
  biography: String,
  profile_url: String,
  onboarding_complete: { type: Boolean, default: false },
  org_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
  is_freelancer: { type: Boolean, default: false },
  is_platform_owner: { type: Boolean, default: false },
  is_org_commander: { type: Boolean, default: false },
  total_rp: { type: Number, default: 0 },
  rp_rank: { type: mongoose.Schema.Types.Mixed, default: null },
  missions_completed: { type: Number, default: 0 },
  current_mission_assignment: { type: mongoose.Schema.Types.Mixed, default: null },
  // Nexus radio-rig assignment — one of the SRS preset IDs. Random on
  // first connection, locked by default (admin can re-roll). See
  // backend/services/radioModels.js for the catalog.
  radio_type: { type: String, default: null },
  voice_profile: {
    highpass:       { type: Number, default: null },
    lowpass:        { type: Number, default: null },
    resonance_freq: { type: Number, default: null },
    resonance_q:    { type: Number, default: null },
    distortion:     { type: Number, default: null },
    static_level:   { type: Number, default: null },
    pitch_shift:    { type: Number, default: 0, min: -1.5, max: 1.5 },
    bit_crush:      { type: Number, default: 16, min: 10, max: 16 },
    ptt_key:        { type: String, default: 'v' },
  },
  borrowed_ships: [{
    ship_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Ship' },
    owner_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    loan_expires_at: { type: Date },
    request_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'ShipAccessRequest' },
  }],
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', UserSchema);
