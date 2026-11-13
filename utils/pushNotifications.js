const mongoose = require('mongoose');
const DeviceSession = require('../models/DeviceSession');
const Enrollment = require('../models/Enrollment');

const PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const expoTokenPattern = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{1,128}\]$/;

async function notifyDevices(users, body) {
  if (!users.length || mongoose.connection.readyState !== 1) return;

  try {
    const sessions = await DeviceSession.find({
      user: { $in: users },
      expiresAt: { $gt: new Date() },
      pushToken: { $exists: true },
    }).select('pushToken').lean();
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.EXPO_PUSH_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}`;

    for (let offset = 0; offset < sessions.length; offset += 100) {
      const batch = sessions.slice(offset, offset + 100);
      const response = await fetch(PUSH_URL, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify(batch.map(({ pushToken }) => ({
          to: pushToken, title: 'Read-y Amigo', body, channelId: 'classroom',
        }))),
      });
      if (!response.ok) throw new Error(`Expo Push returned ${response.status}`);
      const { data, errors } = await response.json();
      if (errors?.length || !Array.isArray(data)) throw new Error('Expo rejected the push request.');
      await Promise.all(data.map((ticket, index) => {
        const session = batch[index];
        if (session && ticket.details?.error === 'DeviceNotRegistered') {
          return DeviceSession.updateOne({ _id: session._id, pushToken: session.pushToken }, { $unset: { pushToken: 1 } });
        }
        if (ticket.status === 'error') console.warn('Expo push ticket:', ticket.details?.error || 'Unknown error');
        return undefined;
      }));
    }
  } catch (error) {
    console.error('Could not send push notification:', error.message);
  }
}

async function notifyClass(classId, body, { assignedTo, teacher, exclude } = {}) {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const filter = { class: classId };
    if (assignedTo) filter.learner = { $in: assignedTo };
    const learners = await Enrollment.distinct('learner', filter);
    const recipients = teacher ? [...learners, teacher] : learners;
    await notifyDevices(recipients.filter(id => String(id) !== String(exclude)), body);
  } catch (error) {
    console.error('Could not resolve push recipients:', error.message);
  }
}

module.exports = { expoTokenPattern, notifyClass, notifyDevices };
