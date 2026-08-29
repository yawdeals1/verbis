import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { forgotPassword } from '../api/client'

/**
 * Lands here after clicking the "Confirm your account" link from an invite
 * email (Deploro's Auth Site URL points here — `deploro auth site-url`).
 * Deploro's confirm-email flow has no way to collect a password directly
 * (it's a bare verification redirect, `?verified=1`, with no other data) —
 * the only Deploro-provided page that lets someone type a new password is
 * the password-reset landing, which itself requires a *separate* emailed
 * link. So this page's job is just to trigger that second email for them,
 * rather than making them go find "Forgot password?" on the login page
 * themselves — verified live that Deploro has no single-step "invite with
 * a working set-password link" primitive; this is the closest continuous
 * flow achievable with its actual API.
 */
export default function Welcome() {
  const [searchParams] = useSearchParams()
  const verified = searchParams.get('verified') === '1'
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      await forgotPassword(email.trim())
    } finally {
      setIsSubmitting(false)
      setSent(true)
    }
  }

  if (sent) {
    return (
      <section className="import-panel">
        <div className="empty-state">
          <h2>Check your email</h2>
          <p>Click the link we just sent to set your password, then sign in.</p>
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
        <h1>{verified ? "You're confirmed" : 'Welcome to Verbis'}</h1>
        <p className="view-subtitle">
          {verified
            ? 'Last step — enter your email and we’ll send you a link to set your password.'
            : 'Enter your email and we’ll send you a link to set your password.'}
        </p>
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

        <button type="submit" className="btn btn-primary btn-block" disabled={isSubmitting}>
          {isSubmitting ? 'Sending…' : 'Send me a link'}
        </button>

        <p className="field-hint">
          Already have a password? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </section>
  )
}
