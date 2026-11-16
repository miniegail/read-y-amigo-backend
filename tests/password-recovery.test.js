const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Types } = require('mongoose');
const User = require('../models/User');
const DeviceSession = require('../models/DeviceSession');
const router = require('../routes/passwordRecovery');

const get = (record, key) => key.split('.').reduce((value, segment) => value?.[segment], record);
function matches(record, filter) {
  return Object.entries(filter).every(([key, rule]) => {
    if (key === '$and') return rule.every(child => matches(record, child));
    if (key === '$or') return rule.some(child => matches(record, child));
    const value = get(record, key);
    if (!rule || typeof rule !== 'object') return value === rule;
    if ('$exists' in rule) return (value !== undefined) === rule.$exists;
    if ('$type' in rule) return typeof value === rule.$type;
    if ('$gt' in rule) return value > rule.$gt;
    if ('$lt' in rule) return value < rule.$lt;
    if ('$lte' in rule) return value <= rule.$lte;
    throw new Error('Unsupported fixture filter: ' + key);
  });
}

function apply(record, update) {
  for (const [operator, values] of Object.entries(update)) {
    for (const [path, value] of Object.entries(values)) {
      const parts = path.split('.');
      const field = parts.pop();
      const parent = parts.length ? get(record, parts.join('.')) : record;
      if (operator === '$unset') delete parent[field];
      if (operator === '$set') parent[field] = value;
      if (operator === '$inc') parent[field] += value;
    }
  }
}

test('password recovery keeps OTP authenticated, limits guesses, and consumes exactly one reset', async t => {
  process.env.JWT_SECRET = 'password-recovery-test-secret';
  const learner = {
    _id: String(new Types.ObjectId()), role: 'learner', username: 'learner',
    passwordHash: await bcrypt.hash('old-password', 4),
  };
  const teacher = {
    _id: String(new Types.ObjectId()), role: 'teacher', email: 'teacher@example.com',
    passwordHash: await bcrypt.hash('teacher-password', 4),
  };
  const users = [learner, teacher];
  const select = value => Object.assign(Promise.resolve(value), { lean: async () => value });
  const find = filter => users.find(record => matches(record, filter));
  t.mock.method(User, 'exists', async filter => find(filter));
  t.mock.method(User, 'findOne', filter => ({ select: () => select(find(filter)) }));
  t.mock.method(User, 'updateOne', async (filter, update) => {
    const row = find(filter);
    if (row) apply(row, update);
    return { modifiedCount: Number(!!row) };
  });
  t.mock.method(User, 'findOneAndUpdate', (filter, update) => {
    const row = find(filter);
    if (!row) return select(null);
    const previous = structuredClone(row);
    apply(row, update);
    return select(previous);
  });
  t.mock.method(DeviceSession, 'exists', async filter => filter._id === filter.user);
  t.mock.method(DeviceSession, 'deleteMany', async () => ({ deletedCount: 1 }));
  const token = user => jwt.sign({ id: user._id, role: user.role, sid: user._id }, process.env.JWT_SECRET);
  const learnerToken = token(learner);
  const app = express();
  app.use(express.json());
  app.use('/recovery', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const request = async (path, body, bearer) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/recovery/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
      body: body && JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get('Cache-Control') };
  };
  const account = { identifier: learner.username, role: learner.role };
  const requested = await request('request', account);
  assert.equal(requested.status, 202);
  assert.deepEqual(requested, await request('request', { ...account, identifier: 'unknown' }));
  assert.equal((await request('device-code')).status, 401);
  assert.equal((await request('device-code', null, token(teacher))).body.challenge, null);
  const { body: { challenge }, cache } = await request('device-code', null, learnerToken);
  assert.match(challenge.code, /^\d{6}$/);
  assert.equal(cache, 'no-store');
  const wrong = challenge.code === '123456' ? '654321' : '123456';
  const verify = (code, method = 'device') => request('verify', { ...account, code, method });
  await Promise.all(Array.from({ length: 8 }, () => verify(wrong)));
  assert.equal(learner.passwordChallenge.attempts, 5);
  assert.equal((await verify(challenge.code)).status, 400);
  await request('request', account);
  assert.equal((await request('device-code', null, learnerToken)).body.challenge, null);
  learner.passwordChallenge.expiresAt = new Date(0);
  await request('request', account);
  const current = await request('device-code', null, learnerToken);
  const results = await Promise.all([verify(current.body.challenge.code), verify(current.body.challenge.code)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
  const resetToken = results.find(result => result.status === 200).body.resetToken;
  assert.equal((await request('reset', { resetToken, password: 'new-password', confirmPassword: 'different' })).status, 400);
  const reset = { resetToken, password: 'new-password', confirmPassword: 'new-password' };
  const resets = await Promise.all([request('reset', reset), request('reset', reset)]);
  assert.deepEqual(resets.map(result => result.status).sort(), [200, 400]);
  assert.ok(await bcrypt.compare('new-password', learner.passwordHash));
  assert.equal((await request('device-code', null, learnerToken)).status, 401);

  const teacherToken = token(teacher);
  const { body: backup, status } = await request('backup-code', { password: 'teacher-password' }, teacherToken);
  assert.equal(status, 201);
  assert.ok(!teacher.backupRecoveryHash.includes(backup.code));
  assert.equal((await verify(backup.code, 'backup')).status, 400);
  const proof = { role: 'teacher', identifier: teacher.email, code: backup.code, method: 'backup' };
  const grant = await request('verify', proof);
  assert.equal(grant.status, 200);
  assert.equal((await request('verify', proof)).status, 400);
  assert.equal((await request('reset', { ...reset, resetToken: grant.body.resetToken })).status, 200);
  assert.equal((await request('verify', proof)).status, 400);
});
