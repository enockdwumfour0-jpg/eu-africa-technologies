import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { homeFor, isStaff, type Role } from '../lib/roles'

type Props = { area: 'client' | 'staff'; allow?: Role[] }

// UX guard only. Every query is still authorised by RLS on the server.
export default function ProtectedRoute({ area, allow }: Props) {
  const { loading, session, role, status } = useAuth()
  const loc = useLocation()

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
  if (!session) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  if (status === 'suspended' || status === 'rejected') return <Navigate to="/login?reason=" replace />
  if (status === 'pending') return <Navigate to="/login?reason=pending" replace />
  if (area === 'client' && role !== 'client') return <Navigate to={homeFor(role)} replace />
  if (area === 'staff' && !isStaff(role)) return <Navigate to={homeFor(role)} replace />
  if (allow && role && !allow.includes(role)) return <Navigate to={homeFor(role)} replace />
  return <Outlet />
}
