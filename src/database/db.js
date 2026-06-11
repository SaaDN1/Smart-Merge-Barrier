const cameraFeeds = require("../MonitoringDashboard/src/data/cameraFeeds.json");

function ensureUniqueCameraFeeds(feeds) {
  const seenIds = new Set();

  feeds.forEach((feed) => {
    if (seenIds.has(feed.id)) {
      throw new Error(`Duplicate camera id detected: ${feed.id}`);
    }

    seenIds.add(feed.id);
  });
}

ensureUniqueCameraFeeds(cameraFeeds);

const cameraData = cameraFeeds.map((feed) => ({
  id: feed.id,
  label: feed.label,
  cameraID: feed.cameraID,
  mergeID: feed.mergeID,

   carCount: 0,
   buses: 0,
   trucks: 0,
   motorcycles: 0,

   weightedTraffic: 0,
   flowRate: 0,
   motionStatus: "Unknown",

    mergeDecision: "UNKNOWN",
    lastUpdated: null,
    cameraId: feed.id,

  streamUrl: feed.src,
  trafficLevel: feed.trafficLevel
 }));

function getCameraData() {
  return cameraData;
}

function updateCarCount(cameraID, carCount) {
  const target = cameraData.find((cam) => cam.cameraID === cameraID);
  if (!target) {
    return false;
  }

  target.carCount = Number.isFinite(Number(carCount)) ? Number(carCount) : 0;
  return true;
}

function updateCameraMetrics(cameraID, metrics) {
  const target = cameraData.find(
    (cam) => cam.cameraID === cameraID
  );

  if (!target) {
    return false;
  }

  Object.assign(target, metrics);

  return true;
}

module.exports = {
  getCameraData,
  updateCarCount,
  updateCameraMetrics
};