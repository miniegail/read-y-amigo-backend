const mongoose = require("mongoose");

function getBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "uploads",
  });
}

// Saves a Buffer into MongoDB (GridFS) and resolves with the new file's _id.
function saveBuffer({ buffer, filename, mimeType, metadata }) {
  return new Promise((resolve, reject) => {
    const stream = getBucket().openUploadStream(filename, {
      contentType: mimeType,
      metadata,
    });
    stream.on("error", reject);
    stream.on("finish", () => resolve(stream.id));
    stream.end(buffer);
  });
}

async function findFile(id) {
  return mongoose.connection.db
    .collection("uploads.files")
    .findOne({ _id: new mongoose.Types.ObjectId(id) });
}

module.exports = { getBucket, saveBuffer, findFile };