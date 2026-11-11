const mongoose = require('mongoose');
const itemSchema = new mongoose.Schema({
  eventKey: String, kind: { type: String, enum: ['joined', 'reading', 'activity', 'comprehension', 'quiz'] },
  actorId: mongoose.Schema.Types.ObjectId, actorName: String,
  classId: mongoose.Schema.Types.ObjectId, classTitle: String, title: String,
  submissionId: mongoose.Schema.Types.ObjectId, classworkId: mongoose.Schema.Types.ObjectId,
  attemptId: mongoose.Schema.Types.ObjectId, createdAt: { type: Date, default: Date.now }, readAt: { type: Date, default: null },
});
module.exports = mongoose.model('TeacherInbox', new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  items: { type: [itemSchema], default: [] },
}));
