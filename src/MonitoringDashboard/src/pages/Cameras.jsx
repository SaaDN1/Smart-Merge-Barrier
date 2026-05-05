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
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i}>
                  <td>{d.cameraID}</td>
                  <td>{d.mergeID}</td>
                  <td>{d.carCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
