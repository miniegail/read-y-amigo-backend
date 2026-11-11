const { identity, buildHistory } = require('./readingProgress');
const valid = (value, percent) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!percent || value <= 100);
const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;
function metricsFor(records) {
  const metrics = {};
  for (const key of ['speed', 'accuracy', 'comprehension']) {
    const byLearner = new Map();
    for (const row of records) if (valid(row[key]?.value, key !== 'speed') && row[key]?.status !== 'pending-review') byLearner.set(row.learnerId, row[key]);
    const results = [...byLearner.values()];
    metrics[key] = { value: average(results.map(metric => metric.value)), learnerCount: results.length, provisionalCount: results.filter(metric => metric.status === 'provisional').length };
  }
  return metrics;
}
function reportProjection(classes, enrollments, submissions, attempts, works, { from = -Infinity, to = Infinity } = {}) {
  const enrolled = new Set(enrollments.map(row => `${identity(row.class)}:${identity(row.learner)}`));
  const readings = new Map(), quizzes = new Map();
  const put = (map, row) => { const key = `${identity(row.class)}:${identity(row.learner)}`; if (!enrolled.has(key)) return; if (!map.has(key)) map.set(key, []); map.get(key).push(row); };
  submissions.forEach(row => put(readings, row)); attempts.forEach(row => put(quizzes, row));
  const records = [];
  for (const pair of enrolled) {
    const [classId, learnerId] = pair.split(':');
    for (const row of buildHistory(readings.get(pair) || [], quizzes.get(pair) || [], works)) {
      const timestamp = new Date(row.submittedAt).getTime();
      if (timestamp >= from && timestamp < to) records.push({ ...row, classId, learnerId });
    }
  }
  records.sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt) || a.id.localeCompare(b.id));
  const metrics = metricsFor(records);
  const latestComprehension = new Map();
  for (const row of records) if (valid(row.comprehension.value, true)) latestComprehension.set(row.learnerId, row.comprehension.value);
  const levels = { Independent: 0, Instructional: 0, Frustration: 0 };
  for (const score of latestComprehension.values()) levels[score >= 80 ? 'Independent' : score >= 59 ? 'Instructional' : 'Frustration']++;
  const byClass = classes.map(cls => {
    const classId = identity(cls), rows = records.filter(row => row.classId === classId);
    return { _id: classId, title: cls.title, code: cls.code,
      learnerCount: new Set(enrollments.filter(enrollment => identity(enrollment.class) === classId).map(enrollment => identity(enrollment.learner))).size,
      withSubmissions: new Set(rows.map(row => row.learnerId)).size, metrics: metricsFor(rows) };
  });
  // One snapshot per submission day. Each learner contributes their latest
  // available metric in this period, irrespective of their submission count.
  const daily = new Map();
  const running = Object.fromEntries(['speed', 'accuracy', 'comprehension'].map(key => [key, { byLearner: new Map(), sum: 0, provisional: 0 }]));
  for (const row of records) {
    for (const key of ['speed', 'accuracy', 'comprehension']) {
      const metric = row[key], state = running[key];
      if (!valid(metric?.value, key !== 'speed') || metric.status === 'pending-review') continue;
      const old = state.byLearner.get(row.learnerId);
      if (old) { state.sum -= old.value; if (old.status === 'provisional') state.provisional--; }
      state.byLearner.set(row.learnerId, metric); state.sum += metric.value;
      if (metric.status === 'provisional') state.provisional++;
    }
    const day = new Date(row.submittedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const snapshot = Object.fromEntries(Object.entries(running).map(([key, state]) => [key, {
      value: state.byLearner.size ? Math.round(state.sum / state.byLearner.size * 10) / 10 : null,
      learnerCount: state.byLearner.size, provisionalCount: state.provisional,
    }]));
    daily.set(day, { date: day, metrics: snapshot });
  }
  return { totals: { classCount: classes.length, totalLearners: new Set(enrollments.map(row => identity(row.learner))).size,
    withSubmissions: new Set(records.map(row => row.learnerId)).size, metrics,
    avgComprehension: metrics.comprehension.value }, classes: byClass, levels, trend: [...daily.values()] };
}
module.exports = { reportProjection };
