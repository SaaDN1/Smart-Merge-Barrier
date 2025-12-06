import { useState, useEffect } from 'react'
import '../styles/dashboard.css'

export default function Settings() {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [notifications, setNotifications] = useState(true)

  const [barrierStatus, setBarrierStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const backendBaseUrl = 'http://localhost:5000'

  const fetchBarrierStatus = () => {
    setLoading(true)
    setError(null)

    fetch(`${backendBaseUrl}/api/barrier`)
      .then(res => res.json())
      .then(data => {
        setBarrierStatus(data)
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setError('Failed to load barrier status')
        setLoading(false)
      })
  }

  const sendOverride = (mode, state) => {
    setLoading(true)
    setError(null)

    fetch(`${backendBaseUrl}/api/barrier/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, state })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setError(data.error)
        } else if (data.barrier) {
          setBarrierStatus(data.barrier)
        }
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setError('Failed to update barrier')
        setLoading(false)
      })
  }

  useEffect(() => {
    fetchBarrierStatus()

    if (!autoRefresh) return

    const interval = setInterval(fetchBarrierStatus, 3000)
    return () => clearInterval(interval)
  }, [autoRefresh])

  const barrierStateText = barrierStatus
    ? `${barrierStatus.state} (${barrierStatus.mode})`
    : 'Unknown'

  const trafficText = barrierStatus
    ? `Total cars: ${barrierStatus.totalCars} / Threshold: ${barrierStatus.threshold}`
    : ''

  return (
    <div className="content">
      <div className="card full">
        <div>
          <div className="title">Settings</div>
          <div className="subtitle">Application preferences & barrier control</div>
        </div>

        <div className="spacer-12" />

        <div className="settings-list">
          <label className="setting-item">
            <span>Auto-refresh barrier status</span>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
            />
          </label>

          <label className="setting-item">
            <span>Notifications</span>
            <input
              type="checkbox"
              checked={notifications}
              onChange={e => setNotifications(e.target.checked)}
            />
          </label>
        </div>

        <div className="spacer-12" />

        <div className="card" style={{ marginTop: 12 }}>
          <div className="flex-between-baseline">
            <div className="title">Smart Merge Barrier</div>
            {loading && <div className="small">Updating...</div>}
            {error && <div className="small" style={{ color: 'red' }}>{error}</div>}
          </div>

          <div className="spacer-12" />

          <div className="settings-list">
            <div className="setting-item">
              <span>Barrier status</span>
              <span>{barrierStateText}</span>
            </div>
            <div className="setting-item">
              <span>Traffic load</span>
              <span>{trafficText}</span>
            </div>
          </div>

          <div className="spacer-12" />

          <div className="settings-list">
            <span className="setting-item">
              <span>Automatic mode</span>
              <button onClick={() => sendOverride('auto')}>Set to Auto</button>
            </span>

            <span className="setting-item">
              <span>Manual override</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => sendOverride('manual', 'OPEN')}>Force OPEN</button>
                <button onClick={() => sendOverride('manual', 'CLOSED')}>Force CLOSED</button>
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}