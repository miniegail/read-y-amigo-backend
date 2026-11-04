const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

const multer = require("multer");
const { saveBuffer, getBucket } = require("../utils/gridfs");
const { MAX_PHOTO_BYTES, photoMime, readingPreferences } = require("../utils/profileValidation");
const router = express.Router();
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }).single("photo");
async function discardPhoto(id) {
  if (id) { try { await getBucket().delete(new (require("mongoose").Types.ObjectId)(id)); } catch (error) { console.error("Photo cleanup:", error.message); } }
}


// Same Web Client ID you created in Google Cloud Console.
const GOOGLE_WEB_CLIENT_ID = "389325768571-lmou7c6pp8n9gsmqj4hj6snai2fo533d.apps.googleusercontent.com";
const googleClient = new OAuth2Client(GOOGLE_WEB_CLIENT_ID);

// Verifies that the CAPTCHA token came from our math challenge modal.
function verifyCaptchaToken(token) {
  return typeof token === "string" && token.startsWith("math-captcha-");
}

function createToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

// Short-lived token for the gap between "verified with Google" and
// "finished the complete-profile form". Tagged with type so it can never
// be mistaken for (or used as) a normal 30-day session token.
function createPendingSignupToken({ googleId, email, name, role }) {
  return jwt.sign(
    { type: "google-pending-signup", googleId, email, name, role },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

// Strips the password hash before sending a user object back to the app.
function toPublicUser(user) {
  const { passwordHash, ...publicUser } = user.toObject();
  return publicUser;
}

router.post("/teacher-signup", async (req, res) => {
  try {
    const {
      captchaToken,
      firstName,
      secondName,
      middleInitial,
      displayName,
      age,
      learnerLevel,
      email,
      password,
    } = req.body;

    // Verify CAPTCHA before doing anything else.
    if (!verifyCaptchaToken(captchaToken)) {
      return res.status(400).json({ error: "Please complete the verification." });
    }

    if (!firstName || !secondName || !displayName || !age || !email || !password) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    if (Number(age) < 15) {
      return res.status(400).json({ error: "Teachers must be at least 15 years old." });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      role: "teacher",
      firstName,
      secondName,
      middleInitial,
      displayName,
      age,
      learnerLevel,
      email: email.toLowerCase(),
      passwordHash,
    });

    const token = createToken(user);
    res.status(201).json({ token, user: toPublicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/learner-signup", async (req, res) => {
  try {
    const {
      captchaToken,
      firstName,
      secondName,
      middleInitial,
      displayName,
      age,
      username,
      password,
    } = req.body;

    // Verify CAPTCHA before doing anything else.
    if (!verifyCaptchaToken(captchaToken)) {
      return res.status(400).json({ error: "Please complete the verification." });
    }

    if (!firstName || !secondName || !displayName || !age || !username || !password) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    if (Number(age) < 3) {
      return res.status(400).json({ error: "Learners must be at least 3 years old." });
    }

    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(409).json({ error: "That username is already taken." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      role: "learner",
      firstName,
      secondName,
      middleInitial,
      displayName,
      age,
      username,
      passwordHash,
    });

    const token = createToken(user);
    res.status(201).json({ token, user: toPublicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Shared login for both teachers (email) and learners (username).
router.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: "Enter your email/username and password." });
    }

    const user = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, { username: identifier }],
    });

    if (!user) {
      return res.status(401).json({ error: "Couldn't log in. Check your details and try again." });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Couldn't log in. Check your details and try again." });
    }

    const token = createToken(user);
    res.json({ token, user: toPublicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Verifies a Google ID token. If an account for this Google user already
// exists, logs them in directly. If not, DOES NOT create the account yet
// (firstName/secondName/age are required on User but Google never gives us
// age, and only gives a single full name). Instead it returns a short-lived
// pendingToken for the app to use with POST /auth/google/complete-signup.
router.post("/google", async (req, res) => {
  const { idToken, role } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: "Missing Google ID token." });
  }
  if (role !== "teacher" && role !== "learner") {
    return res.status(400).json({ error: "Missing or invalid role." });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_WEB_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    return res.status(401).json({ error: "Invalid Google token." });
  }

  const { email, name, sub: googleId } = payload;
  if (!email) {
    return res.status(400).json({ error: "Google account has no email." });
  }

  try {
    let user = await User.findOne({ $or: [{ googleId }, { email: email.toLowerCase() }] });

    if (user) {
      // Existing password-based account signing in with Google for the
      // first time — link the two so future Google sign-ins match directly.
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
      const token = createToken(user);
      return res.json({ token, user: toPublicUser(user) });
    }

    // Brand-new user — hand back a pending token instead of creating the
    // account, so the app can collect the missing required fields first.
    const pendingToken = createPendingSignupToken({
      googleId,
      email: email.toLowerCase(),
      name,
      role,
    });
    return res.json({
      needsProfile: true,
      pendingToken,
      suggestedDisplayName: name || email.split("@")[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Finishes a Google sign-up by collecting the fields Google doesn't
// provide (first/second name, age) and creating the actual account.
router.post("/google/complete-signup", async (req, res) => {
  const { pendingToken, firstName, secondName, middleInitial, displayName, age, learnerLevel } = req.body;

  if (!pendingToken) {
    return res.status(400).json({ error: "Missing signup session. Please start over with Google." });
  }
  if (!firstName || !secondName || !displayName || !age) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  let pending;
  try {
    pending = jwt.verify(pendingToken, process.env.JWT_SECRET);
    if (pending.type !== "google-pending-signup") throw new Error("Wrong token type");
  } catch {
    return res.status(401).json({ error: "Your signup session expired. Please start over with Google." });
  }

  const { googleId, email, role } = pending;

  if (role === "teacher" && Number(age) < 15) {
    return res.status(400).json({ error: "Teachers must be at least 15 years old." });
  }
  if (role === "learner" && Number(age) < 3) {
    return res.status(400).json({ error: "Learners must be at least 3 years old." });
  }

  try {
    // Guard against the account having been created in the meantime
    // (e.g. the user double-tapped, or signed up another way first).
    const existing = await User.findOne({ $or: [{ googleId }, { email }] });
    if (existing) {
      const token = createToken(existing);
      return res.json({ token, user: toPublicUser(existing) });
    }

    const user = await User.create({
      role,
      googleId,
      email,
      firstName,
      secondName,
      middleInitial,
      displayName,
      age,
      learnerLevel: role === "teacher" ? learnerLevel : undefined,
      // No passwordHash — this account signs in via Google only.
    });

    const token = createToken(user);
    res.status(201).json({ token, user: toPublicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/auth/me - returns the logged-in user's own profile.
// Used by the dashboard to show fresh info without re-sending credentials.
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// PATCH /api/auth/me - update the logged-in user's own profile
router.patch("/me", requireAuth, async (req, res) => {
  try {
    // Only these fields are editable. role/email/username are intentionally
    // excluded here since changing those needs extra validation
    // (uniqueness checks, re-verification, etc.) - add that later if needed.
    const editableFields = [
      "firstName",
      "secondName",
      "middleInitial",
      "displayName",
      "age",
      "learnerLevel",
    ];

    const updates = {};
    for (const field of editableFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    for (const field of ["firstName", "secondName", "displayName"]) {
      if (updates[field] !== undefined) {
        if (typeof updates[field] !== "string" || !updates[field].trim() || updates[field].trim().length > 100)
          return res.status(400).json({ error: "Names must contain 1 to 100 characters." });
        updates[field] = updates[field].trim();
      }
    }
    if (req.body.readingPreferences !== undefined) {
      try { updates.readingPreferences = readingPreferences(req.body.readingPreferences); }
      catch (error) { return res.status(400).json({ error: error.message }); }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update." });
    }

    const user = await User.findByIdAndUpdate(req.userId, updates, {
      new: true,
      runValidators: true,
    });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Owner-only image upload. A replacement is saved before the old file is removed.
router.post("/me/photo", requireAuth, (req, res) => {
  photoUpload(req, res, async (error) => {
    if (error) return res.status(400).json({ error: "Choose one JPG, PNG, or WebP image up to 5 MB." });
    const mime = req.file && photoMime(req.file.buffer);
    if (!mime) return res.status(400).json({ error: "Choose a valid JPG, PNG, or WebP image up to 5 MB." });
    let newId;
    try {
      const user = await User.findById(req.userId);
      if (!user) return res.status(404).json({ error: "User not found." });
      newId = await saveBuffer({ buffer: req.file.buffer, filename: `profile-${req.userId}.${mime.split("/")[1]}`,
        mimeType: mime, metadata: { kind: "profile-photo", uploadedBy: req.userId } });
      const previous = user.profilePhotoFileId;
      user.profilePhotoFileId = String(newId);
      user.profilePhoto = `/api/files/${newId}`;
      await user.save();
      await discardPhoto(previous);
      res.json({ user: toPublicUser(user) });
    } catch (error) {
      await discardPhoto(newId);
      console.error(error);
      res.status(500).json({ error: "Couldn't save your photo. Please try again." });
    }
  });
});
router.delete("/me/photo", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found." });
    const previous = user.profilePhotoFileId;
    user.profilePhoto = "";
    user.profilePhotoFileId = "";
    await user.save();
    await discardPhoto(previous);
    res.json({ user: toPublicUser(user) });
  } catch (error) { res.status(500).json({ error: "Couldn't remove your photo. Please try again." }); }
});
module.exports = router;