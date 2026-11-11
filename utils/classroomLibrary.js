function sourceFiles(works) {
  return works.filter(work => work.type === 'reading' && work.readingSource !== 'text').flatMap(work => {
    const file = work.attachment?.url ? work.attachment : work.material?.fileUrl ? { name: work.material.title, url: work.material.fileUrl, uploadedAt: work.material.createdAt } : null;
    if (!file) return [];
    const fileId = file.fileId ? String(file.fileId) : file.url.match(/\/api\/files\/([a-f\d]{24})$/i)?.[1];
    return [{ key: fileId || file.url, fileId, classworkId: String(work._id), activityTitle: work.title, name: file.name || work.title, url: file.url, mimeType: file.mimeType, size: file.size, uploadedAt: file.uploadedAt || work.createdAt }];
  });
}
function libraryEntries(files, uploadDates = new Map()) {
  const unique = new Map();
  for (const file of files) {
    const uploadedAt = uploadDates.get(file.fileId) || file.uploadedAt;
    const previous = unique.get(file.key);
    if (previous) {
      previous.activities.push({ _id: file.classworkId, title: file.activityTitle });
      if (!uploadDates.has(file.fileId) && Date.parse(uploadedAt) < Date.parse(previous.uploadedAt)) previous.uploadedAt = uploadedAt;
    }
    else unique.set(file.key, { ...file, uploadedAt, activities: [{ _id: file.classworkId, title: file.activityTitle }] });
  }
  return [...unique.values()].sort((a, b) => (Date.parse(b.uploadedAt) || 0) - (Date.parse(a.uploadedAt) || 0) || a.name.localeCompare(b.name));
}
async function classroomLibrary(classId, learnerId) {
  const Work = require('../models/ClassWork'), mongoose = require('mongoose');
  const filter = { class: classId, type: 'reading' };
  if (learnerId) filter.$or = [{ assignToAll: true }, { assignedTo: learnerId }];
  const works = await Work.find(filter).select('title type readingSource attachment material createdAt').populate('material', 'title fileUrl createdAt');
  const files = sourceFiles(works), ids = [...new Set(files.map(file => file.fileId).filter(id => id && mongoose.isValidObjectId(id)))];
  const dates = new Map();
  if (ids.length) {
    const metadata = await mongoose.connection.db.collection('uploads.files').find({ _id: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) } }).project({ uploadDate: 1 }).toArray();
    metadata.forEach(file => dates.set(String(file._id), file.uploadDate));
  }
  return libraryEntries(files, dates);
}
module.exports = { sourceFiles, libraryEntries, classroomLibrary };
