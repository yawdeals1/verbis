import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { acceptInvite } from '../api/client'

/**
 * Reached only via the admin-add "Confirm your account" email an invite
 * sends (Deploro's Auth Site URL points here — `deploro auth site-url`),
 * never linked from the login page. Deploro has no admin-initiated
 * "here's a link to set your password" primitive and its password-reset
 * email doesn't actually get delivered (verified live) — so this page
 * itself is where the invitee chooses their real password, submitted
 * straight to our own /auth/accept-invite rather than anything Deploro
 * hosts. The email they just clicked only confirmed a harmless,
 * passwordless placeholder identity — it never touches whatever password
 * they enter here.
 */
export default function Welcome() {
  const [searchParams] = useSearchParams()
  const verified = searchParams.get('verified') === '1'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await acceptInvite(email.trim(), password)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set up your account')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (done) {
    return (
      <section className="import-panel">
        <div className="empty-state">
          <h2>Check your email</h2>
          <p>Click the confirmation link we just sent to {email}, then sign in.</p>
          <Link to="/login" className="btn btn-primary">
            Go to sign in
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className="import-panel">
      <div>
        <h1>{verified ? "You're invited" : 'Welcome to Verbis'}</h1>
        <p className="view-subtitle">Enter your email and choose the password you'll sign in with.</p>
      </div>

      <form className="import-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Choose a password</span>
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
          {isSubmitting ? 'Setting up…' : 'Set password'}
        </button>

        <p className="field-hint">
          Already set up? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </section>
  )
}
