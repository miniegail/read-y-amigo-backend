require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./db");
const authRoutes = require("./routes/auth");
const classesRoutes = require("./routes/classes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/classes", classesRoutes);

app.get("/", (req, res) => {
  res.json({ status: "READ-Y AMIGO server is running" });
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