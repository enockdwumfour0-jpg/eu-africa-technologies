import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Banknote, BarChart3, Briefcase, Handshake, Target, Upload, FileText, FolderKanban, Globe, Inbox, LayoutDashboard, MessageSquare, Settings, Users, UserRound } from 'lucide-react'
import ProtectedRoute from './auth/ProtectedRoute'
import { useAuth } from './auth/AuthContext'
import { homeFor, type Role } from './lib/roles'
import Shell, { type NavItem } from './layouts/Shell'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import Forgot from './pages/auth/Forgot'
import Reset from './pages/auth/Reset'
import ClientDashboard from './pages/client/ClientDashboard'
import ClientProjects, { ProjectDetail } from './pages/client/ClientProjects'
import ClientDocuments from './pages/client/ClientDocuments'
import ClientPayments from './pages/client/ClientPayments'
import ClientProfile from './pages/client/ClientProfile'
import MessagesView from './components/Messages'
import { PageHeader } from './components/ui'
import AdminOverview from './pages/admin/AdminOverview'
import AdminClients, { ClientDetail } from './pages/admin/AdminClients'
import AdminProjects, { AdminProjectDetail } from './pages/admin/AdminProjects'
import AdminRequests from './pages/admin/AdminRequests'
import AdminDocuments from './pages/admin/AdminDocuments'
import AdminMessages from './pages/admin/AdminMessages'
import AdminFinance from './pages/admin/AdminFinance'
import AdminReports from './pages/admin/AdminReports'
import AdminSettings from './pages/admin/AdminSettings'
import AdminWebsite from './pages/admin/AdminWebsite'
import AdminAgents, { AgentDetail } from './pages/admin/AdminAgents'
import { AgentClientDetail, AgentClients, AgentCommission, AgentFiles, AgentLeads, AgentMessages, AgentOverview, AgentProfile, AgentProjects, AgentResources } from './pages/agent/Agent'

const CLIENT_NAV: NavItem[] = [
  { to: '/portal', label: 'Dashboard', icon: LayoutDashboard, end: true }, { to: '/portal/projects', label: 'My projects', icon: FolderKanban },
  { to: '/portal/documents', label: 'Documents', icon: FileText }, { to: '/portal/messages', label: 'Messages', icon: MessageSquare },
  { to: '/portal/payments', label: 'Payments', icon: Banknote }, { to: '/portal/profile', label: 'Profile', icon: UserRound },
]
const AGENT_NAV: NavItem[] = [
  { to: '/agent', label: 'Overview', icon: LayoutDashboard, end: true }, { to: '/agent/clients', label: 'My clients', icon: Users },
  { to: '/agent/projects', label: 'Projects', icon: FolderKanban }, { to: '/agent/files', label: 'Files', icon: Upload },
  { to: '/agent/leads', label: 'Leads', icon: Target }, { to: '/agent/resources', label: 'Resources', icon: FileText }, { to: '/agent/messages', label: 'Messages', icon: MessageSquare }, { to: '/agent/commission', label: 'Commission', icon: Banknote }, { to: '/agent/profile', label: 'Profile', icon: UserRound },
]
const ALL: Role[] = ['super_admin', 'admin', 'project_manager', 'accountant', 'support_officer']
const ADMIN_NAV: (NavItem & { roles: Role[] })[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true, roles: ALL },
  { to: '/admin/clients', label: 'Clients', icon: Users, roles: ['super_admin', 'admin', 'support_officer'] },
  { to: '/admin/agents', label: 'Agents', icon: Handshake, roles: ['super_admin', 'admin', 'accountant'] },
  { to: '/admin/projects', label: 'Projects', icon: FolderKanban, roles: ['super_admin', 'admin', 'project_manager', 'support_officer', 'accountant'] },
  { to: '/admin/requests', label: 'Requests', icon: Inbox, roles: ['super_admin', 'admin', 'support_officer'] },
  { to: '/admin/documents', label: 'Documents', icon: FileText, roles: ['super_admin', 'admin', 'project_manager', 'support_officer'] },
  { to: '/admin/messages', label: 'Messages', icon: MessageSquare, roles: ['super_admin', 'admin', 'project_manager', 'support_officer'] },
  { to: '/admin/finance', label: 'Finance', icon: Banknote, roles: ['super_admin', 'admin', 'accountant'] },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3, roles: ALL },
  { to: '/admin/website', label: 'Website', icon: Globe, roles: ['super_admin', 'admin'] },
  { to: '/admin/settings', label: 'Settings', icon: Settings, roles: ['super_admin', 'admin'] },
]

function Root() {
  const { loading, role } = useAuth()
  if (loading) return null
  return <Navigate to={homeFor(role)} replace />
}
function AdminShell() {
  const { role } = useAuth()
  const nav = ADMIN_NAV.filter((n) => role && n.roles.includes(role))
  return <Shell nav={nav} title={role === 'project_manager' ? 'Project management' : 'Administration'} base="/admin" />
}
// UX gate only: RLS is the real enforcement. Sends users to a page their role can open.
function Only({ roles, children }: { roles: Role[]; children: ReactElement }) {
  const { role } = useAuth()
  return role && roles.includes(role) ? children : <Navigate to={homeFor(role)} replace />
}
const only = (path: string) => ADMIN_NAV.find((n) => n.to === path)!.roles

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<Forgot />} />
      <Route path="/reset-password" element={<Reset />} />

      <Route element={<ProtectedRoute area="client" />}>
        <Route path="/portal" element={<Shell nav={CLIENT_NAV} title="Client Portal" base="/portal" profilePath="/portal/profile" />}>
          <Route index element={<ClientDashboard />} />
          <Route path="projects" element={<ClientProjects />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="documents" element={<ClientDocuments />} />
          <Route path="messages" element={<><PageHeader title="Messages" sub="Chat with the EU-AFRIC team about your projects." /><MessagesView mode="client" /></>} />
          <Route path="payments" element={<ClientPayments />} />
          <Route path="profile" element={<ClientProfile />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute area="agent" />}>
        <Route path="/agent" element={<Shell nav={AGENT_NAV} title="Agent Portal" base="/agent" profilePath="/agent/profile" />}>
          <Route index element={<AgentOverview />} />
          <Route path="clients" element={<AgentClients />} />
          <Route path="clients/:id" element={<AgentClientDetail />} />
          <Route path="projects" element={<AgentProjects />} />
          <Route path="projects/:id" element={<ProjectDetail base="/agent" />} />
          <Route path="files" element={<AgentFiles />} />
          <Route path="leads" element={<AgentLeads />} />
          <Route path="resources" element={<AgentResources />} />
          <Route path="messages" element={<AgentMessages />} />
          <Route path="commission" element={<AgentCommission />} />
          <Route path="profile" element={<AgentProfile />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute area="staff" />}>
        <Route path="/admin" element={<AdminShell />}>
          <Route index element={<Only roles={only('/admin')}><AdminOverview /></Only>} />
          <Route path="clients" element={<Only roles={only('/admin/clients')}><AdminClients /></Only>} />
          <Route path="clients/:id" element={<Only roles={only('/admin/clients')}><ClientDetail /></Only>} />
          <Route path="agents" element={<Only roles={only('/admin/agents')}><AdminAgents /></Only>} />
          <Route path="agents/:id" element={<Only roles={only('/admin/agents')}><AgentDetail /></Only>} />
          <Route path="projects" element={<Only roles={only('/admin/projects')}><AdminProjects /></Only>} />
          <Route path="projects/:id" element={<Only roles={only('/admin/projects')}><AdminProjectDetail /></Only>} />
          <Route path="requests" element={<Only roles={only('/admin/requests')}><AdminRequests /></Only>} />
          <Route path="documents" element={<Only roles={only('/admin/documents')}><AdminDocuments /></Only>} />
          <Route path="messages" element={<Only roles={only('/admin/messages')}><AdminMessages /></Only>} />
          <Route path="finance" element={<Only roles={only('/admin/finance')}><AdminFinance /></Only>} />
          <Route path="reports" element={<Only roles={only('/admin/reports')}><AdminReports /></Only>} />
          <Route path="website" element={<Only roles={only('/admin/website')}><AdminWebsite /></Only>} />
          <Route path="settings" element={<Only roles={only('/admin/settings')}><AdminSettings /></Only>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
