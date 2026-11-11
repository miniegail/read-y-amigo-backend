const { createHash, randomUUID } = require('node:crypto');
const kinds = ['multiple-choice', 'true-false', 'checkboxes', 'short-answer', 'essay'];
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value, max, name, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`Invalid ${name}.`);
  return value.trim();
}
function passageHash(passage) {
  if (!passage?.confirmed || typeof passage.text !== 'string' || !passage.text.trim() || passage.text.length > 100000 || !Number.isSafeInteger(passage.wordCount) || passage.wordCount < 1) fail('A confirmed passage is required.');
  return createHash('sha256').update(JSON.stringify([passage.text.normalize('NFC').replace(/\r\n?/g, '\n').trim(), passage.wordCount])).digest('hex');
}
function validateQuiz(input) {
  if (!input || typeof input !== 'object' || !['during-quiz', 'after-submission'].includes(input.passageAccess)) fail('Choose the passage access setting.');
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 100) fail('Use 1–100 comprehension questions.');
  const questions = input.questions.map((q, index) => {
    if (!q || !kinds.includes(q.type)) fail(`Question ${index + 1}: invalid type.`);
    const manual = ['short-answer', 'essay'].includes(q.type);
    const out = { id: `q${index + 1}`, type: q.type, question: text(q.question, 4000, 'question', true), points: q.points ?? 1 };
    if (!Number.isFinite(out.points) || out.points <= 0 || out.points > 1000) fail('Question points must be greater than 0 and at most 1,000.');
    if (!manual) {
      const choices = q.type === 'true-false' ? ['True', 'False'] : q.choices;
      if (!Array.isArray(choices) || choices.length < 2 || choices.length > 12) fail(`Question ${index + 1}: use 2–12 choices.`);
      out.choices = choices.map(c => text(c, 1000, 'choice', true));
      if (new Set(out.choices.map(c => c.toLocaleLowerCase())).size !== out.choices.length) fail('Choices must be distinct.');
      const key = q.correctAnswer;
      const valid = value => Number.isSafeInteger(value) && value >= 0 && value < choices.length;
      if (q.type === 'checkboxes') {
        if (!Array.isArray(key) || !key.length || new Set(key).size !== key.length || !key.every(valid)) fail(`Question ${index + 1}: invalid checkbox answer key.`);
        out.correctAnswer = [...key].sort((a, b) => a - b);
      } else { if (!valid(key)) fail(`Question ${index + 1}: invalid answer key.`); out.correctAnswer = key; }
    }
    for (const field of ['expectedAnswer', 'rubric', 'supportingParagraph']) if (q[field] !== undefined) out[field] = text(q[field], 6000, field);
    if (q.type === 'essay' && !out.rubric) fail(`Question ${index + 1}: add the essay rubric.`);
    return out;
  });
  return { version: randomUUID(), passageAccess: input.passageAccess, questions };
}
function answersFor(quiz, input, submitting) {
  if (!Array.isArray(input) || input.length > quiz.questions.length) fail('Invalid responses.');
  const seen = new Set();
  const answers = input.map(item => {
    const q = quiz.questions.find(q => q.id === item?.questionId);
    if (!q || seen.has(q.id)) fail('Unknown or duplicate question response.');
    seen.add(q.id);
    let answer = item.answer;
    if (['short-answer', 'essay'].includes(q.type)) answer = text(answer, 20000, 'response', submitting);
    else if (q.type === 'checkboxes') {
      if (!Array.isArray(answer) || new Set(answer).size !== answer.length || !answer.every(i => Number.isSafeInteger(i) && i >= 0 && i < q.choices.length) || (submitting && !answer.length)) fail('Invalid checkbox response.');
      answer = [...answer].sort((a, b) => a - b);
    } else if (!Number.isSafeInteger(answer) || answer < 0 || answer >= q.choices.length) fail('Invalid selected answer.');
    return { questionId: q.id, answer };
  });
  if (submitting && seen.size !== quiz.questions.length) fail('Answer every question before submitting.');
  return answers;
}
function grade(quiz, answers, manual = []) {
  const grades = quiz.questions.map(q => {
    const response = answers.find(a => a.questionId === q.id);
    if (['short-answer', 'essay'].includes(q.type)) return manual.find(g => g.questionId === q.id) || { questionId: q.id, correct: null, awardedPoints: null };
    const correct = JSON.stringify(response?.answer) === JSON.stringify(q.correctAnswer);
    return { questionId: q.id, correct, awardedPoints: correct ? q.points : 0 };
  });
  const pending = grades.filter(g => g.correct === null).length;
  const correctAnswers = grades.filter(g => g.correct === true).length;
  return { grades, result: { status: pending ? 'pending-review' : 'graded', correctAnswers,
    totalQuestions: quiz.questions.length, pendingQuestions: pending,
    percentage: pending ? null : correctAnswers / quiz.questions.length * 100,
    earnedPoints: grades.reduce((sum, g) => sum + (g.awardedPoints || 0), 0), maxPoints: quiz.questions.reduce((sum, q) => sum + q.points, 0) } };
}
function publicQuiz(quiz) {
  return { version: quiz.version, passageAccess: quiz.passageAccess, questions: quiz.questions.map(({ id, type, question, choices, points }) => ({ id, type, question, choices, points })) };
}
function publicAttempt(attempt, teacher = false) {
  const raw = attempt.toObject ? attempt.toObject() : attempt;
  const quiz = teacher ? raw.quiz : publicQuiz(raw.quiz);
  const passageAllowed = teacher || raw.quiz.passageAccess === 'during-quiz' || raw.status !== 'draft';
  return { _id: raw._id, title: raw.title, classwork: raw.classwork, learner: raw.learner, readingSubmission: raw.readingSubmission,
    assessmentType: raw.assessmentType || 'passage', attemptLabel: raw.assessmentType === 'standalone' ? 'Standalone classroom quiz' : raw.readingSubmission ? 'Linked reading attempt' : 'Comprehension-only attempt', revision: raw.revision, status: raw.status,
    quiz, passage: passageAllowed ? raw.passage : undefined, answers: raw.answers, grades: raw.grades,
    result: raw.result, submittedAt: raw.submittedAt, reviewedAt: raw.reviewedAt };
}
module.exports = { fail, passageHash, validateQuiz, answersFor, grade, publicQuiz, publicAttempt };
