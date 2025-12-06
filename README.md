Smart Merge Barrier – Graduation Project

A simple prototype system that simulates a smart merge barrier using three components:

AI Module – Detects cars and updates camera counts

Core Backend Server – Exposes API endpoints (/api/db, /api/ai)

Monitoring Dashboard – React frontend that displays live traffic and camera data

🚀 Running the Backend Server

Open terminal:

cd src/core
npm install
node server.js


Server runs at:

http://localhost:5000


Test endpoint:

http://localhost:5000/api/db

🖥️ Running the Monitoring Dashboard

Open another terminal:

cd src/MonitoringDashboard
npm install
npm run dev


Open the URL printed by Vite (usually):

http://localhost:5173


The dashboard will automatically fetch data from the backend.
