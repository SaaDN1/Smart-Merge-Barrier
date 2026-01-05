const express = require("express");
const cors = require("cors");
const { getCameraData } = require("../../mock/fake_db");
const { runFakeAIDetection } = require("../../mock/fake_ai");

const app = express();
app.use(cors());
app.use(express.json());

// CONFIG
// If total cars > TRAFFIC_THRESHOLD -> barrier closes automatically
const TRAFFIC_THRESHOLD = 50;

// BARRIER STATE (in-memory)
// overrideMode: false => automatic mode
// overrideMode: true  => use overrideState instead of auto logic
let overrideMode = false;
let overrideState = null;

// Compute barrier status based on traffic + override
function computeBarrierStatus() {
  const data = getCameraData();
  const totalCars = data.reduce(
    (sum, cam) => sum + (Number(cam.carCount) || 0),
    0
  );

  let state;
  let mode;
  let reason;

  if (overrideMode && (overrideState === "OPEN" || overrideState === "CLOSED")) {
    // Manual override takes priority
    state = overrideState;
    mode = "MANUAL";
    reason = "Manual override from dashboard";
  } else {
    // Automatic mode: decide based on total cars
    state = totalCars > TRAFFIC_THRESHOLD ? "CLOSED" : "OPEN";
    mode = "AUTO";
    reason =
      totalCars > TRAFFIC_THRESHOLD
        ? "Traffic above threshold"
        : "Traffic below threshold";
  }

  return {
    state,              // "OPEN" or "CLOSED"
    mode,               // "AUTO" or "MANUAL"
    totalCars,
    threshold: TRAFFIC_THRESHOLD,
    overrideMode,
    overrideState,
    timestamp: new Date().toISOString()
  };
}

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "smart-merge-barrier-core" });
});

// EXISTING ENDPOINTS
// Main data for dashboard (camera list + counts)
app.get("/api/db", (req, res) => {
  const data = getCameraData();
  res.json(data);
});

app.get("/api/ai", async (req, res) => {
  try {
    const updated = await runFakeAIDetection();
    res.json(updated);
  } catch (err) {
    console.error("Error in /api/ai:", err);
    res.status(500).json({ error: "AI simulation failed" });
  }
});

// Get current barrier status
app.get("/api/barrier", (req, res) => {
  const status = computeBarrierStatus();
  res.json(status);
});

// Set manual override or switch back to auto
app.post("/api/barrier/override", (req, res) => {
  const { mode, state } = req.body;

  if (mode === "auto") {
    overrideMode = false;
    overrideState = null;
  } else if (mode === "manual") {
    if (state !== "OPEN" && state !== "CLOSED") {
      return res.status(400).json({ error: "state must be OPEN or CLOSED in manual mode" });
    }
    overrideMode = true;
    overrideState = state;
  } else {
    return res.status(400).json({ error: "mode must be 'auto' or 'manual'" });
  }

  const status = computeBarrierStatus();
  res.json({
    message: "Barrier mode updated",
    barrier: status
  });
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Core backend running on http://localhost:${PORT}`);
});