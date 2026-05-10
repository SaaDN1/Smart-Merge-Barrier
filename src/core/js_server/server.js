const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { getCameraData, updateCarCount } = require("../../database/db");

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));

const PYTHON_AI_URL = process.env.PYTHON_AI_URL || "http://127.0.0.1:8000/";
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN || "http://localhost:5173";

// CONFIG
// Barrier closes immediately if total cars exceed 15.
const CAR_CLOSE_THRESHOLD = Number(process.env.CAR_CLOSE_THRESHOLD || 15);
// Weighted traffic lets heavy vehicles influence closure decisions.
const WEIGHTED_CLOSE_THRESHOLD = Number(process.env.WEIGHTED_CLOSE_THRESHOLD || 18);
const FLOW_GOOD_MIN_PER_MIN = Number(process.env.FLOW_GOOD_MIN_PER_MIN || 2);

const VEHICLE_CLASSES = new Set(["car", "bus", "truck", "motorcycle"]);
const TRACKER_MAX_DISTANCE = Number(process.env.TRACKER_MAX_DISTANCE || 80);
const TRACK_TTL_MS = Number(process.env.TRACK_TTL_MS || 2200);
const FLOW_WINDOW_MS = Number(process.env.FLOW_WINDOW_MS || 60000);
const MOTION_WINDOW_MS = Number(process.env.MOTION_WINDOW_MS || 10000);
const FLOW_LINE_RATIO = Number(process.env.FLOW_LINE_RATIO || 0.58);
const MOTION_CONGESTED_THRESHOLD = Number(process.env.MOTION_CONGESTED_THRESHOLD || 0.02);
const MOTION_QUICK_THRESHOLD = Number(process.env.MOTION_QUICK_THRESHOLD || 0.06);
const CONGESTED_FLOW_MAX_PER_MIN = Number(process.env.CONGESTED_FLOW_MAX_PER_MIN || 2);
const DENSE_TRAFFIC_TRACKS_MIN = Number(process.env.DENSE_TRAFFIC_TRACKS_MIN || 8);
const CRAWL_SPEED_MAX = Number(process.env.CRAWL_SPEED_MAX || 0.035);

const DEFAULT_CAMERA_STREAMS = [
  "/videos/5927708-hd_1080_1920_30fps.mp4",
  "/videos/low-traffic-street.mp4"
];

// BARRIER STATE (in-memory)
// overrideMode: false => automatic mode
// overrideMode: true  => use overrideState instead of auto logic
let overrideMode = false;
let overrideState = null;

let latestTrafficSnapshot = {
  cars: 0,
  buses: 0,
  trucks: 0,
  motorcycles: 0,
  weightedTraffic: 0,
  totalVehicles: 0,
  flowRate: 0,
  motionStatus: "Insufficient Data",
  avgSpeedNorm: 0,
  updatedAt: null
};

const cameraMotionState = new Map();

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCameraRows() {
  const rows = Array.isArray(getCameraData()) ? getCameraData() : [];

  return rows.map((cam, index) => {
    const cameraID = cam.cameraID || cam.id || `Camera ${index + 1}`;
    const mergeID = cam.mergeID || cam.mergeId || `Merge ${index + 1}`;
    const streamPath = cam.streamUrl || cam.streamURL || DEFAULT_CAMERA_STREAMS[index] || DEFAULT_CAMERA_STREAMS[0];
    const hasAbsoluteUrl = typeof streamPath === "string" && /^https?:\/\//i.test(streamPath);
    const streamUrl = hasAbsoluteUrl ? streamPath : `${DASHBOARD_ORIGIN}${streamPath}`;
    return {
      ...cam,
      cameraID,
      mergeID,
      streamPath,
      streamUrl,
      trafficLevel: cam.trafficLevel || (index === 0 ? "High" : "Low"),
      carCount: toNumber(cam.carCount)
    };
  });
}

function computeWeightedTraffic(snapshot) {
  return snapshot.cars + snapshot.buses * 1.5 + snapshot.trucks * 1.5 + snapshot.motorcycles * 0.5;
}

function classifyTrafficLevel(totalVehicles) {
  if (totalVehicles > 20) return "Heavy";
  if (totalVehicles > 10) return "Moderate";
  return "Light";
}

function classifyMotion(avgSpeedNorm, trackedVehicles, flowRate) {
  if (trackedVehicles < 2) return "Insufficient Data";

  const nearStandstill = avgSpeedNorm <= MOTION_CONGESTED_THRESHOLD;
  const denseSlowCrawl = trackedVehicles >= DENSE_TRAFFIC_TRACKS_MIN
    && flowRate <= CONGESTED_FLOW_MAX_PER_MIN
    && avgSpeedNorm <= CRAWL_SPEED_MAX;

  if (nearStandstill || denseSlowCrawl) return "Congested";
  if (avgSpeedNorm >= MOTION_QUICK_THRESHOLD && flowRate > CONGESTED_FLOW_MAX_PER_MIN) return "Quick Flow";
  return "Steady Flow";
}

function getOrCreateCameraMotionState(cameraKey) {
  if (!cameraMotionState.has(cameraKey)) {
    cameraMotionState.set(cameraKey, {
      nextId: 1,
      tracks: new Map(),
      speedSamples: [],
      flowEvents: []
    });
  }

  return cameraMotionState.get(cameraKey);
}

function updateMotionMetrics(cameraKey, detections, frameHeight, now) {
  const state = getOrCreateCameraMotionState(cameraKey);
  const lineY = Math.max(1, frameHeight) * FLOW_LINE_RATIO;
  const usedTrackIds = new Set();

  for (const [trackId, track] of state.tracks) {
    if (now - track.lastSeenAt > TRACK_TTL_MS) {
      state.tracks.delete(trackId);
    }
  }

  const vehicleDetections = detections.filter((det) => (
    VEHICLE_CLASSES.has(det.class) && Array.isArray(det?.bbox) && det.bbox.length === 4
  ));

  vehicleDetections.forEach((det) => {
    const [x1, y1, x2, y2] = det.bbox;
    const centroid = {
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2
    };

    let bestTrackId = null;
    let bestDistance = Infinity;

    for (const [trackId, track] of state.tracks) {
      if (usedTrackIds.has(trackId)) continue;

      const distance = Math.hypot(centroid.x - track.x, centroid.y - track.y);
      if (distance < TRACKER_MAX_DISTANCE && distance < bestDistance) {
        bestDistance = distance;
        bestTrackId = trackId;
      }
    }

    const nextSide = centroid.y >= lineY ? "below" : "above";

    if (bestTrackId === null) {
      const newTrackId = state.nextId;
      state.nextId += 1;
      state.tracks.set(newTrackId, {
        x: centroid.x,
        y: centroid.y,
        side: nextSide,
        lastSeenAt: now
      });
      usedTrackIds.add(newTrackId);
      return;
    }

    const existing = state.tracks.get(bestTrackId);
    if (existing) {
      const dtSec = Math.max((now - existing.lastSeenAt) / 1000, 0.001);
      const distancePx = Math.hypot(centroid.x - existing.x, centroid.y - existing.y);
      const speedNorm = (distancePx / dtSec) / Math.max(frameHeight, 1);
      state.speedSamples.push({ ts: now, speedNorm });
    }

    if (existing && existing.side === "above" && nextSide === "below") {
      state.flowEvents.push(now);
    }

    state.tracks.set(bestTrackId, {
      x: centroid.x,
      y: centroid.y,
      side: nextSide,
      lastSeenAt: now
    });
    usedTrackIds.add(bestTrackId);
  });

  state.flowEvents = state.flowEvents.filter((eventTs) => now - eventTs <= FLOW_WINDOW_MS);
  state.speedSamples = state.speedSamples.filter((sample) => now - sample.ts <= MOTION_WINDOW_MS);

  const flowRate = state.flowEvents.length;
  const avgSpeedNorm = state.speedSamples.length > 0
    ? state.speedSamples.reduce((sum, sample) => sum + sample.speedNorm, 0) / state.speedSamples.length
    : 0;
  const motionStatus = classifyMotion(avgSpeedNorm, vehicleDetections.length, flowRate);

  return {
    flowRate,
    avgSpeedNorm,
    motionStatus
  };
}

// Compute barrier status based on traffic + override
function computeBarrierStatus() {
  const data = normalizeCameraRows();
  const totalCars = data.reduce(
    (sum, cam) => sum + (Number(cam.carCount) || 0),
    0
  );
  const weightedTraffic = latestTrafficSnapshot.weightedTraffic || totalCars;

  let state;
  let mode;
  let reason;

  if (overrideMode && (overrideState === "OPEN" || overrideState === "CLOSED")) {
    // Manual override takes priority
    state = overrideState;
    mode = "MANUAL";
    reason = "Manual override from dashboard";
  } else {
    const motionStatus = latestTrafficSnapshot.motionStatus;
    const flowRate = Number(latestTrafficSnapshot.flowRate) || 0;
    const notCongested = motionStatus !== "Congested";
    const hasGoodFlow = motionStatus === "Quick Flow" || flowRate >= FLOW_GOOD_MIN_PER_MIN;

    if (notCongested && hasGoodFlow) {
      state = "OPEN";
      mode = "AUTO";
      reason = "Good flow and no congestion";

      // Arduino open
      console.log("open")
      let req = fetch("http://10.10.10.10/O") // Arduino server IP

    } else {
      // Automatic mode fallback: close on congestion or high load.
      const shouldClose = motionStatus === "Congested"
        || totalCars > CAR_CLOSE_THRESHOLD
        || weightedTraffic > WEIGHTED_CLOSE_THRESHOLD;
      state = shouldClose ? "CLOSED" : "OPEN";
      mode = "AUTO";
      if (motionStatus === "Congested") {
        reason = "Congested traffic detected";
      } else if (totalCars > CAR_CLOSE_THRESHOLD) {
        reason = "Cars above threshold";
      } else if (weightedTraffic > WEIGHTED_CLOSE_THRESHOLD) {
        reason = "Weighted traffic above threshold";
      } else {
        reason = "Traffic below threshold";
      }

      // Arduino close
      if (state == "CLOSED") {
        console.log("close")
        let req = fetch("http://10.10.10.10/C") // Arduino server IP
      }
    }
  }

  return {
    state,              // "OPEN" or "CLOSED"
    mode,               // "AUTO" or "MANUAL"
    totalCars,
    thresholds: {
      cars: CAR_CLOSE_THRESHOLD,
      weighted: WEIGHTED_CLOSE_THRESHOLD,
      minFlowForOpen: FLOW_GOOD_MIN_PER_MIN
    },
    weightedTraffic,
    latestTrafficSnapshot,
    overrideMode,
    overrideState,
    reason,
    timestamp: new Date().toISOString()
  };
}

async function runRealAIDetection(payload) {
  const response = await axios.post(
    PYTHON_AI_URL,
    payload,
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
  const data = normalizeCameraRows();
  const barrier = computeBarrierStatus();

  const payload = data.map((cam, index) => {
    const isPrimaryCamera = index === 0;
    const cars = isPrimaryCamera ? latestTrafficSnapshot.cars : cam.carCount;
    const heavy = isPrimaryCamera ? latestTrafficSnapshot.buses + latestTrafficSnapshot.trucks : 0;
    const motorcycles = isPrimaryCamera ? latestTrafficSnapshot.motorcycles : 0;
    const totalVehicles = isPrimaryCamera
      ? latestTrafficSnapshot.totalVehicles
      : cars + heavy + motorcycles;
    const weightedTraffic = cars + heavy * 1.5 + motorcycles * 0.5;

    return {
      cameraID: cam.cameraID,
      mergeID: cam.mergeID,
      carCount: cars,
      heavy,
      motorcycles,
      vehicles: totalVehicles,
      weightedTraffic,
      flowRate: latestTrafficSnapshot.flowRate,
      motionStatus: latestTrafficSnapshot.motionStatus,
      trafficStatus: classifyTrafficLevel(totalVehicles),
      mergeDecision: barrier.state,
      streamUrl: cam.streamUrl,
      streamPath: cam.streamPath
    };
  });

  res.json(payload);
});

app.get("/api/cameras", (req, res) => {
  const data = normalizeCameraRows().map((cam, index) => ({
    id: cam.cameraID,
    label: cam.cameraID,
    mergeID: cam.mergeID,
    trafficLevel: cam.trafficLevel,
    src: cam.streamPath || DEFAULT_CAMERA_STREAMS[index] || DEFAULT_CAMERA_STREAMS[0]
  }));

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
    const { data, imageData, width, height, cameraId } = req.body;

    const hasRawPixels = Array.isArray(data) && Number.isInteger(width) && Number.isInteger(height);
    const hasEncodedImage = typeof imageData === "string" && imageData.length > 0;

    if (!hasRawPixels && !hasEncodedImage) {
      return res.status(400).json({
        error: "Request body must include either imageData (base64 JPEG) or data+width+height"
      });
    }

    const aiPayload = hasEncodedImage
      ? { imageData }
      : { data, width, height };

    const aiResult = await runRealAIDetection(aiPayload);
    const detections = Array.isArray(aiResult?.detections) ? aiResult.detections : [];
    const carCount = detections.filter(item => item.class === "car").length;
    const busCount = detections.filter(item => item.class === "bus").length;
    const truckCount = detections.filter(item => item.class === "truck").length;
    const motorcycleCount = detections.filter(item => item.class === "motorcycle").length;
    const totalVehicles = carCount + busCount + truckCount + motorcycleCount;
    const now = Date.now();
    const cameraKey = typeof cameraId === "string" && cameraId.trim() ? cameraId.trim() : "camera-main";
    const motion = updateMotionMetrics(cameraKey, detections, Number(height) || 1, now);

    latestTrafficSnapshot = {
      cars: carCount,
      buses: busCount,
      trucks: truckCount,
      motorcycles: motorcycleCount,
      weightedTraffic: carCount + (busCount + truckCount) * 1.5 + motorcycleCount * 0.5,
      totalVehicles,
      flowRate: motion.flowRate,
      motionStatus: motion.motionStatus,
      avgSpeedNorm: Number(motion.avgSpeedNorm.toFixed(4)),
      updatedAt: new Date().toISOString()
    };

    const cameras = normalizeCameraRows();
    if (cameras.length > 0) {
      const selectedCamera = cameras.find((cam) => cam.cameraID === cameraId) || cameras[0];
      updateCarCount(selectedCamera.cameraID, carCount);
    }

    res.json({
      detections,
      carCount,
      vehicleSummary: latestTrafficSnapshot,
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