const mongoose = require('mongoose');
const Inbox = require('../models/TeacherInbox');
const User = require('../models/User');
const { notifyDevices } = require('./pushNotifications');

const pushText = {
  reading: 'A learner submitted a reading assignment.',
  quiz: 'A learner submitted a quiz.',
  comprehension: 'A learner submitted a comprehension quiz.',
  activity: 'A learner submitted an activity.',
  joined: 'A learner joined your class.',
};
async function appendNotification(teacherId, event) {
  const filter = { _id: teacherId, 'items.eventKey': { $ne: event.eventKey } };
  const update = { $push: { items: { $each: [{ ...event, _id: new mongoose.Types.ObjectId(), createdAt: new Date(), readAt: null }], $position: 0, $slice: 10 } } };
  try { return await Inbox.updateOne(filter, update, { upsert: true, runValidators: true }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    // Concurrent first insert or a duplicate event: retry without inserting a second inbox.
    return Inbox.updateOne(filter, update, { runValidators: true });
  }
}
async function notifyTeacher(classroom, actorId, event) {
  try {
    if (!classroom?.teacher) return;
    const actor = await User.findById(actorId).select('displayName firstName secondName');
    const actorName = actor?.displayName || [actor?.firstName, actor?.secondName].filter(Boolean).join(' ') || 'Learner';
    const result = await appendNotification(classroom.teacher, { ...event, actorId, actorName, classId: classroom._id, classTitle: classroom.title });
    if ((result?.modifiedCount || result?.upsertedCount) && pushText[event.kind]) {
      void notifyDevices([classroom.teacher], pushText[event.kind]);
    }
  } catch (error) {
    // A notification failure must not turn an already saved learner submission into a failed upload.
    console.error('Could not record teacher notification:', error.message);
  }
}
module.exports = { appendNotification, notifyTeacher };
