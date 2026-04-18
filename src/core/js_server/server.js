const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { getCameraData, updateCarCount } = require("../../mock/fake_db");

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));

const PYTHON_AI_URL = process.env.PYTHON_AI_URL || "http://127.0.0.1:8000/";

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

async function runRealAIDetection(frameData, width, height) {
  const response = await axios.post(
    PYTHON_AI_URL,
    {
      data: frameData,
      width,
      height
    },
    {
      timeout: 30000
    }
  );

  return response.data;
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

app.get("/api/ai/health", async (req, res) => {
  try {
    const aiResponse = await axios.get(PYTHON_AI_URL, { timeout: 5000 });
    res.json({
      status: "ok",
      pythonAi: aiResponse.data
    });
  } catch (err) {
    console.error("Error in /api/ai/health:", err?.message || err);
    res.status(503).json({
      status: "error",
      error: "Python AI server unreachable"
    });
  }
});

app.post("/api/ai", async (req, res) => {
  try {
    const { data, width, height } = req.body;

    if (!Array.isArray(data) || !Number.isInteger(width) || !Number.isInteger(height)) {
      return res.status(400).json({
        error: "Request body must include data (array), width (int), and height (int)"
      });
    }

    const aiResult = await runRealAIDetection(data, width, height);
    const detections = Array.isArray(aiResult?.detections) ? aiResult.detections : [];
    const carCount = detections.filter(item => item.class === "car").length;

    const cameras = getCameraData();
    if (cameras.length > 0) {
      updateCarCount(cameras[0].cameraID, carCount);
    }

    res.json({
      detections,
      carCount,
      source: "python-ai"
    });
  } catch (err) {
    const upstreamError = err?.response?.data;
    console.error("Error in /api/ai:", upstreamError || err?.message || err);
    res.status(502).json({
      error: "Real AI inference failed",
      details: upstreamError || err?.message || "Unknown error"
    });
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