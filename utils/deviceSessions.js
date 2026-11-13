const { createHash, randomBytes } = require('node:crypto');
const { Types } = require('mongoose');
const jwt = require('jsonwebtoken');
const DeviceSession = require('../models/DeviceSession');

const expiration = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const secret = () => randomBytes(32).toString('hex');
const digest = value => createHash('sha256').update(value).digest('hex');

function credentials(user, id, refreshSecret) {
  return {
    token: jwt.sign({ id: user._id, role: user.role, sid: String(id) }, process.env.JWT_SECRET, { expiresIn: '15m' }),
    refreshToken: `${id}.${refreshSecret}`,
    accessExpiresAt: Date.now() + 15 * 60 * 1000,
  };
}

async function createDeviceSession(user) {
  const refreshSecret = secret();
  const id = new Types.ObjectId();
  const result = credentials(user, id, refreshSecret);
  await DeviceSession.create({ _id: id, user: user._id, refreshHash: digest(refreshSecret), expiresAt: expiration() });
  return result;
}

function refreshFilter(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{24}\.[0-9a-f]{64}$/.test(token)) return null;
  const [id, refreshSecret] = token.split('.');
  return { _id: id, refreshHash: digest(refreshSecret) };
}

async function rotateDeviceSession(token) {
  const filter = refreshFilter(token);
  if (!filter) return null;

  const session = await DeviceSession.findOne({ ...filter, expiresAt: { $gt: new Date() } }).populate('user');
  if (!session?.user) return null;

  const refreshSecret = secret();
  const result = credentials(session.user, session._id, refreshSecret);
  const updated = await DeviceSession.updateOne(
    { ...filter, expiresAt: { $gt: new Date() } },
    { $set: { refreshHash: digest(refreshSecret), expiresAt: expiration() } }
  );
  return updated.modifiedCount ? { ...result, user: session.user } : null;
}

async function revokeDeviceSession(token) {
  const filter = refreshFilter(token);
  if (filter) await DeviceSession.deleteOne(filter);
}

module.exports = { createDeviceSession, rotateDeviceSession, revokeDeviceSession };
