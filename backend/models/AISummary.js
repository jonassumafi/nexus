const mongoose = require('mongoose');

const AISummarySchema = new mongoose.Schema({
  summary_text: { type: String, required: true },
  missions_count: Number,
  total_rp: Number,
  period_start: Date,
  period_end: Date,
  generated_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('AISummary', AISummarySchema);
