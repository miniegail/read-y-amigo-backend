const mongoose = require('mongoose');
const { Schema } = mongoose;
const readingPassageSchema = new Schema({
  text: { type: String, required: true, maxlength: 100000 },
  wordCount: { type: Number, required: true, min: 1, max: 100000, validate: Number.isInteger },
  countMethod: { type: String, enum: ['automatic', 'manual'], required: true },
  confirmed: { type: Boolean, required: true, enum: [true] },
  tokenizerVersion: { type: String, enum: ['v1'], required: true },
  confirmedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  confirmedAt: { type: Date, required: true },
}, { _id: false });
const readingMeasurementSchema = new Schema({
  completed: { type: Boolean, required: true },
  wordsRead: { type: Number, required: true, min: 0, max: 100000, validate: Number.isInteger },
  startMs: { type: Number, required: true, min: 0 },
  endMs: { type: Number, required: true, min: 0 },
  interrupted: { type: Boolean, required: true },
}, { _id: false });
const readingRateSchema = new Schema({
  wordsRead: Number, readingSeconds: Number, wpm: Number,
  status: { type: String, enum: ['provisional', 'reviewed'] },
}, { _id: false });
module.exports = { readingPassageSchema, readingMeasurementSchema, readingRateSchema };
