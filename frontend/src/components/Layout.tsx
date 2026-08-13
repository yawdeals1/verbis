import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { getHealth } from '../api/client'

type ApiStatus = 'checking' | 'connected' | 'unreachable'

export default function Layout() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    getHealth()
      .then(() => setApiStatus('connected'))
      .catch(() => setApiStatus('unreachable'))
  }, [])

  return (
    <div>
      <div style={{ fontSize: '0.8rem', padding: '0.25rem 1rem', textAlign: 'right' }}>
        API: {apiStatus}
      </div>
      <main style={{ padding: '1rem' }}>
        <Outlet />
      </main>
    </div>
  )
}
