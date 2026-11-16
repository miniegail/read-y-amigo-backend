const express = require('express');
const bcrypt = require('bcryptjs');
const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const User = require('../models/User');
const DeviceSession = require('../models/DeviceSession');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const lifetimeMs = 10 * 60 * 1000;
const maxAttempts = 5;
const newSecret = () => randomBytes(32).toString('hex');
const hash = (purpose, value) => createHash('sha256').update(purpose + ':' + value).digest('hex');

function passwordAccount(identifier, role) {
  if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 254 ||
      !['teacher', 'learner'].includes(role)) return null;
  const value = identifier.trim();
  const identity = role === 'teacher' ? { email: value.toLowerCase() } : { username: value };
  return { role, ...identity, passwordHash: { $type: 'string' } };
}

function available(field, now) {
  return { $or: [{ [field]: { $exists: false } }, { [field + '.expiresAt']: { $lte: now } }] };
}

function otp(nonce, userId) {
  const digest = createHmac('sha256', process.env.JWT_SECRET)
    .update('password-recovery:' + userId + ':' + nonce).digest();
  return String(digest.readUIntBE(0, 6) % 1_000_000).padStart(6, '0');
}

function route(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch(error => {
    console.error('Password recovery failed:', error.name);
    res.status(500).json({ error: 'Could not complete password recovery. Try again.' });
  });
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.post('/request', route(async (req, res) => {
  const account = passwordAccount(req.body.identifier, req.body.role);
  if (!account) return res.status(400).json({ error: 'Choose your account type and enter your email or username.' });
  const now = new Date();
  await User.updateOne({ ...account, $and: [available('passwordChallenge', now), available('passwordResetGrant', now)] }, {
    $set: { passwordChallenge: { nonce: newSecret(), expiresAt: new Date(+now + lifetimeMs), attempts: 0, used: false } },
  });
  res.status(202).json({ accepted: true });
}));

router.get('/device-code', requireAuth, route(async (req, res) => {
  if (!req.sessionId) return res.json({ challenge: null });
  const user = await User.findOne({
    _id: req.userId,
    passwordRevision: req.passwordRevision ?? { $exists: false },
    'passwordChallenge.expiresAt': { $gt: new Date() },
    'passwordChallenge.used': false,
    'passwordChallenge.attempts': { $lt: maxAttempts },
  }).select('+passwordChallenge').lean();
  const challenge = user?.passwordChallenge;
  res.json({ challenge: challenge ? {
    id: hash('challenge', challenge.nonce), code: otp(challenge.nonce, req.userId), expiresAt: challenge.expiresAt,
  } : null });
}));

router.post('/backup-code', requireAuth, route(async (req, res) => {
  const { password } = req.body;
  if (typeof password !== 'string' || !password || password.length > 1024) {
    return res.status(400).json({ error: 'Enter your current password.' });
  }
  const user = await User.findOne({
    _id: req.userId, passwordRevision: req.passwordRevision ?? { $exists: false },
  }).select('+passwordRevision');
  if (!user?.passwordHash || !await bcrypt.compare(password, user.passwordHash)) {
    return res.status(403).json({ error: 'Enter the current password for this account.' });
  }
  const code = randomBytes(16).toString('hex');
  const saved = await User.updateOne({ _id: user._id, passwordHash: user.passwordHash }, {
    $set: { backupRecoveryHash: hash('backup', code) },
  });
  if (!saved.modifiedCount) return res.status(409).json({ error: 'Your password changed. Please sign in again.' });
  res.status(201).json({ code: code.match(/.{4}/g).join('-') });
}));

router.post('/verify', route(async (req, res) => {
  const { identifier, role, code, method } = req.body;
  const account = passwordAccount(identifier, role);
  const reject = () => res.status(400).json({ error: 'This code is incorrect, expired, or already used.' });
  if (!account || typeof code !== 'string' || code.length > 64) return reject();

  const now = new Date();
  const resetToken = newSecret();
  const grant = { hash: hash('reset', resetToken), expiresAt: new Date(+now + lifetimeMs) };
  let accepted;
  if (method === 'backup') {
    if (!/^(?:[a-f0-9]{32}|(?:[a-f0-9]{4}-){7}[a-f0-9]{4})$/i.test(code)) return reject();
    const backupRecoveryHash = hash('backup', code.replace(/-/g, '').toLowerCase());
    accepted = await User.findOneAndUpdate({ backupRecoveryHash, ...account, ...available('passwordResetGrant', now) }, {
      $set: { passwordResetGrant: grant }, $unset: { passwordChallenge: 1 },
    });
  } else if (method === 'device' && /^[0-9]{6}$/.test(code)) {
    // Reserve an attempt in MongoDB before comparing. Parallel guesses share the same budget.
    const reserved = await User.findOneAndUpdate({
      ...account,
      ...available('passwordResetGrant', now),
      'passwordChallenge.expiresAt': { $gt: now },
      'passwordChallenge.attempts': { $lt: maxAttempts },
      'passwordChallenge.used': false,
    }, { $inc: { 'passwordChallenge.attempts': 1 } }, { projection: { passwordChallenge: 1 } }).lean();
    if (!reserved || !timingSafeEqual(
      Buffer.from(code), Buffer.from(otp(reserved.passwordChallenge.nonce, String(reserved._id))),
    )) return reject();

    accepted = await User.findOneAndUpdate({
      _id: reserved._id,
      ...available('passwordResetGrant', now),
      'passwordChallenge.nonce': reserved.passwordChallenge.nonce,
      'passwordChallenge.expiresAt': { $gt: new Date() },
      'passwordChallenge.used': false,
    }, { $set: { passwordResetGrant: grant, 'passwordChallenge.used': true } });
  }
  if (!accepted) return reject();
  res.json({ resetToken });
}));

router.post('/reset', route(async (req, res) => {
  const { resetToken, password, confirmPassword } = req.body;
  if (typeof password !== 'string' || password !== confirmPassword) {
    return res.status(400).json({ error: 'The passwords must match.' });
  }
  if ([...password].length < 8 || Buffer.byteLength(password) > 72) {
    return res.status(400).json({ error: 'Use at least 8 characters and at most 72 bytes.' });
  }
  const reject = () => res.status(400).json({ error: 'Your reset session expired. Request a new code.' });
  if (typeof resetToken !== 'string' || !/^[a-f0-9]{64}$/.test(resetToken)) return reject();
  const filter = () => ({
    'passwordResetGrant.hash': hash('reset', resetToken),
    'passwordResetGrant.expiresAt': { $gt: new Date() },
  });
  const user = await User.findOne(filter()).select('_id +passwordRevision').lean();
  if (!user) return reject();
  const passwordRevision = newSecret();
  const updated = await User.updateOne({ _id: user._id, ...filter() }, {
    $set: { passwordHash: await bcrypt.hash(password, 10), passwordRevision },
    $unset: { passwordResetGrant: 1, passwordChallenge: 1, backupRecoveryHash: 1 },
  });
  if (!updated.modifiedCount) return reject();

  // The password revision immediately invalidates both legacy tokens and old device sessions.
  // Remove stale device records as cleanup without touching a concurrent sign-in.
  void DeviceSession.deleteMany({ user: user._id, passwordRevision: user.passwordRevision ?? { $exists: false } })
    .catch(error => console.error('Could not remove old device sessions:', error.message));
  res.json({ reset: true });
}));

module.exports = router;
