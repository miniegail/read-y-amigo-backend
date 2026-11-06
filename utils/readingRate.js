const MAX_TEXT = 100000;
const MAX_WORDS = 100000;
const normalizeText = (text) => text.replace(/\r\n?/g, '\n').trim();
// v1: Unicode letters/marks/numbers, internal apostrophes/hyphens and decimals.
const countWords = (text) => (text.normalize('NFC').match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:(?:['’\-‐‑][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)|(?:[.,](?=\p{N})\p{N}+))*/gu) || []).length;
function bad(message) { const err = new Error(message); err.status = 400; throw err; }
function object(value, keys, label) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { bad(`Invalid ${label} JSON.`); } }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) bad(`Invalid ${label} fields.`);
  return value;
}
function parsePassage(value, source, userId) {
  if (value === undefined) return undefined; // Legacy assignments remain valid.
  const p = object(value, ['text','wordCount','countMethod','confirmed','tokenizerVersion'], 'readingPassage');
  if (typeof p.text !== 'string' || p.text.length > MAX_TEXT || !normalizeText(p.text)) bad('Passage text must contain 1–100,000 characters.');
  if (p.confirmed !== true || p.tokenizerVersion !== 'v1' || !['automatic','manual'].includes(p.countMethod)) bad('Confirm the passage with tokenizerVersion v1 and a valid count method.');
  if (!Number.isInteger(p.wordCount) || p.wordCount < 1 || p.wordCount > MAX_WORDS) bad('Word count must be an integer from 1 to 100,000.');
  const text = normalizeText(p.text);
  if (source.readingSource === 'text' && text !== source.readingText) bad('Confirmed passage must match readingText.');
  const automaticCount = countWords(text);
  if (automaticCount < 1) bad('Passage must contain at least one word.');
  if (p.countMethod === 'automatic' && p.wordCount !== automaticCount) bad('The passage word count has changed. Confirm it again.');
  const wordCount = p.wordCount;
  return { text, wordCount, countMethod: p.countMethod, confirmed: true, tokenizerVersion: 'v1', confirmedBy: userId, confirmedAt: new Date() };
}
function parseMeasurement(value, passage, durationMs) {
  if (value === undefined) return undefined;
  const m = object(value, ['completed','wordsRead','startMs','endMs','interrupted'], 'readingMeasurement');
  if (typeof m.completed !== 'boolean' || typeof m.interrupted !== 'boolean' || !Number.isInteger(m.wordsRead) || m.wordsRead < 0 || m.wordsRead > MAX_WORDS || !Number.isSafeInteger(m.startMs) || !Number.isSafeInteger(m.endMs) || m.startMs < 0 || m.endMs <= m.startMs) bad('Invalid reading measurement.');
  if (passage?.confirmed === true && (m.completed ? m.wordsRead !== passage.wordCount : m.wordsRead >= passage.wordCount)) bad('Words read must match completion and the confirmed passage count.');
  let endMs = m.endMs;
  if (Number.isFinite(durationMs) && durationMs > 0) {
    if (m.startMs >= durationMs || endMs > durationMs + 100) bad('Reading measurement is outside the audio bounds.');
    endMs = Math.min(endMs, durationMs);
  }
  return { completed: m.completed, wordsRead: m.wordsRead, startMs: m.startMs, endMs, interrupted: m.interrupted };
}
function calculateRate(measurement, passage, durationMs, status) {
  // This helper is also safe for unparsed/legacy data. Do not trust callers.
  if (!passage || typeof passage.text !== 'string' || passage.text.length > MAX_TEXT ||
      passage.confirmed !== true || passage.tokenizerVersion !== 'v1' ||
      !['automatic', 'manual'].includes(passage.countMethod) ||
      !Number.isSafeInteger(passage.wordCount) || passage.wordCount < 1 || passage.wordCount > MAX_WORDS ||
      !Number.isSafeInteger(durationMs) || durationMs <= 0 ||
      !['provisional', 'reviewed'].includes(status)) return null;
  const automaticCount = countWords(passage.text);
  if (automaticCount === 0 || (passage.countMethod === 'automatic' && automaticCount !== passage.wordCount)) return null;
  if (!measurement || typeof measurement !== 'object' || Array.isArray(measurement) ||
      measurement.interrupted !== false || measurement.endMs > durationMs) return null;
  let validated;
  try { validated = parseMeasurement(measurement, passage, durationMs); } catch { return null; }
  if (validated.wordsRead === 0) return null;
  const readingSeconds = (validated.endMs - validated.startMs) / 1000;
  const wpm = validated.wordsRead * 60 / readingSeconds;
  if (!Number.isFinite(readingSeconds) || readingSeconds <= 0 || !Number.isFinite(wpm) || wpm <= 0) return null;
  return { wordsRead: validated.wordsRead, readingSeconds, wpm, status };
}
async function measureAudio(buffer) {
  try {
    const { parseBuffer } = await import('music-metadata');
    const { format } = await parseBuffer(buffer, { size: buffer.length }, { duration: true, skipCovers: true });
    const ms = Math.round(format.duration * 1000);
    return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
  } catch { return null; }
}
function rejectAuthoredFields(body) {
  for (const key of ['readingRate','confirmedBy','confirmedAt','reviewedBy','reviewedAt','durationVerified','readingPassageSnapshot']) {
    if (body[key] !== undefined) bad(`${key} is server authored.`);
  }
}
module.exports = { normalizeText, countWords, parsePassage, parseMeasurement, calculateRate, measureAudio, rejectAuthoredFields };
