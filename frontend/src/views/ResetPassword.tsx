import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { resetPassword } from '../api/client'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('reset_token') ?? ''
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await resetPassword(token, password)
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!token) {
    return (
      <section className="import-panel">
        <div className="empty-state">
          <h2>Missing reset link</h2>
          <p>Open the link from your password reset email to get here.</p>
          <Link to="/forgot-password" className="btn btn-primary">
            Request a new link
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className="import-panel">
      <div>
        <h1>Choose a new password</h1>
      </div>

      <form className="import-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">New password</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <span className="field-hint">At least 8 characters.</span>
        </label>

        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </section>
  )
}
