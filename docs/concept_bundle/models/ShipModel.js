const mongoose = require('mongoose');

const ShipModelSchema = new mongoose.Schema({
  category: { type: String, required: true },
  model_name: { type: String, required: true },
  image_url: String,
  scorg_ship_id: { type: Number, default: null },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ShipModel', ShipModelSchema);
