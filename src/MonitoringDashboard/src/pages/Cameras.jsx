import { useEffect, useState } from 'react'
import '../styles/dashboard.css'

export default function Cameras() {
  const [data, setData] = useState([])

  useEffect(() => {
    fetch('http://localhost:5000/api/db')
      .then(res => res.json())
      .then(setData)
      .catch(console.error)
  }, [])

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