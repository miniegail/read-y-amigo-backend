const mongoose = require("mongoose");

const classworkSchema = new mongoose.Schema(
  {
    class: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
    },
    title: { type: String, required: true },
    description: { type: String },
    dueDate: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Classwork", classworkSchema);