const cameraFeeds = require("../MonitoringDashboard/src/data/cameraFeeds.json");

function ensureUniqueCameraFeeds(feeds) {
  const seenIds = new Set();
  const seenProfiles = new Set();
  const seenStreams = new Set();

  feeds.forEach((feed) => {
    if (seenIds.has(feed.id)) {
      throw new Error(`Duplicate camera id detected: ${feed.id}`);
    }
    if (seenProfiles.has(feed.trafficLevel)) {
      throw new Error(`Duplicate traffic profile detected: ${feed.trafficLevel}`);
    }
    if (seenStreams.has(feed.src)) {
      throw new Error(`Duplicate camera video detected: ${feed.src}`);
    }

    seenIds.add(feed.id);
    seenProfiles.add(feed.trafficLevel);
    seenStreams.add(feed.src);
  });
}

ensureUniqueCameraFeeds(cameraFeeds);

const cameraData = cameraFeeds.map((feed) => ({
  id: feed.id,
  label: feed.label,
  cameraID: feed.cameraID,
  mergeID: feed.mergeID,
  carCount: 0,
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

module.exports = {
  getCameraData,
  updateCarCount
};
