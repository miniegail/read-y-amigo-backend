function classroomPerson(user, includeAge = true) {
  if (!user) return null;
  const fullName = [user.firstName, user.middleInitial, user.secondName].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()).join(' ') || user.displayName || 'Class member';
  return { _id: String(user._id), displayName: user.displayName || fullName, fullName,
    firstName: user.firstName || '', secondName: user.secondName || '', middleInitial: user.middleInitial || '',
    role: user.role || 'learner', profilePhoto: user.profilePhoto || '',
    ...(includeAge ? { age: Number.isSafeInteger(user.age) && user.age >= 0 ? user.age : null } : {}) };
}
function peopleEnrollments(enrollments) {
  return enrollments.filter(row => row.learner).map(row => ({ _id: row._id, class: row.class, learner: classroomPerson(row.learner),
    streakDays: row.streakDays, comprehensionAvg: row.comprehensionAvg, createdAt: row.createdAt }));
}
module.exports = { classroomPerson, peopleEnrollments };
