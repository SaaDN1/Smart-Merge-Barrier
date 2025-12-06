import { useState } from 'react'
import '../styles/dashboard.css'

export default function Settings() {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [notifications, setNotifications] = useState(true)

  return (
    <div className="content">
      <div className="card full">
        <div>
          <div className="title">Settings</div>
          <div className="subtitle">Application preferences</div>
        </div>

        <div className="spacer-12" />

        <div className="settings-list">
          <label className="setting-item">
            <span>Auto-refresh</span>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          </label>

          <label className="setting-item">
            <span>Notifications</span>
            <input type="checkbox" checked={notifications} onChange={e => setNotifications(e.target.checked)} />
          </label>
        </div>
      </div>
    </div>
  )
}