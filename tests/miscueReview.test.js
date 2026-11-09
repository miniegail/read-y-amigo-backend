const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateMiscueReview } = require('../utils/miscueReview');
const passage = { confirmed: true, text: 'The little boy' };
const event = { id: 'v1-0', kind: 'omission', status: 'confirmed', source: 'comparison', passageStart: 1, passageEnd: 2, transcriptStart: 1, transcriptEnd: 1, note: '' };
const body = { algorithmVersion: 'v1', listened: true, events: [event] };
test('persists review decisions with explicit listening acknowledgement', () => {
 assert.equal(validateMiscueReview(body, passage, 'The boy').events[0].kind, 'omission');
 for (const kind of ['self-correction','dialect-variation','hesitation']) assert.equal(validateMiscueReview({ ...body, events: [{ ...event, kind }] }, passage, 'The boy').events[0].kind,kind);
});
test('rejects forged metadata, malformed positions and unreviewed audio', () => {
 for (const patch of [{ listened: false }, { algorithmVersion: 'v2' }, { events: [event,event] }, { events: [{ ...event, passageEnd: 4 }] }, { events: [{ ...event, status: 'scored' }] }, { events: [{ ...event, passageStart: 1.5 }] }]) assert.throws(() => validateMiscueReview({ ...body, ...patch },passage,'The boy'));
 assert.throws(() => validateMiscueReview(body,{ ...passage, confirmed: false },'The boy'));
 const result = validateMiscueReview({ ...body, reviewedBy: 'learner', score: 100 },passage,'The boy');
 assert.equal(result.reviewedBy, undefined); assert.equal(result.score, undefined);
});
