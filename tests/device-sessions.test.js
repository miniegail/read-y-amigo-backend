const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { Types } = require('mongoose');
const DeviceSession = require('../models/DeviceSession');
const { createDeviceSession, rotateDeviceSession, revokeDeviceSession } = require('../utils/deviceSessions');
const { requireAuth } = require('../middleware/auth');

test('device sessions rotate refresh secrets, revoke access on logout, and preserve other devices', async t => {
  process.env.JWT_SECRET = 'device-session-test-secret';
  const user = { _id: new Types.ObjectId(), role: 'learner' };
  const sessions = new Map();

  function match(filter) {
    const row = sessions.get(String(filter._id));
    if (!row || (filter.refreshHash && filter.refreshHash !== row.refreshHash)) return null;
    if (filter.user && String(filter.user) !== String(row.user)) return null;
    if (filter.expiresAt && row.expiresAt <= filter.expiresAt.$gt) return null;
    return row;
  }

  function stubModelMethod(name, implementation) {
    assert.equal(typeof DeviceSession[name], 'function', `DeviceSession must export a Mongoose model with ${name}()`);
    const original = Object.getOwnPropertyDescriptor(DeviceSession, name);
    DeviceSession[name] = implementation;
    t.after(() => {
      if (original) Object.defineProperty(DeviceSession, name, original);
      else delete DeviceSession[name];
    });
  }

  stubModelMethod('create', async row => { sessions.set(String(row._id), row); });
  stubModelMethod('findOne', filter => ({
    populate: async () => {
      const row = match(filter);
      return row && { ...row, user };
    },
  }));
  stubModelMethod('updateOne', async (filter, update) => {
    const row = match(filter);
    if (row) Object.assign(row, update.$set);
    return { modifiedCount: Number(!!row) };
  });
  stubModelMethod('deleteOne', async filter => {
    if (match(filter)) sessions.delete(String(filter._id));
  });
  stubModelMethod('exists', async filter => match(filter));

  async function access(token) {
    const req = { headers: { authorization: `Bearer ${token}` } };
    let status;
    const res = { status(code) { status = code; return this; }, json() {} };
    await requireAuth(req, res, () => { status = 200; });
    return status;
  }

  const first = await createDeviceSession(user);
  const second = await createDeviceSession(user);
  assert.equal(await access(first.token), 200);
  const concurrent = await Promise.all([
    rotateDeviceSession(first.refreshToken),
    rotateDeviceSession(first.refreshToken),
  ]);
  const [rotated] = concurrent.filter(Boolean);
  assert.equal(concurrent.filter(Boolean).length, 1);
  assert.notEqual(rotated.refreshToken, first.refreshToken);
  assert.equal(await rotateDeviceSession(first.refreshToken), null);

  await revokeDeviceSession(rotated.refreshToken);
  assert.equal(await access(first.token), 401);
  assert.equal(await access(rotated.token), 401);
  assert.equal(await rotateDeviceSession(rotated.refreshToken), null);
  assert.equal(await access(second.token), 200);

  const legacy = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET);
  const pending = jwt.sign({ role: 'learner', type: 'google-pending-signup' }, process.env.JWT_SECRET);
  assert.equal(await access(legacy), 200);
  assert.equal(await access(pending), 401);
});