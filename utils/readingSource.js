const MAX_READING_TEXT = 100000;

function parseReadingSource(body, hasFile) {
  if (body.type !== "reading") return {};
  // Legacy clients omit readingSource; existing file assignments keep working.
  const source = body.readingSource ?? "file";
  if (!["file", "text"].includes(source)) throw new Error("Reading source must be file or text.");
  if (source === "text") {
    if (typeof body.readingText !== "string" || !body.readingText.trim()) throw new Error("Enter a reading passage.");
    const text = body.readingText.replace(/\r\n?/g, "\n").trim();
    if (text.length > MAX_READING_TEXT) throw new Error("Reading passage cannot exceed 100,000 characters.");
    if (hasFile || body.material) throw new Error("Choose either a text passage or a file, not both.");
    return { readingSource: "text", readingText: text };
  }
  if (typeof body.readingText === "string" && body.readingText.trim()) throw new Error("File assignments cannot include a text passage.");
  if (body.readingSource && !hasFile && !body.material) throw new Error("Attach a reading file.");
  return { readingSource: "file", readingText: "" };
}

module.exports = { parseReadingSource, MAX_READING_TEXT };
