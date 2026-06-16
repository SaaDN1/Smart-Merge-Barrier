import { useEffect, useRef, useState } from 'react'
import '../styles/dashboard.css'
import Cameras from './Cameras'
import Settings from './Settings'
import Footage from '../components/Footage'
import { apiJson } from '../api.js'

const HISTORY_LIMIT = 60
const VEHICLE_CLASSES = ['car', 'bus', 'truck', 'motorcycle']
const TRAFFIC_THRESHOLDS = {
  light: 10,
  moderate: 20
}
const BARRIER_RULES = {
  cars: 15,
  weighted: 18,
  minFlowForOpen: 2
}
const TRACKER_MAX_DISTANCE = 120
const TRACK_TTL_MS = 4000
const FLOW_WINDOW_MS = 60000
const FLOW_LINE_RATIO = 0.70
const MOTION_WINDOW_MS = 10000
const MOTION_RECENT_WINDOW_MS = 3000
const MOTION_THRESHOLDS = {
  congested: 0.05,
  quick: 0.06,
  congestedFlowMax: 2,
  denseTrafficTracksMin: 8,
  crawlSpeedMax: 0.035
}

function classifyTraffic(totalVehicles, thresholds = TRAFFIC_THRESHOLDS) {
  if (totalVehicles > thresholds.moderate) return 'Heavy'
  if (totalVehicles > thresholds.light) return 'Moderate'
  return 'Light'
}

function getMergeDecision({ cars, weightedTraffic, motionStatus, flowRate }) {
  const notCongested = motionStatus !== 'Congested'
  const hasGoodFlow = motionStatus === 'Quick Flow' || flowRate >= BARRIER_RULES.minFlowForOpen

  if (notCongested && hasGoodFlow) {
    return 'OPEN'
  }

  return motionStatus === 'Congested' || cars > BARRIER_RULES.cars || weightedTraffic > BARRIER_RULES.weighted
    ? 'CLOSED'
    : 'OPEN'
}

function classifyMotion(avgSpeedNorm, trackedVehicles, flowRate, recentAvgSpeedNorm = avgSpeedNorm) {
  if (trackedVehicles < 2) return 'Insufficient Data'

  const nearStandstill = avgSpeedNorm <= MOTION_THRESHOLDS.congested
  const recentNearStandstill = recentAvgSpeedNorm <= MOTION_THRESHOLDS.congested
  const stalledFlow = trackedVehicles >= 3
    && flowRate <= 1
    && recentAvgSpeedNorm <= 0.045
  const denseSlowCrawl = trackedVehicles >= MOTION_THRESHOLDS.denseTrafficTracksMin
    && flowRate <= MOTION_THRESHOLDS.congestedFlowMax
    && recentAvgSpeedNorm <= MOTION_THRESHOLDS.crawlSpeedMax

  if (nearStandstill || recentNearStandstill || stalledFlow || denseSlowCrawl) return 'Congested'
  if (
    avgSpeedNorm >= MOTION_THRESHOLDS.quick
    && recentAvgSpeedNorm >= MOTION_THRESHOLDS.quick * 0.85
    && flowRate > MOTION_THRESHOLDS.congestedFlowMax
  ) return 'Quick Flow'
  return 'Steady Flow'
}

function Sparkline({ data }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const w = canvas.clientWidth || 300
    const h = 48
    const dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = h * dpr

    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    if (data.length < 2) return

    const max = Math.max(...data, 1)
    const step = w / (data.length - 1)
    const pts = data.map((v, i) => ({ x: i * step, y: h - (v / max) * (h - 8) - 4 }))

    ctx.beginPath()
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
    ctx.lineTo(pts[pts.length - 1].x, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    ctx.fillStyle = 'rgba(38, 208, 125, 0.10)'
    ctx.fill()

    ctx.beginPath()
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
    ctx.strokeStyle = '#26d07d'
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.stroke()
  }, [data])

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '48px' }} />
}

function SideBar({ activeTab, setActiveTab, user, onLogout }) {
  const handleClick = (e, tab) => {
    e.preventDefault()
    setActiveTab(tab)
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo">VTM</div>
        <div>
          <h1 className="sidebar-title">Vehicle Traffic Monitoring</h1>
          <p className="sidebar-sub" style={{ marginBottom: 15 }}>Live dashboard</p>
        </div>
      </div>

      <a
        className={`nav-item ${activeTab === 'Overview' ? 'active' : ''}`}
        href="#"
        onClick={(e) => handleClick(e, 'Overview')}
      >
        <span className="dot"></span>Overview
      </a>

      <a
        className={`nav-item ${activeTab === 'Cameras' ? 'active' : ''}`}
        href="#"
        onClick={(e) => handleClick(e, 'Cameras')}
      >
        <span className="dot"></span>Cameras
      </a>

      <a
        className={`nav-item ${activeTab === 'Settings' ? 'active' : ''}`}
        href="#"
        onClick={(e) => handleClick(e, 'Settings')}
      >
        <span className="dot"></span>Settings
      </a>

      <div className="sidebar-session">
        <div>
          <div className="small muted">Signed in as</div>
          <div className="sidebar-session-name">{user?.name || 'Operator'}</div>
        </div>
        <button type="button" className="button-secondary" onClick={onLogout}>Sign out</button>
      </div>
    </aside>
  )
}

function Overview() {
   const [framePayload, setFramePayload] = useState({ detections: [] })
   const [cameraRows, setCameraRows] = useState([])
   const [barrierStatus, setBarrierStatus] = useState(null)
  const historyRef = useRef([])
  const flowEventsRef = useRef([])
  const speedSamplesRef = useRef([])
  const trackerRef = useRef({ nextId: 1, tracks: new Map() })
  const [stats, setStats] = useState({
    vehicles: 0,
    cars: 0,
    heavy: 0,
    motos: 0,
    weightedTraffic: 0,
    trafficStatus: 'Light',
    motionStatus: 'Insufficient Data',
    avgSpeedNorm: 0,
    recentAvgSpeedNorm: 0,
    flowRate: 0,
    history: []
  })

   useEffect(() => {
     const fetchCameraRows = async () => {
       try {
         const payload = await apiJson('/api/db')
         setCameraRows(Array.isArray(payload) ? payload : [])
       } catch (error) {
         console.error('Error loading camera table:', error)
       }
     }

     fetchCameraRows()
     const intervalId = setInterval(fetchCameraRows, 2000)
     return () => clearInterval(intervalId)
   }, [])

   useEffect(() => {
     const fetchBarrierStatus = async () => {
       try {
         const payload = await apiJson('/api/barrier')
         setBarrierStatus(payload)
       } catch (error) {
         console.error('Error loading barrier status:', error)
       }
     }

     fetchBarrierStatus()
     const intervalId = setInterval(fetchBarrierStatus, 5000)
     return () => clearInterval(intervalId)
   }, [])

  useEffect(() => {
    if (framePayload?.barrier) {
      setBarrierStatus(framePayload.barrier)
    }
  }, [framePayload])

  useEffect(() => {
    const detections = Array.isArray(framePayload?.detections) ? framePayload.detections : []
    const backendSummary = framePayload?.vehicleSummary
    const frameHeight = Number(framePayload?.frameHeight) || 0
    const now = Number(framePayload?.timestamp) || Date.now()

    const vehicles = detections.filter((d) => VEHICLE_CLASSES.includes(d.class)).length
    const cars = detections.filter((d) => d.class === 'car').length
    const heavy = detections.filter((d) => d.class === 'bus' || d.class === 'truck').length
    const motos = detections.filter((d) => d.class === 'motorcycle').length

    historyRef.current = [...historyRef.current, vehicles].slice(-HISTORY_LIMIT)
    const window5 = historyRef.current.slice(-5)
    const avgSmooth = Math.round(window5.reduce((sum, value) => sum + value, 0) / Math.max(window5.length, 1))

    const lineY = frameHeight > 0 ? frameHeight * FLOW_LINE_RATIO : 400
    const tracks = trackerRef.current.tracks
    const usedTrackIds = new Set()

    for (const [trackId, track] of tracks) {
      if (now - track.lastSeenAt > TRACK_TTL_MS) {
        tracks.delete(trackId)
      }
    }

    const vehicleDetections = detections.filter((d) => VEHICLE_CLASSES.includes(d.class) && Array.isArray(d?.bbox) && d.bbox.length === 4)

    vehicleDetections.forEach((det) => {
      const [x1, y1, x2, y2] = det.bbox
      const centroid = {
        x: (x1 + x2) / 2,
        y: (y1 + y2) / 2
      }

      let bestTrackId = null
      let bestDistance = Infinity

      for (const [trackId, track] of tracks) {
        if (usedTrackIds.has(trackId)) continue
        const distance = Math.hypot(centroid.x - track.x, centroid.y - track.y)
        if (distance < TRACKER_MAX_DISTANCE && distance < bestDistance) {
          bestDistance = distance
          bestTrackId = trackId
        }
      }

      const nextSide = centroid.y >= lineY ? 'below' : 'above'

      if (bestTrackId === null) {
        const newTrackId = trackerRef.current.nextId
        trackerRef.current.nextId += 1
        tracks.set(newTrackId, {
          x: centroid.x,
          y: centroid.y,
          side: nextSide,
          lastSeenAt: now,
          seenCount: 1,
          counted: false
        })
        usedTrackIds.add(newTrackId)
        return
      }

      const existing = tracks.get(bestTrackId)
      if (existing) {
        const dtSec = Math.max((now - existing.lastSeenAt) / 1000, 0.001)
        const distancePx = Math.hypot(centroid.x - existing.x, centroid.y - existing.y)
        const speedNorm = (distancePx / dtSec) / Math.max(frameHeight, 1)
        speedSamplesRef.current.push({ ts: now, speedNorm })
      }

      if (
        existing &&
        !existing.counted &&
        existing.side === 'above' &&
        nextSide === 'below' &&
        existing.seenCount >= 4
      ) {
        flowEventsRef.current.push(now)
        existing.counted = true
      }

      tracks.set(bestTrackId, {
        x: centroid.x,
        y: centroid.y,
        side: nextSide,
        lastSeenAt: now,
        seenCount: (existing?.seenCount || 1) + 1
      })
      usedTrackIds.add(bestTrackId)
    })

    flowEventsRef.current = flowEventsRef.current.filter((eventTs) => now - eventTs <= FLOW_WINDOW_MS)
    const localFlowRate = flowEventsRef.current.length
    speedSamplesRef.current = speedSamplesRef.current.filter((sample) => now - sample.ts <= MOTION_WINDOW_MS)
    const recentSpeedSamples = speedSamplesRef.current.filter((sample) => now - sample.ts <= MOTION_RECENT_WINDOW_MS)
    const localAvgSpeedNorm = speedSamplesRef.current.length > 0
      ? speedSamplesRef.current.reduce((sum, sample) => sum + sample.speedNorm, 0) / speedSamplesRef.current.length
      : 0
    const localRecentAvgSpeedNorm = recentSpeedSamples.length > 0
      ? recentSpeedSamples.reduce((sum, sample) => sum + sample.speedNorm, 0) / recentSpeedSamples.length
      : localAvgSpeedNorm
    const localMotionStatus = classifyMotion(localAvgSpeedNorm, vehicleDetections.length, localFlowRate, localRecentAvgSpeedNorm)

    flowEventsRef.current = flowEventsRef.current.filter((eventTs) => now - eventTs <= FLOW_WINDOW_MS)
    const localFlowRateAdjusted = flowEventsRef.current.length * (60000 / FLOW_WINDOW_MS)

    const flowRate = Number.isFinite(Number(backendSummary?.flowRate))
      ? Number(backendSummary.flowRate)
      : localFlowRateAdjusted
    const avgSpeedNorm = Number.isFinite(Number(backendSummary?.avgSpeedNorm))
      ? Number(backendSummary.avgSpeedNorm)
      : localAvgSpeedNorm
    const recentAvgSpeedNorm = Number.isFinite(Number(backendSummary?.recentAvgSpeedNorm))
      ? Number(backendSummary.recentAvgSpeedNorm)
      : localRecentAvgSpeedNorm
    const motionStatus = typeof backendSummary?.motionStatus === 'string' && backendSummary.motionStatus
      ? backendSummary.motionStatus
      : localMotionStatus

    const weightedTraffic = Number.isFinite(Number(backendSummary?.weightedTraffic))
      ? Number(backendSummary.weightedTraffic)
      : Number((cars + heavy * 1.5 + motos * 0.5).toFixed(1))
    const totalVehicles = Number.isFinite(Number(backendSummary?.totalVehicles))
      ? Number(backendSummary.totalVehicles)
      : avgSmooth
    const trafficStatus = classifyTraffic(totalVehicles)

    setStats({
      vehicles: totalVehicles,
      cars: Number.isFinite(Number(backendSummary?.cars)) ? Number(backendSummary.cars) : cars,
      heavy: Number.isFinite(Number(backendSummary?.buses)) && Number.isFinite(Number(backendSummary?.trucks))
        ? Number(backendSummary.buses) + Number(backendSummary.trucks)
        : heavy,
      motos: Number.isFinite(Number(backendSummary?.motorcycles)) ? Number(backendSummary.motorcycles) : motos,
      weightedTraffic,
      trafficStatus,
      motionStatus,
      avgSpeedNorm,
      recentAvgSpeedNorm,
      flowRate,
      history: [...historyRef.current]
    })
  }, [framePayload])

  const { vehicles, cars, heavy, motos, weightedTraffic, trafficStatus, motionStatus, avgSpeedNorm, flowRate, history } = stats
  const autoMergeDecision = getMergeDecision({ cars, weightedTraffic, motionStatus, flowRate })
  const mergeDecision = barrierStatus?.state || autoMergeDecision
  const isInitializing = Boolean(framePayload?.isInitializing);
  const mergeOpen = !isInitializing && mergeDecision === 'OPEN';

  const trafficColor = trafficStatus === 'Heavy'
    ? 'var(--danger)'
    : trafficStatus === 'Moderate'
      ? '#ffd166'
      : 'var(--accent)'
  const motionColor = motionStatus === 'Congested'
    ? 'var(--danger)'
    : motionStatus === 'Quick Flow'
      ? 'var(--accent)'
      : '#ffd166'

  const cameraData = (cameraRows.length > 0 ? cameraRows : [
    {
      cameraID: 'Camera 1 — Main Street',
      mergeID: 'Merge 1',
      vehicles,
      carCount: cars,
      heavy,
      motorcycles: motos,
      trafficStatus
    }
  ]).map((cam) => {
    const camCars = Number(cam.carCount) || 0
    const camHeavy = Number(cam.heavy) || 0
    const camMotos = Number(cam.motorcycles) || 0
    const fallbackVehicles = camCars + camHeavy + camMotos
    const camVehicles = Number.isFinite(Number(cam.vehicles)) ? Number(cam.vehicles) : fallbackVehicles
    const camWeighted = Number.isFinite(Number(cam.weightedTraffic))
      ? Number(cam.weightedTraffic)
      : Number((camCars + camHeavy * 1.5 + camMotos * 0.5).toFixed(1))
    const camTrafficStatus = cam.trafficStatus || classifyTraffic(camVehicles)

    return {
      cameraID: cam.cameraID || cam.id || 'Unknown Camera',
      mergeID: cam.mergeID || cam.mergeId || 'Unknown Merge',
      vehicles: camVehicles,
      cars: camCars,
      weightedTraffic: camWeighted,
      motionStatus: cam.motionStatus || 'Insufficient Data',
      flowRate: Number(cam.flowRate) || 0,
      trafficStatus: camTrafficStatus,
      mergeDecision: cam.mergeDecision || 'UNKNOWN'
    }
  })

  return (
    <main className="content overview-content">
      <div className="page-header">
        <h2 className="page-header-title">
          Overview
          <span className="live-badge"><span className="live-badge-dot"></span>LIVE</span>
        </h2>
        <p className="page-header-sub">Adaptive detection loop with compressed frames for lower latency</p>
      </div>

      <div className={`merge-banner ${mergeOpen ? 'merge-open' : 'merge-closed'}`}>
        <div className="merge-banner-indicator"></div>
        <div className="merge-banner-body">
          <span className="merge-banner-label">MERGE BARRIER</span>
          <span className="merge-banner-state">
            {isInitializing ? 'INITIALIZING' : mergeDecision}
          </span>
        </div>
        <div className="merge-banner-reason">
          Mode: {barrierStatus?.mode || 'AUTO'} · Motion: {motionStatus} · Flow: {flowRate}/min · Cars: {cars}/{BARRIER_RULES.cars}
        </div>
      </div>

      <div className="overview-layout">
        <section className="overview-video-column">
          <Footage onDetections={setFramePayload} />
        </section>

        <section className="overview-data-column">
          <div className="overview-stats-grid">
            <div className="card">
              <div className="title">Total Vehicles</div>
              <div className="metric">
                <div className="value">{vehicles}</div>
                <div className="label">5-frame rolling avg</div>
              </div>
            </div>

            <div className="card">
              <div className="title">Traffic Level</div>
              <div className="metric">
                <div className="value" style={{ color: trafficColor }}>{trafficStatus}</div>
                <div className="label">≤{TRAFFIC_THRESHOLDS.light} Light · ≤{TRAFFIC_THRESHOLDS.moderate} Moderate</div>
              </div>
            </div>

            <div className="card">
              <div className="title">Cars</div>
              <div className="metric">
                <div className="value">{cars}</div>
                <div className="label">Current frame</div>
              </div>
            </div>

            <div className="card">
              <div className="title">Heavy Vehicles</div>
              <div className="metric">
                <div className="value">{heavy}</div>
                <div className="label">Bus + Truck</div>
              </div>
            </div>

            <div className="card">
              <div className="title">Motorcycles</div>
              <div className="metric">
                <div className="value">{motos}</div>
                <div className="label">Current frame</div>
              </div>
            </div>

            <div className="card">
              <div className="title">Flow Rate</div>
              <div className="metric">
                <div className="value">{flowRate}</div>
                <div className="label">Tracked crossings / min</div>
              </div>
            </div>

            <div className="card">
              <div className="title">Traffic Motion</div>
              <div className="metric">
                <div className="value" style={{ color: motionColor }}>{motionStatus}</div>
                <div className="label">Avg speed {(avgSpeedNorm * 100).toFixed(1)}% frame/s</div>
              </div>
            </div>
          </div>

          <div className="overview-bottom-grid">
            <div className="card overview-history-card">
              <div className="title">Vehicle History</div>
              <div className="subtitle" style={{ marginBottom: 10 }}>
                Last {history.length}s — vehicles per processed frame
              </div>
              <Sparkline data={history} />
            </div>

            <div className="card overview-table-card">
              <div className="title">Camera Table</div>
              <div className="subtitle">Backend-synced camera metrics</div>

              <div className="spacer-12" />

              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>Camera ID</th>
                    <th>Merge ID</th>
                    <th>Total Vehicles</th>
                    <th>Traffic Status</th>
                    <th>Merge Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {cameraData.map((d, i) => {
const statusColor = d.motionStatus === 'Congested' ? 'var(--danger)' : d.motionStatus === 'Quick Flow' ? 'var(--accent)' : '#ffd166'
                    const decisionColor = d.mergeDecision === 'OPEN' ? 'var(--accent)' : 'var(--danger)'
                    return (
                      <tr key={`${d.cameraID}-${i}`}>
                        <td>{d.cameraID}</td>
                        <td>{d.mergeID}</td>
                        <td>{d.vehicles}</td>
<td><span style={{ color: statusColor, fontWeight: 600 }}>{d.motionStatus}</span></td>
                        <td><span style={{ color: decisionColor, fontWeight: 700 }}>{d.mergeDecision}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function Dashboard({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState('Overview')

  const renderContent = () => {
    switch (activeTab) {
      case 'Overview':
        return <Overview />
      case 'Cameras':
        return <Cameras />
      case 'Settings':
        return <Settings />
      default:
        return <h2>Select a tab</h2>
    }
  }

  return (
    <div className="dashboard app" style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <SideBar activeTab={activeTab} setActiveTab={setActiveTab} user={user} onLogout={onLogout} />
      <div className="dashboard-content" style={{ flex: 1, minWidth: 0 }}>
        {renderContent()}
      </div>
    </div>
  )
}

export default Dashboard
