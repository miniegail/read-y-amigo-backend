// Read-only projections. Never turn recognizer suggestions into scored errors.
const metric = (value, status, percentage = false) => ({ value: typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!percentage || value <= 100) ? value : null, ...(status ? { status } : {}) });
const identity = value => String(value?._id || value);
const time = value => Number.isFinite(new Date(value).getTime()) ? new Date(value).getTime() : 0;
const isFinal = attempt => attempt?.status === 'graded' && attempt.result?.pendingQuestions === 0;
function quizMetrics(attempt) {
  return metric(isFinal(attempt) ? attempt.result?.percentage : null, attempt?.status === 'pending-review' ? 'pending-review' : undefined, true);
}
function quizScore(attempt) {
  if (!isFinal(attempt)) return null;
  const { correctAnswers, totalQuestions, earnedPoints, maxPoints } = attempt.result;
  return { correctAnswers, totalQuestions, earnedPoints, maxPoints };
}
function buildHistory(submissions, attempts, works) {
  const titles = new Map(works.map(work => [identity(work), work.title]));
  const activities = new Map(works.map(work => [identity(work), work.readingActivities || []]));
  const eligible = attempts.filter(attempt => attempt.status !== 'draft' && attempt.submittedAt);
  const byReading = new Map();
  for (const attempt of eligible.slice().sort((a, b) => time(a.submittedAt) - time(b.submittedAt))) {
    if (attempt.readingSubmission) byReading.set(identity(attempt.readingSubmission), attempt);
  }
  const seen = new Set();
  const history = submissions.map(submission => {
    const id = identity(submission), workId = identity(submission.classwork);
    const attempt = byReading.get(id);
    if (attempt) seen.add(identity(attempt));
    const accuracy = submission.wordAccuracy;
    return {
      id: `reading:${id}`, classworkId: workId, title: attempt?.title || titles.get(workId) || 'Reading activity',
      submittedAt: submission.submittedAt, activities: ['read-aloud', ...(attempt || activities.get(workId)?.includes('comprehension') ? ['comprehension'] : [])],
      readingSubmissionId: id, comprehensionAttemptId: attempt ? identity(attempt) : undefined,
      speed: metric(submission.readingRate?.wpm, submission.readingRate?.status),
      accuracy: metric(accuracy?.reviewedAt ? accuracy.percentage : null, accuracy?.reviewedAt ? 'reviewed' : undefined, true),
      comprehension: quizMetrics(attempt), comprehensionScore: quizScore(attempt),
    };
  });
  for (const attempt of eligible) {
    if (seen.has(identity(attempt))) continue;
    history.push({
      id: `quiz:${identity(attempt)}`, classworkId: identity(attempt.classwork), title: attempt.title || titles.get(identity(attempt.classwork)) || 'Reading activity',
      submittedAt: attempt.submittedAt, activities: attempt.readingSubmission ? ['read-aloud', 'comprehension'] : ['comprehension'],
      comprehensionAttemptId: identity(attempt), readingUnavailable: !!attempt.readingSubmission,
      speed: metric(null), accuracy: metric(null), comprehension: quizMetrics(attempt), comprehensionScore: quizScore(attempt),
    });
  }
  return history.filter(row => time(row.submittedAt)).sort((a, b) => time(b.submittedAt) - time(a.submittedAt) || a.id.localeCompare(b.id));
}
function summarizeHistory(history) {
  const latest = key => {
    const row = history.find(entry => typeof entry[key].value === 'number' && entry[key].status !== 'pending-review');
    return row ? { ...row[key], submittedAt: row.submittedAt } : metric(null);
  };
  return { speed: latest('speed'), accuracy: latest('accuracy'), comprehension: latest('comprehension') };
}
function validateWordAccuracy(body, passage) {
  const { wordsAssessed, errorCount, listened } = body || {};
  if (!passage?.confirmed || !Number.isSafeInteger(passage.wordCount) || passage.wordCount < 1 || listened !== true ||
    !Number.isSafeInteger(wordsAssessed) || wordsAssessed < 1 || wordsAssessed > passage.wordCount ||
    !Number.isSafeInteger(errorCount) || errorCount < 0 || errorCount > wordsAssessed) {
    throw Object.assign(new Error('Listen to the recording and enter valid assessed words and confirmed errors.'), { status: 400 });
  }
  return { wordsAssessed, errorCount, listened: true, percentage: (wordsAssessed - errorCount) / wordsAssessed * 100 };
}
function resultSummary(attempt) {
  return { _id: identity(attempt), classwork: identity(attempt.classwork),
    readingSubmission: attempt.readingSubmission ? identity(attempt.readingSubmission) : undefined,
    title: attempt.title, attemptLabel: attempt.readingSubmission ? 'Linked reading attempt' : 'Comprehension-only attempt',
    status: attempt.status, result: attempt.result ? {
      status: attempt.result.status, correctAnswers: attempt.result.correctAnswers, totalQuestions: attempt.result.totalQuestions,
      pendingQuestions: attempt.result.pendingQuestions, percentage: isFinal(attempt) ? attempt.result.percentage : null,
      earnedPoints: attempt.result.earnedPoints, maxPoints: attempt.result.maxPoints,
    } : null, submittedAt: attempt.submittedAt, reviewedAt: attempt.reviewedAt };
}
module.exports = { identity, buildHistory, summarizeHistory, validateWordAccuracy, resultSummary };