const kinds = ['omission', 'substitution', 'insertion', 'repetition', 'mispronunciation', 'hesitation', 'self-correction', 'dialect-variation'];
function wordCount(text) {
  return (text.normalize('NFC').match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:(?:['’\-‐‑][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)|(?:[.,](?=\p{N})\p{N}+))*/gu) || []).length;
}
function validateMiscueReview(body, passage, transcript) {
  const fail = () => { throw Object.assign(new Error('Invalid miscue review. Listen to the recording and check event types, decisions and word positions.'), { status: 400 }); };
  if (!passage?.confirmed || body?.algorithmVersion !== 'v1' || body.listened !== true || !Array.isArray(body.events) || body.events.length > 1000) fail();
  const p = wordCount(passage.text), t = wordCount(transcript || '');
  if (body.comparedThrough !== undefined && (!Number.isSafeInteger(body.comparedThrough) || body.comparedThrough < 1 || body.comparedThrough > p)) fail();
  const ids = new Set();
  const events = body.events.map(e => {
    if (!e || typeof e.id !== 'string' || !e.id || e.id.length > 100 || ids.has(e.id) || !kinds.includes(e.kind) || !['pending', 'confirmed', 'dismissed'].includes(e.status) || !['comparison', 'teacher'].includes(e.source) || typeof e.note !== 'string' || e.note.length > 2000) fail();
    ids.add(e.id);
    for (const [start, end, max] of [[e.passageStart, e.passageEnd, p], [e.transcriptStart, e.transcriptEnd, t]])
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > max) fail();
    if (e.passageStart === e.passageEnd && e.transcriptStart === e.transcriptEnd) fail();
    return Object.fromEntries(['id', 'kind', 'status', 'passageStart', 'passageEnd', 'transcriptStart', 'transcriptEnd', 'source', 'note'].map(k => [k, e[k]]));
  });
  return { algorithmVersion: 'v1', listened: true, events, ...(body.comparedThrough === undefined ? {} : { comparedThrough: body.comparedThrough }) };
}
module.exports = { validateMiscueReview };