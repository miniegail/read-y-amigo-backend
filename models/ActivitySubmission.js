const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  class: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  classwork: { type: mongoose.Schema.Types.ObjectId, required: true },
  learner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, maxlength: 20000, default: '' },
  attachment: { name: String, url: String, mimeType: String, size: Number, fileId: mongoose.Schema.Types.ObjectId },
  submittedAt: { type: Date, default: Date.now }, checkedAt: Date, checkedBy: mongoose.Schema.Types.ObjectId,
  feedback: { type: String, maxlength: 6000, default: '' },
}, { timestamps: true });
schema.index({ classwork: 1, learner: 1 }, { unique: true });
module.exports = mongoose.model('ActivitySubmission', schema);
