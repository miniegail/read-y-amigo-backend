const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "multiple-choice",
        "checkboxes",
        "true-false",
        "short-answer",
        "essay",
      ],
      required: true,
    },

    question: {
      type: String,
      required: true,
      trim: true,
    },

    // Used by multiple-choice and checkboxes
    choices: [
      {
        type: String,
        trim: true,
      },
    ],

    // Can be a number for multiple-choice,
    // an array of numbers for checkboxes,
    // or a string for other question types.
    correctAnswer: {
      type: mongoose.Schema.Types.Mixed,
    },

    points: {
      type: Number,
      default: 1,
      min: 0,
    },
  },
  {
    _id: true,
  }
);

const classworkSchema = new mongoose.Schema(
  {
    class: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    // reading, activity, or quiz
    type: {
      type: String,
      enum: ["reading", "activity", "quiz"],
      required: true,
    },

    // Date + time
    dueDate: {
      type: Date,
    },

    points: {
      type: Number,
      default: 0,
      min: 0,
    },

     // Uploaded file (stored in GridFS; `url` points at /api/files/<fileId>.
    // Older classwork may still have a legacy /uploads/... url and no fileId.)
    attachment: {
      name: { type: String },
      url: { type: String },
      fileId: { type: mongoose.Schema.Types.ObjectId },
      mimeType: { type: String },
      size: { type: Number },
    },

    // Optional existing Material Library item
    material: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Material",
      default: null,
    },

    // Reading Assignment activities
    readingActivities: [
      {
        type: String,
        enum: ["read-aloud", "comprehension"],
      },
    ],

    // Quiz format
    quizType: {
      type: String,
      enum: [
        "multiple-choice",
        "checkboxes",
        "true-false",
        "short-answer",
        "essay",
        "mixed",
      ],
    },

    questions: [questionSchema],

    // If true, every enrolled learner gets the classwork
    assignToAll: {
      type: Boolean,
      default: true,
    },

    // Specific learner User IDs
    assignedTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },

  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Classwork", classworkSchema);