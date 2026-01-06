import { useEffect, useState } from 'react'
import '../styles/dashboard.css'
import Cameras from './Cameras'
import Settings from './Settings'
import Footage from '../components/Footage'

function SideBar({ activeTab, setActiveTab }) {
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
          <p className="sidebar-sub" style={{marginBottom: 15}}>Live dashboard</p>
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
    </aside>
  )
}

function Overview() {
  const [detections, setDetections] = useState([])

  const totalCars = detections.filter(d => d.class === 'car').length
  const totalPersons = detections.filter(d => d.class === 'person').length
  const totalBuses = detections.filter(d => d.class === 'bus').length

  const cameraData = [{cameraID: 'Camera 1', mergeID: 'Merge 1', carCount: totalCars}]

  return (
    <main className="content">
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        <Footage onDetections={setDetections} />
        <div className="grid" style={{ flex: '0 0 400px', gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="card">
            <div className="title">Total Cars</div>
            <div className="metric">
              <div className="value">{totalCars}</div>
              <div className="label">Detected in current frame</div>
            </div>
          </div>

          <div className="card">
            <div className="title">Total Persons</div>
            <div className="metric">
              <div className="value">{totalPersons}</div>
              <div className="label">Detected in current frame</div>
            </div>
          </div>

          <div className="card">
            <div className="title">Total Buses</div>
            <div className="metric">
              <div className="value">{totalBuses}</div>
              <div className="label">Detected in current frame</div>
            </div>
          </div>

          <div className="card">
            <div className="title">Traffic Health</div>
            <div className="status up"><span className="dot"></span><span className="small">All systems operational</span></div>
          </div>
        </div>
      </div>

      <div className="card full" style={{ marginTop: '20px' }}>
        <div className="flex-between-baseline">
          <div>
            <div className="title">Camera table</div>
            <div className="subtitle">Live feed of camera merge counts</div>
          </div>
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
            {cameraData.map((d, i) => (
              <tr key={i}>
                <td>{d.cameraID}</td>
                <td>{d.mergeID}</td>
                <td>{d.carCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}

function Dashboard() {
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
      <SideBar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="dashboard-content" style={{ flex: 1, minWidth: 0 }}>
        {renderContent()}
      </div>
    </div>
  )
}

export default Dashboard;
