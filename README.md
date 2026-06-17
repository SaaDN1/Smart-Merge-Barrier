Smart Merge Barrier – Graduation Project

A simple prototype system that simulates a smart merge barrier using three components:

AI Module – Detects cars and updates camera counts

Core Backend Server – Exposes API endpoints (/api/db, /api/ai)

Monitoring Dashboard – React frontend that displays live traffic and camera data

🐍 Running the AI model (python YOLO11m)

Open terminal:
cd src/core/py_server
pip install -r requirements.txt
uvicorn main:app --reload

🚀 Running the Backend Server

Open terminal:

cd src/core/js_server
npm i
npm start


🖥️ Running the Monitoring Dashboard

Open another terminal:

cd src/MonitoringDashboard
npm i
npm run dev


Open the URL printed by Vite (usually):

http://localhost:5173


The dashboard will automatically fetch data from the backend.

Authentication:

- Default operator password: `smartmerge2026`
- Override it before starting the backend with `ADMIN_PASSWORD=your-password`.
- Barrier override actions are written to `src/core/js_server/logs/barrier-overrides.jsonl` and shown in Settings.
