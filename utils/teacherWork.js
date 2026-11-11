const identity = value => String(value?._id || value);
function readingReviewed(submission) {
  return !!submission.verification?.verifiedAt || (submission.readingRate?.status === 'reviewed' && !!submission.wordAccuracy?.reviewedAt);
}
function toCheckItems(classes, works, readings, activities, comprehension, quizzes) {
  const classMap = new Map(classes.map(row => [identity(row), row]));
  const workMap = new Map(works.map(row => [identity(row), row]));
  const items = [];
  const add = (row, kind, status) => {
    const classroom = classMap.get(identity(row.class)), work = workMap.get(identity(row.classwork));
    if (!classroom || !work || identity(work.class) !== identity(classroom)) return;
    items.push({ _id: `${kind}:${identity(row)}`, kind, status, learnerId: identity(row.learner),
      learnerName: row.learner?.displayName || [row.learner?.firstName, row.learner?.secondName].filter(Boolean).join(' ') || 'Learner',
      title: row.title || work.title, classId: identity(classroom), classTitle: classroom.title,
      classworkId: identity(work), submissionId: ['reading', 'activity'].includes(kind) ? identity(row) : undefined,
      attemptId: ['comprehension', 'quiz'].includes(kind) ? identity(row) : undefined, submittedAt: row.submittedAt });
  };
  readings.filter(row => !readingReviewed(row)).forEach(row => add(row, 'reading', 'Needs verification'));
  activities.filter(row => !row.checkedAt).forEach(row => add(row, 'activity', 'Not checked'));
  comprehension.filter(row => row.status === 'pending-review').forEach(row => add(row, 'comprehension', 'Needs review'));
  quizzes.filter(row => row.status === 'pending-review').forEach(row => add(row, 'quiz', 'Needs review'));
  return items.sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || a._id.localeCompare(b._id));
}
module.exports = { readingReviewed, toCheckItems };
