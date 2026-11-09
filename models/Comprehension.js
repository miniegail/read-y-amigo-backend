const mongoose = require('mongoose');
const { Schema } = mongoose;
const privateQuiz = { type: Schema.Types.Mixed, required: true, select: false };
const QuizSet = mongoose.model('ComprehensionQuizSet', new Schema({
  teacher: { type: Schema.Types.ObjectId, required: true, index: true }, title: { type: String, required: true },
  passageHash: { type: String, required: true, index: true }, quiz: privateQuiz,
}, { timestamps: true }));
const Quiz = mongoose.model('ComprehensionQuiz', new Schema({
  classwork: { type: Schema.Types.ObjectId, required: true, unique: true }, teacher: { type: Schema.Types.ObjectId, required: true },
  passageHash: { type: String, required: true }, quiz: privateQuiz,
}, { timestamps: true }));
const schema = new Schema({
  classwork: { type: Schema.Types.ObjectId, required: true, index: true }, class: { type: Schema.Types.ObjectId, required: true },
  learner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  readingSubmission: { type: Schema.Types.ObjectId }, attemptKey: { type: String, required: true },
  title: String,
  passageHash: { type: String, required: true }, passage: { type: Schema.Types.Mixed, required: true, select: false }, quiz: privateQuiz,
  answers: { type: [Schema.Types.Mixed], default: [] }, grades: { type: [Schema.Types.Mixed], default: [] },
  result: { type: Schema.Types.Mixed, default: null }, status: { type: String, enum: ['draft', 'pending-review', 'graded'], default: 'draft' },
  revision: { type: Number, default: 0 }, submittedAt: Date, reviewedAt: Date, reviewedBy: Schema.Types.ObjectId,
}, { timestamps: true });
schema.index({ classwork: 1, learner: 1, attemptKey: 1 }, { unique: true });
const Attempt = mongoose.model('ComprehensionAttempt', schema);
module.exports = { QuizSet, Quiz, Attempt };