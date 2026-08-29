import { useEffect, useState } from 'react'
import { adminInvite, adminListUsers, adminResendInvite } from '../api/client'
import type { AdminUser, UserRole } from '../api/types'
import { PlusIcon } from '../components/icons'

export default function Admin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<Extract<UserRole, 'member' | 'contributor'>>('member')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const loadUsers = () =>
    adminListUsers()
      .then((res) => setUsers(res.users))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load users'))

  useEffect(() => {
    loadUsers()
  }, [])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setFormError(null)
    setNotice(null)
    try {
      const { user, emailSent } = await adminInvite(email.trim(), username.trim(), role)
      setUsers((current) => [...(current ?? []), user].sort((a, b) => a.username.localeCompare(b.username)))
      setNotice(emailSent ? `Invite email sent to ${user.email}.` : `${user.username} was invited, but the email failed to send — use "Resend" below.`)
      setEmail('')
      setUsername('')
      setRole('member')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to invite')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResend = async (user: AdminUser) => {
    setResendingId(user.id)
    setError(null)
    setNotice(null)
    try {
      await adminResendInvite(user.id)
      setNotice(`Invite email resent to ${user.email}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend invite')
    } finally {
      setResendingId(null)
    }
  }

  return (
    <section>
      <div className="view-header">
        <div>
          <h1>Admin</h1>
          <p className="view-subtitle">Invite members and contributors to Verbis.</p>
        </div>
      </div>

      <form className="import-form" onSubmit={handleInvite} style={{ marginBottom: '2rem', maxWidth: '32rem' }}>
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Username</span>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <span className="field-hint">What other users will type to share a document with them.</span>
        </label>
        <label className="field">
          <span className="field-label">Role</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="member">Member — read-only, can only view documents shared with them</option>
            <option value="contributor">Contributor — member, plus can upload their own documents</option>
          </select>
        </label>

        {formError && (
          <p role="alert" className="error-text">
            {formError}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
          <PlusIcon width={16} height={16} />
          {isSubmitting ? 'Inviting…' : 'Send invite'}
        </button>
      </form>

      {notice && <p className="field-hint" style={{ marginBottom: '1rem' }}>{notice}</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}

      {users && (
        <div className="users-table">
          <div className="users-table-row users-table-head">
            <span>Username</span>
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
          </div>
          {users.map((u) => (
            <div className="users-table-row" key={u.id}>
              <span>{u.username}</span>
              <span className="view-subtitle">{u.email}</span>
              <span className={`badge ${u.role === 'admin' ? 'badge-ready' : 'badge-processing'}`}>{u.role}</span>
              {u.pending ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleResend(u)}
                  disabled={resendingId === u.id}
                >
                  {resendingId === u.id ? 'Sending…' : 'Resend invite'}
                </button>
              ) : (
                <span className="badge badge-ready">Active</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
