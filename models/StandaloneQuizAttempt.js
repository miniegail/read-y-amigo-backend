const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  class: { type: Schema.Types.ObjectId, required: true, index: true },
  classwork: { type: Schema.Types.ObjectId, required: true },
  learner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  assessmentType: { type: String, default: 'standalone', enum: ['standalone'] },
  title: String, quiz: { type: Schema.Types.Mixed, required: true, select: false },
  answers: { type: [Schema.Types.Mixed], default: [] }, grades: { type: [Schema.Types.Mixed], default: [] },
  result: { type: Schema.Types.Mixed, default: null },
  status: { type: String, enum: ['draft', 'pending-review', 'graded'], default: 'draft' },
  revision: { type: Number, default: 0 }, submittedAt: Date, reviewedAt: Date, reviewedBy: Schema.Types.ObjectId,
}, { timestamps: true });
schema.index({ classwork: 1, learner: 1 }, { unique: true });
module.exports = mongoose.model('StandaloneQuizAttempt', schema);