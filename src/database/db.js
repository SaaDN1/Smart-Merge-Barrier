const cameraData = [
  {
    cameraID: "Camera 1 — Main Street",
    mergeID: "Merge 1",
    carCount: 0,
    streamUrl: "/videos/5927708-hd_1080_1920_30fps.mp4",
    trafficLevel: "High"
  },
  {
    cameraID: "Camera 2 — Side Street",
    mergeID: "Merge 2",
    carCount: 0,
    streamUrl: "/videos/low-traffic-street.mp4",
    trafficLevel: "Low"
  }
];

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
