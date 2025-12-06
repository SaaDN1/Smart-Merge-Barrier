// Mock AI module that "detects" cars and updates counts in the mock DB

const { getCameraData, updateCarCount } = require("./fake_db");

// Simulates AI detection: randomly increments carCount for each camera
async function runFakeAIDetection() {
  const current = getCameraData();

  current.forEach(cam => {
    const randomIncrease = Math.floor(Math.random() * 4);
    const newCount = cam.carCount + randomIncrease;
    updateCarCount(cam.cameraID, newCount);
  });

  return getCameraData();
}

module.exports = {
  runFakeAIDetection
};
