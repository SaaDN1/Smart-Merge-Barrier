const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getCameraData, updateCarCount } = require("../../database/db");

const app = express();
app.use(cors());
app.use(express.json({ limit: "100mb" }));

const PYTHON_AI_URL = process.env.PYTHON_AI_URL || "http://127.0.0.1:8000/";
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN || "http://localhost:5173";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "smartmerge2026";
const DEFAULT_OPERATOR_NAME = process.env.DEFAULT_OPERATOR_NAME || "Traffic Operator";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const OVERRIDE_LOG_LIMIT = Number(process.env.OVERRIDE_LOG_LIMIT || 200);
const OVERRIDE_LOG_FILE = path.resolve(
  process.env.OVERRIDE_LOG_FILE || path.join(__dirname, "logs", "barrier-overrides.jsonl")
);

const authSessions = new Map();

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
const MOTION_RECENT_WINDOW_MS = Number(process.env.MOTION_RECENT_WINDOW_MS || 3000);
const FLOW_LINE_RATIO = Number(process.env.FLOW_LINE_RATIO || 0.58);
const MOTION_CONGESTED_THRESHOLD = Number(process.env.MOTION_CONGESTED_THRESHOLD || 0.02);
const MOTION_QUICK_THRESHOLD = Number(process.env.MOTION_QUICK_THRESHOLD || 0.06);
const CONGESTED_FLOW_MAX_PER_MIN = Number(process.env.CONGESTED_FLOW_MAX_PER_MIN || 2);
const DENSE_TRAFFIC_TRACKS_MIN = Number(process.env.DENSE_TRAFFIC_TRACKS_MIN || 8);
const CRAWL_SPEED_MAX = Number(process.env.CRAWL_SPEED_MAX || 0.035);

const DEFAULT_CAMERA_STREAMS = (Array.isArray(getCameraData()) ? getCameraData() : [])
  .map((cam) => cam.streamUrl || cam.streamURL)
  .filter(Boolean);

// BARRIER STATE (in-memory)
// overrideMode: false => automatic mode
// overrideMode: true  => use overrideState instead of auto logic
let overrideMode = false;
let overrideState = null;
let overrideAuditLog = [];

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

function safeCompare(value, expected) {
  const valueBuffer = Buffer.from(String(value || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}

function normalizeOperatorName(value) {
  const operator = typeof value === "string" ? value.trim() : "";
  return operator.slice(0, 80) || DEFAULT_OPERATOR_NAME;
}

function pruneExpiredSessions(now = Date.now()) {
  for (const [token, session] of authSessions) {
    if (session.expiresAtMs <= now) {
      authSessions.delete(token);
    }
  }
}

function createAuthSession(operator) {
  pruneExpiredSessions();

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAtMs = Date.now() + SESSION_TTL_MS;
  const session = {
    operator,
    createdAt: new Date().toISOString(),
    expiresAtMs
  };

  authSessions.set(token, session);

  return {
    token,
    user: { name: operator },
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

function getBearerToken(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function requireApiAuth(req, res, next) {
  if (req.method === "OPTIONS") {
    return next();
  }

  const token = getBearerToken(req);
  const session = authSessions.get(token);

  if (!token || !session) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (session.expiresAtMs <= Date.now()) {
    authSessions.delete(token);
    return res.status(401).json({ error: "Session expired" });
  }

  req.auth = {
    token,
    operator: session.operator,
    expiresAt: new Date(session.expiresAtMs).toISOString()
  };
  return next();
}

function loadOverrideAuditLog() {
  if (!fs.existsSync(OVERRIDE_LOG_FILE)) {
    return [];
  }

  try {
    const lines = fs.readFileSync(OVERRIDE_LOG_FILE, "utf8")
      .split(/\r?\n/)
      .filter(Boolean);

    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          console.warn("Skipping malformed override audit log entry:", err?.message || err);
          return null;
        }
      })
      .filter(Boolean)
      .slice(-OVERRIDE_LOG_LIMIT);
  } catch (err) {
    console.error("Unable to load override audit log:", err?.message || err);
    return [];
  }
}

function createAuditId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function appendOverrideAuditLog(entry) {
  fs.mkdirSync(path.dirname(OVERRIDE_LOG_FILE), { recursive: true });
  fs.appendFileSync(OVERRIDE_LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");

  overrideAuditLog = [...overrideAuditLog, entry].slice(-OVERRIDE_LOG_LIMIT);
}

function summarizeBarrierStatus(status) {
  return {
    state: status.state,
    mode: status.mode,
    overrideMode: status.overrideMode,
    overrideState: status.overrideState,
    reason: status.reason
  };
}

function buildOverrideAuditEntry(req, requested, previousStatus, nextStatus) {
  return {
    id: createAuditId(),
    timestamp: new Date().toISOString(),
    operator: req.auth?.operator || DEFAULT_OPERATOR_NAME,
    action: requested.mode === "auto" ? "SET_AUTO" : `FORCE_${requested.state}`,
    requested: {
      mode: requested.mode,
      state: requested.state || null
    },
    previous: summarizeBarrierStatus(previousStatus),
    next: summarizeBarrierStatus(nextStatus),
    context: {
      totalCars: nextStatus.totalCars,
      weightedTraffic: nextStatus.weightedTraffic,
      motionStatus: nextStatus.latestTrafficSnapshot?.motionStatus || null,
      flowRate: nextStatus.latestTrafficSnapshot?.flowRate || 0
    },
    client: {
      ip: req.ip,
      userAgent: req.get("user-agent") || ""
    }
  };
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

function classifyMotion(avgSpeedNorm, trackedVehicles, flowRate, recentAvgSpeedNorm = avgSpeedNorm) {
  if (trackedVehicles < 2) return "Insufficient Data";

  const nearStandstill = avgSpeedNorm <= MOTION_CONGESTED_THRESHOLD;
  const recentNearStandstill = recentAvgSpeedNorm <= (MOTION_CONGESTED_THRESHOLD + 0.01);
  const stalledFlow = trackedVehicles >= 3
    && flowRate <= 1
    && recentAvgSpeedNorm <= 0.045;
  const denseSlowCrawl = trackedVehicles >= DENSE_TRAFFIC_TRACKS_MIN
    && flowRate <= CONGESTED_FLOW_MAX_PER_MIN
    && recentAvgSpeedNorm <= CRAWL_SPEED_MAX;

  if (nearStandstill || recentNearStandstill || stalledFlow || denseSlowCrawl) return "Congested";
  if (
    avgSpeedNorm >= MOTION_QUICK_THRESHOLD
    && recentAvgSpeedNorm >= MOTION_QUICK_THRESHOLD * 0.85
    && flowRate > CONGESTED_FLOW_MAX_PER_MIN
  ) return "Quick Flow";
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
  const recentSpeedSamples = state.speedSamples.filter((sample) => now - sample.ts <= MOTION_RECENT_WINDOW_MS);

  const flowRate = state.flowEvents.length;
  const avgSpeedNorm = state.speedSamples.length > 0
    ? state.speedSamples.reduce((sum, sample) => sum + sample.speedNorm, 0) / state.speedSamples.length
    : 0;
  const recentAvgSpeedNorm = recentSpeedSamples.length > 0
    ? recentSpeedSamples.reduce((sum, sample) => sum + sample.speedNorm, 0) / recentSpeedSamples.length
    : avgSpeedNorm;
  const motionStatus = classifyMotion(avgSpeedNorm, vehicleDetections.length, flowRate, recentAvgSpeedNorm);

  return {
    flowRate,
    avgSpeedNorm,
    recentAvgSpeedNorm,
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

overrideAuditLog = loadOverrideAuditLog();

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "smart-merge-barrier-core" });
});

app.post("/api/auth/login", (req, res) => {
  const { password, operator } = req.body || {};

  if (!safeCompare(password, ADMIN_PASSWORD)) {
    console.warn("Rejected dashboard login attempt");
    return res.status(401).json({ error: "Invalid password" });
  }

  const session = createAuthSession(normalizeOperatorName(operator));
  res.json({
    message: "Authenticated",
    ...session
  });
});

app.use("/api", requireApiAuth);

app.get("/api/auth/me", (req, res) => {
  res.json({
    user: { name: req.auth.operator },
    expiresAt: req.auth.expiresAt
  });
});

app.post("/api/auth/logout", (req, res) => {
  authSessions.delete(req.auth.token);
  res.json({ message: "Logged out" });
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
    id: cam.id || cam.cameraID,
    label: cam.label || cam.cameraID,
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
      recentAvgSpeedNorm: Number(motion.recentAvgSpeedNorm.toFixed(4)),
      updatedAt: new Date().toISOString()
    };

    const cameras = normalizeCameraRows();
    if (cameras.length > 0) {
      const selectedCamera = cameras.find((cam) => cam.id === cameraId || cam.cameraID === cameraId) || cameras[0];
      updateCarCount(selectedCamera.cameraID, carCount);
    }

    res.json({
      detections,
      carCount,
      vehicleSummary: latestTrafficSnapshot,
      barrier: computeBarrierStatus(),
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

app.get("/api/barrier/override-log", (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 25, OVERRIDE_LOG_LIMIT));
  res.json({
    entries: overrideAuditLog.slice(-limit).reverse(),
    total: overrideAuditLog.length,
    logFile: OVERRIDE_LOG_FILE
  });
});

// Set manual override or switch back to auto
app.post("/api/barrier/override", (req, res) => {
  const { mode, state } = req.body || {};
  const previousOverrideMode = overrideMode;
  const previousOverrideState = overrideState;
  const previousStatus = computeBarrierStatus();
  let nextOverrideMode;
  let nextOverrideState;

  if (mode === "auto") {
    nextOverrideMode = false;
    nextOverrideState = null;
  } else if (mode === "manual") {
    if (state !== "OPEN" && state !== "CLOSED") {
      return res.status(400).json({ error: "state must be OPEN or CLOSED in manual mode" });
    }
    nextOverrideMode = true;
    nextOverrideState = state;
  } else {
    return res.status(400).json({ error: "mode must be 'auto' or 'manual'" });
  }

  overrideMode = nextOverrideMode;
  overrideState = nextOverrideState;
  const status = computeBarrierStatus();
  const auditEntry = buildOverrideAuditEntry(req, { mode, state }, previousStatus, status);

  try {
    appendOverrideAuditLog(auditEntry);
  } catch (err) {
    overrideMode = previousOverrideMode;
    overrideState = previousOverrideState;
    console.error("Failed to write override audit log:", err?.message || err);
    return res.status(500).json({
      error: "Barrier override was not applied because audit logging failed"
    });
  }

  res.json({
    message: "Barrier mode updated",
    barrier: status,
    audit: auditEntry
  });
});

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
  console.log(`Core backend running on http://localhost:${PORT}`);
});
