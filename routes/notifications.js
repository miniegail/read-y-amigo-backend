const express = require('express'), mongoose = require('mongoose');
const { requireAuth, requireRole } = require('../middleware/auth');
const Inbox = require('../models/TeacherInbox');
const router = express.Router(); router.use(requireAuth, requireRole('teacher'));
router.get('/', async (req, res) => {
  try { const inbox = await Inbox.findById(req.userId); res.json({ notifications: (inbox?.items || []).slice(0, 10) }); }
  catch (error) { console.error(error); res.status(500).json({ error: 'Could not load notifications.' }); }
});
router.patch('/:id/read', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid notification id.' });
    await Inbox.updateOne({ _id: req.userId, 'items._id': req.params.id }, { $set: { 'items.$.readAt': new Date() } });
    res.json({ read: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not mark the notification as read.' }); }
});
module.exports = router;
