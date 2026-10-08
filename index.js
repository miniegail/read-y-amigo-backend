require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const connectDB = require("./db");
const authRoutes = require("./routes/auth");
const { teacherRouter, learnerRouter } = require("./routes/classes");
const commentsRoutes = require("./routes/comments");
const enrollmentsRoutes = require("./routes/enrollments");
const reportsRoutes = require("./routes/reports");

const app = express();

app.use(cors());
app.use(express.json());

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/classes", teacherRouter);
app.use("/api/learner/classes", learnerRouter);
app.use("/api/enrollments", enrollmentsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/comments", commentsRoutes);

app.get("/", (req, res) => {
  res.json({ status: "READ-Y AMIGO server is running" });
});

// Returns multer errors (file too large, unsupported type) as JSON
// so the app can show the message instead of an HTML error page.
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "File is too large. Maximum size is 10 MB." });
  }
  res.status(400).json({ error: err.message || "Something went wrong." });
});

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });