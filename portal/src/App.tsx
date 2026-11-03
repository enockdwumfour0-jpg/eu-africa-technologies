import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './auth/ProtectedRoute'
import { useAuth } from './auth/AuthContext'
import { homeFor } from './lib/roles'
import Placeholder from './pages/Placeholder'

const clientRoutes = ['projects', 'documents', 'messages', 'payments', 'profile']
const adminRoutes = ['clients', 'projects', 'requests', 'documents', 'messages', 'finance', 'reports', 'settings']

function Root() {
  const { loading, role } = useAuth()
  if (loading) return null
  return <Navigate to={homeFor(role)} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/login" element={<Placeholder title="Login" />} />
      <Route path="/register" element={<Placeholder title="Client registration" />} />
      <Route path="/forgot-password" element={<Placeholder title="Forgot password" />} />

      <Route element={<ProtectedRoute area="client" />}>
        <Route path="/portal" element={<Placeholder title="Client dashboard" />} />
        {clientRoutes.map((r) => <Route key={r} path={`/portal/${r}`} element={<Placeholder title={`Portal · ${r}`} />} />)}
      </Route>

      <Route element={<ProtectedRoute area="staff" />}>
        <Route path="/admin" element={<Placeholder title="Admin dashboard" />} />
        {adminRoutes.map((r) => <Route key={r} path={`/admin/${r}`} element={<Placeholder title={`Admin · ${r}`} />} />)}
        <Route path="/admin/website" element={<Placeholder title="Admin · website (enquiries, lands, gallery)" />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
