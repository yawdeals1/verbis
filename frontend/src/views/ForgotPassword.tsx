import { useState } from 'react'
import { Link } from 'react-router-dom'
import { forgotPassword } from '../api/client'

export default function ForgotPassword() {
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

  return (
    <section className="import-panel">
      <div>
        <h1>Reset password</h1>
        <p className="view-subtitle">We'll email you a reset link if that address has an account.</p>
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
            disabled={sent}
            required
          />
        </label>

        {sent ? (
          <p className="field-hint">If that email has a password-based account, a reset link is on its way.</p>
        ) : (
          <button type="submit" className="btn btn-primary btn-block" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </button>
        )}

        <p className="field-hint">
          <Link to="/login">Back to sign in</Link>
        </p>
      </form>
    </section>
  )
}
