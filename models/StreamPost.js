const mongoose = require("mongoose");

const streamPostSchema = new mongoose.Schema(
  {
    class: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StreamPost", streamPostSchema);