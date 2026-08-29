import { useEffect, useState } from 'react'
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { getHealth } from '../api/client'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../contexts/AuthContext'
import { LogOutIcon, MoonIcon, SunIcon, SystemIcon, UserIcon } from './icons'

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
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    getHealth()
      .then(() => setApiStatus('connected'))
      .catch(() => setApiStatus('unreachable'))
  }, [])

  return (
    <div>
      <header className="app-header">
        <Link to="/" className="app-brand">
          <svg className="app-brand-icon" viewBox="0 0 32 32" aria-hidden="true">
            <path className="app-brand-icon-accent" d="M3.5 6.3c4.4-.2 8.5 1.4 11.7 4.4v16.5c-3.4-3.3-7.4-5.2-11.7-5.5z" />
            <path d="M16.8 10.7c3.2-3 7.3-4.6 11.7-4.4v12.5c0 1.6-1 2.7-2.4 2.9-3.8.7-6.9 2.5-9.3 5.5z" />
            <path className="app-brand-icon-listen" d="M25 2.9c2.4.6 4.2 2.3 4.8 4.6" />
          </svg>
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
          {user && (
            <div className="user-menu">
              <span className="user-menu-name">
                <UserIcon width={14} height={14} />
                {user.username}
              </span>
              <span className={`badge ${user.role === 'admin' ? 'badge-ready' : 'badge-processing'}`}>{user.role}</span>
              {user.role === 'admin' && (
                <Link to="/admin" className="btn btn-ghost btn-sm">
                  Admin
                </Link>
              )}
              <button type="button" className="btn btn-ghost btn-icon" onClick={handleLogout} aria-label="Sign out" title="Sign out">
                <LogOutIcon width={16} height={16} />
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
