const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReadingSource } = require('../utils/readingSource');
const Classwork = require('../models/ClassWork');
const Submission = require('../models/Submission');
const mongoose = require('mongoose');
const id = () => new mongoose.Types.ObjectId();

test('text passages retain paragraphs, Unicode, and literal markup', () => {
  const text = '  Ang bata.\n\n“Hello!” <script>literal text</script>  ';
  const passage = parseReadingSource({ type: 'reading', readingSource: 'text', readingText: text }, false);
  const doc = new Classwork({ class: id(), title: 'Read', type: 'reading', ...passage });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.toObject().readingText, text.trim());
  assert.equal(doc.toObject().readingSource, 'text');
});
test('files and older classwork keep the file source', () => {
  assert.deepEqual(parseReadingSource({ type: 'reading', readingSource: 'file' }, true), { readingSource: 'file', readingText: '' });
  const legacy = new Classwork({ class: id(), title: 'Old', type: 'reading' });
  assert.equal(legacy.readingSource, 'file');
  assert.equal(legacy.readingText, '');
  assert.doesNotThrow(() => parseReadingSource({ type: 'reading' }, false));
});
test('reject empty text, invalid source, missing files, mixed sources, and oversized text', () => {
  for (const [body, hasFile] of [
    [{ readingSource: 'text', readingText: ' \n ' }, false],
    [{ readingSource: 'unknown' }, false],
    [{ readingSource: 'file' }, false],
    [{ readingSource: 'file', readingText: 'Hello' }, true],
    [{ readingSource: 'text', readingText: 'Hello' }, true],
    [{ readingSource: 'text', readingText: 'Hello', material: 'abc' }, false],
    [{ readingSource: 'text', readingText: 'x'.repeat(100001) }, false],
  ]) assert.throws(() => parseReadingSource({ type: 'reading', ...body }, hasFile));
});
test('activities and quizzes remain unchanged', () => {
  assert.deepEqual(parseReadingSource({ type: 'quiz' }, false), {});
  assert.deepEqual(parseReadingSource({ type: 'activity' }, true), {});
});
test('speech transcripts persist alongside WAV audio', () => {
  const doc = new Submission({ class: id(), classwork: id(), learner: id(),
    transcript: 'The child reads.', transcriptLocale: 'en-US',
    audio: { fileId: id(), url: '/api/files/example', mimeType: 'audio/wav', durationMs: 3000 } });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.toObject().transcript, 'The child reads.');
  doc.transcriptLocale = 'unsupported';
  assert.ok(doc.validateSync());
});
