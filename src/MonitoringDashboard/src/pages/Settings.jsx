import { useCallback, useEffect, useState } from 'react'
import '../styles/dashboard.css'
import { apiJson } from '../api.js'

function formatAuditAction(entry) {
  if (entry.action === 'SET_AUTO') return 'Set Auto'
  if (entry.action === 'FORCE_OPEN') return 'Force Open'
  if (entry.action === 'FORCE_CLOSED') return 'Force Closed'
  return entry.action || 'Override'
}

function formatAuditTime(value) {
  if (!value) return '-'

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function Settings() {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [notifications, setNotifications] = useState(true)

  const [barrierStatus, setBarrierStatus] = useState(null)
  const [overrideLog, setOverrideLog] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchOverrideLog = useCallback(async () => {
    try {
      const data = await apiJson('/api/barrier/override-log?limit=10')
      setOverrideLog(Array.isArray(data?.entries) ? data.entries : [])
    } catch (err) {
      console.error('Failed to load override log:', err)
    }
  }, [])

  const fetchBarrierStatus = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await apiJson('/api/barrier')
      setBarrierStatus(data)
      await fetchOverrideLog()
    } catch (err) {
      console.error(err)
      setError('Failed to load barrier status')
    } finally {
      setLoading(false)
    }
  }, [fetchOverrideLog])

  const sendOverride = async (mode, state) => {
    setLoading(true)
    setError(null)

    try {
      const data = await apiJson('/api/barrier/override', {
        method: 'POST',
        body: JSON.stringify({ mode, state })
      })

      if (data.barrier) {
        setBarrierStatus(data.barrier)
      }

      if (data.audit) {
        setOverrideLog((entries) => [data.audit, ...entries].slice(0, 10))
      } else {
        await fetchOverrideLog()
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to update barrier')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBarrierStatus()

    if (!autoRefresh) return

    const interval = setInterval(fetchBarrierStatus, 3000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchBarrierStatus])

  const barrierStateText = barrierStatus
    ? `${barrierStatus.state} (${barrierStatus.mode})`
    : 'Unknown'

  const trafficText = barrierStatus
    ? `Total cars: ${barrierStatus.totalCars} / Cars threshold: ${barrierStatus.thresholds?.cars ?? '-'} / Weighted threshold: ${barrierStatus.thresholds?.weighted ?? '-'}`
    : ''

  return (
    <div className="content">
      <div className="page-header">
        <h2 className="page-header-title">Settings</h2>
        <p className="page-header-sub">Application preferences and barrier control</p>
      </div>

      <div className="card full">
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

        <div className="barrier-section">
          <div className="flex-between-baseline">
            <p className="section-title-sm">Smart Merge Barrier</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {loading && <span className="small muted">Updating…</span>}
              {error && <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>}
            </div>
          </div>

          <div className="settings-list">
            <div className="setting-item">
              <span>Barrier status</span>
              <span style={{
                color: barrierStatus?.state === 'OPEN' ? 'var(--accent)' : 'var(--danger)',
                fontWeight: 600
              }}>{barrierStateText}</span>
            </div>
            <div className="setting-item">
              <span>Traffic load</span>
              <span className="muted">{trafficText}</span>
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

          <div className="spacer-12" />

          <div className="override-log-panel">
            <p className="section-title-sm">Recent Override Log</p>
            {overrideLog.length === 0 ? (
              <div className="empty-state compact-empty">No override actions recorded yet.</div>
            ) : (
              <table className="table compact-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Operator</th>
                    <th>Action</th>
                    <th>Previous</th>
                    <th>Next</th>
                  </tr>
                </thead>
                <tbody>
                  {overrideLog.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatAuditTime(entry.timestamp)}</td>
                      <td>{entry.operator || 'Operator'}</td>
                      <td>{formatAuditAction(entry)}</td>
                      <td>{entry.previous?.state || '-'} ({entry.previous?.mode || '-'})</td>
                      <td>{entry.next?.state || '-'} ({entry.next?.mode || '-'})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
