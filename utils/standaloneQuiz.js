const { validateQuiz } = require('./comprehension');
function standaloneConfig(work) {
  // Preserve keys privately in the immutable attempt. Written responses always
  // require teacher review, including legacy short-answer expected answers.
  const questions = (work.questions || []).map(q => ({
    type: q.type, question: q.question, choices: q.type === 'true-false' ? ['True', 'False'] : q.choices,
    correctAnswer: q.correctAnswer, points: q.points ?? 1,
    ...(['short-answer', 'essay'].includes(q.type) && typeof q.correctAnswer === 'string' ? { expectedAnswer: q.correctAnswer } : {}),
    ...(q.type === 'essay' ? { rubric: q.rubric || 'Teacher evaluates correctness and awards points using the classroom assessment criteria.' } : {}),
  }));
  return validateQuiz({ passageAccess: 'after-submission', questions });
}
module.exports = { standaloneConfig };
