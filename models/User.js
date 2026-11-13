const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["teacher", "learner"],
      required: true,
    },

    termsAcceptance: { version: String, acceptedAt: Date },

    firstName: { type: String, required: true },
    secondName: { type: String, required: true },
    middleInitial: { type: String },
    displayName: { type: String, required: true },
    age: { type: Number, required: true },

    profilePhoto: { type: String, default: "" },
    profilePhotoFileId: { type: String, default: "" },
    readingPreferences: {
      textSize: { type: String, enum: ["small", "standard", "large"], default: "standard" },
      followReading: { type: Boolean, default: true },
    },

    // Teacher-only field
    learnerLevel: { type: String },

    // Teachers log in with email, learners with username.
    // Only one of these will be set depending on role.
    email: { type: String, unique: true, sparse: true, lowercase: true },
    username: { type: String, unique: true, sparse: true },

    // Set only for accounts created/linked via "Continue with Google".
    googleId: { type: String, unique: true, sparse: true },

    // Never store plain-text passwords - this stores the bcrypt hash.
    // Not required for Google accounts, which have no password.
    passwordHash: { type: String, required: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);