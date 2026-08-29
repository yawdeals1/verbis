import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import RequireAuth from './components/RequireAuth'
import Layout from './components/Layout'
import Library from './views/Library'
import Reader from './views/Reader'
import Import from './views/Import'
import Login from './views/Login'
import Welcome from './views/Welcome'
import ForgotPassword from './views/ForgotPassword'
import ResetPassword from './views/ResetPassword'
import Admin from './views/Admin'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/login" element={<Login />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route element={<RequireAuth />}>
            <Route path="/" element={<Library />} />
            <Route path="/import" element={<Import />} />
            <Route path="/reader/:documentId" element={<Reader />} />
          </Route>

          <Route element={<RequireAuth roles={['admin']} />}>
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  )
}
