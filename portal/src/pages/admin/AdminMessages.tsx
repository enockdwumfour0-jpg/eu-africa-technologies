import { useAuth } from '../../auth/AuthContext'
import MessagesView from '../../components/Messages'
import { PageHeader } from '../../components/ui'

export default function AdminMessages() {
  const { role } = useAuth()
  return (<><PageHeader title="Messages" sub="Conversations with clients, including project-specific threads." />
    <MessagesView mode="staff" canStart={role === 'super_admin' || role === 'admin' || role === 'support_officer'} /></>)
}
