import { useEffect, useState } from 'react'
import '../styles/dashboard.css'
import { apiJson } from '../api.js'

export default function Cameras() {
  const [data, setData] = useState([])

  useEffect(() => {
    apiJson('/api/db')
      .then(setData)
      .catch(console.error)
  }, [])

  return (
    <div className="content">
      <div className="page-header">
        <h2 className="page-header-title">Cameras</h2>
        <p className="page-header-sub">Configured camera feeds and merge assignments</p>
      </div>

      <div className="card full">
        {data.length === 0 ? (
          <div className="empty-state">No camera records found. Ensure the database is connected.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Camera ID</th>
                <th>Merge ID</th>
                <th>Car Count</th>
                <th>Traffic Status</th>
                <th>Merge Decision</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => {
                // Define color mapping to match main dashboard
                const statusColor = d.trafficStatus === 'Heavy' ? 'var(--danger)' : d.trafficStatus === 'Moderate' ? '#ffd166' : 'var(--accent)'
                return (
                  <tr key={i}>
                    <td>{d.cameraID}</td>
                    <td>{d.mergeID}</td>
                    <td>{d.carCount}</td>
                    <td><span style={{ color: statusColor, fontWeight: 600 }}>{d.trafficStatus}</span></td>
                    <td>{d.mergeDecision}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}