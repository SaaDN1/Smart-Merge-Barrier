// In-memory mock "database" of cameras
// Structure matches what the React dashboard expects:
// { cameraID: string, mergeID: string, carCount: number }

let cameraData = [
  { cameraID: "CAM-001", mergeID: "M1", carCount: 12 },
  { cameraID: "CAM-002", mergeID: "M1", carCount: 7 },
  { cameraID: "CAM-003", mergeID: "M2", carCount: 20 }
];

function getCameraData() {
  return cameraData;
}

function updateCarCount(cameraID, newCount) {
  cameraData = cameraData.map(cam =>
    cam.cameraID === cameraID ? { ...cam, carCount: newCount } : cam
  );
}

function addCamera(cameraID, mergeID) {
  cameraData.push({
    cameraID,
    mergeID,
    carCount: 0
  });
}

module.exports = {
  getCameraData,
  updateCarCount,
  addCamera
};
