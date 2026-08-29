import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { acceptInvite } from '../api/client'

// Deploro's confirmation-link redirect only ever appends `?verified=1` —
// no way to tell, server-side or from the URL, which of the *two* separate
// confirmations just happened: the admin-add notification (invitee still
// needs to choose a password) or the real email_password signup from this
// page's own form (invitee is done and should go sign in). Both land back
// on this same page since Deploro's Auth Site URL is one project-wide
// setting. This flag — set right before the real signup's confirmation
// email is sent, cleared the moment it's consumed — is what tells the two
// apart on a same-device return trip.
const PENDING_KEY = 'verbis_awaiting_confirm'

/**
 * Reached via two different Deploro confirmation emails, both redirecting
 * here (see the note above): first the admin-add "Confirm your account"
 * notification an invite sends, where the invitee chooses their real
 * password (submitted straight to our own /auth/accept-invite, never
 * anything Deploro hosts — see that route's doc comment for why). Once
 * they submit, confirming Deploro's *second* email — for the real
 * email_password identity this form just created — lands here again, and
 * should go straight to sign-in instead of asking them to choose a
 * password a second time.
 */
export default function Welcome() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const verified = searchParams.get('verified') === '1'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (verified && localStorage.getItem(PENDING_KEY)) {
      localStorage.removeItem(PENDING_KEY)
      navigate('/login?confirmed=1', { replace: true })
    }
  }, [verified, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await acceptInvite(email.trim(), password)
      localStorage.setItem(PENDING_KEY, '1')
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
