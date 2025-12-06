import { useState } from 'react'
import '../styles/dashboard.css'
import Data from '../database.json'

export default function Cameras() {
  const [data] = useState(Data)

  return (
    <div className="content">
      <div className="card full">
        <div>
          <div className="title">Cameras</div>
          <div className="subtitle">Configured camera feeds</div>
        </div>

        <div className="spacer-12" />

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
      </div>
    </div>
  )
}