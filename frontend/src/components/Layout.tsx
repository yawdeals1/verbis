import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { getHealth } from '../api/client'
import { useTheme } from '../hooks/useTheme'

type ApiStatus = 'checking' | 'connected' | 'unreachable'

const THEME_CYCLE = { system: 'light', light: 'dark', dark: 'system' } as const

export default function Layout() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')
  const [theme, setTheme] = useTheme()

  useEffect(() => {
    getHealth()
      .then(() => setApiStatus('connected'))
      .catch(() => setApiStatus('unreachable'))
  }, [])

  return (
    <div>
      <div className="app-header">
        <button type="button" className="theme-toggle" onClick={() => setTheme(THEME_CYCLE[theme])}>
          Theme: {theme}
        </button>
        <span>API: {apiStatus}</span>
      </div>
      <main style={{ padding: '1rem' }}>
        <Outlet />
      </main>
    </div>
  )
}
