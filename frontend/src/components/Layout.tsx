import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { getHealth } from '../api/client'
import { useTheme } from '../hooks/useTheme'
import { MoonIcon, SunIcon, SystemIcon } from './icons'

type ApiStatus = 'checking' | 'connected' | 'unreachable'

const THEME_CYCLE = { system: 'light', light: 'dark', dark: 'system' } as const

const THEME_ICON = {
  system: SystemIcon,
  light: SunIcon,
  dark: MoonIcon,
} as const

export default function Layout() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')
  const [theme, setTheme] = useTheme()
  const ThemeIcon = THEME_ICON[theme]

  useEffect(() => {
    getHealth()
      .then(() => setApiStatus('connected'))
      .catch(() => setApiStatus('unreachable'))
  }, [])

  return (
    <div>
      <header className="app-header">
        <Link to="/" className="app-brand">
          <span className="app-brand-mark">Verbis</span>
        </Link>
        <div className="app-header-right">
          <span className="api-status">
            <span className={`api-status-dot is-${apiStatus === 'connected' ? 'connected' : apiStatus === 'unreachable' ? 'unreachable' : ''}`} />
            {apiStatus === 'checking' ? 'Connecting…' : apiStatus === 'connected' ? 'Connected' : 'Offline'}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setTheme(THEME_CYCLE[theme])}
            aria-label={`Theme: ${theme}. Click to change.`}
            title={`Theme: ${theme}`}
          >
            <ThemeIcon width={17} height={17} />
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
