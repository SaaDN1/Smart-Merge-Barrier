const express = require("express");
const cors = require("cors");
const { getCameraData } = require("../mock/fake_db");
const { runFakeAIDetection } = require("../mock/fake_ai");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "smart-merge-barrier-core" });
});

app.get("/api/db", (req, res) => {
  const data = getCameraData();
  res.json(data);
});

// Simulate AI updating the counts, then return updated data
app.get("/api/ai", async (req, res) => {
  try {
    const updated = await runFakeAIDetection();
    res.json(updated);
  } catch (err) {
    console.error("Error in /api/ai:", err);
    res.status(500).json({ error: "AI simulation failed" });
  }
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Core backend running on http://localhost:${PORT}`);
});