const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
function photoMime(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_PHOTO_BYTES) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}
function readingPreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["small", "standard", "large"].includes(value.textSize)
    || typeof value.followReading !== "boolean") throw new Error("Choose a valid reading size and follow-reading setting.");
  return { textSize: value.textSize, followReading: value.followReading };
}
module.exports = { MAX_PHOTO_BYTES, photoMime, readingPreferences };