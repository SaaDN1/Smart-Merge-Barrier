import { useState } from 'react'
import '../styles/dashboard.css'
import Data from '../database.json'
import Cameras from './Cameras'
import Settings from './Settings'

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

function Overview({ data }) {
  const totalCars = data.reduce((s, d) => s + (Number(d.carCount) || 0), 0)

  return (
    <main className="content">
      <div className="grid">
        <div className="card">
          <div className="title">Total Cars</div>
          <div className="metric">
            <div className="value">{totalCars}</div>
            <div className="label">Across {data.length} cameras</div>
          </div>
        </div>

        <div className="card">
          <div className="title">Active Cameras</div>
          <div className="metric">
            <div className="value">{data.length}</div>
            <div className="label">Reporting</div>
          </div>
        </div>

        <div className="card">
          <div className="title">Traffic Health</div>
          <div className="status up"><span className="dot"></span><span className="small">All systems operational</span></div>
        </div>

        <div className="card full">
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
    </main>
  )
}

function Dashboard() {
  const [data] = useState(Data)
  const [activeTab, setActiveTab] = useState('Overview')

  const renderContent = () => {
    if (!data) return <p>Loading...</p>

    switch (activeTab) {
      case 'Overview':
        return <Overview data={data} />
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
