const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  refreshHash: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
  pushToken: { type: String, unique: true, sparse: true },
});

module.exports = mongoose.model('DeviceSession', schema);
