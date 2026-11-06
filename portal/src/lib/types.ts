export type Id = string
export type Profile = {
  id: Id; email: string; full_name: string; phone: string | null; company: string | null
  avatar_path: string | null; status: 'pending' | 'active' | 'rejected' | 'suspended'
  notification_prefs: { email: boolean; in_app: boolean }; rejection_reason: string | null
  created_at: string; approved_at: string | null
}
export type Client = { id: Id; profile_id: Id; company_name: string | null; address: string | null; created_at: string; profiles?: Profile }
export type Project = {
  id: Id; code: string; title: string; description: string | null; client_id: Id
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled'; progress: number
  location: string | null; start_date: string | null; estimated_completion: string | null
  completed_at: string | null; archived: boolean; created_at: string; updated_at: string
  clients?: Client
}
export type Milestone = {
  id: Id; project_id: Id; position: number; title: string; description: string | null
  status: 'upcoming' | 'current' | 'completed'; due_date: string | null; completed_at: string | null; updated_at: string
}
export type ProjectUpdate = {
  id: Id; project_id: Id; author_id: Id; title: string; body: string | null
  photo_paths: string[]; visible_to_client: boolean; created_at: string; profiles?: { full_name: string } | null
}
export type ProjectRequest = {
  id: Id; client_id: Id; title: string; description: string; service_type: string | null
  location: string | null; budget_range: string | null; preferred_start: string | null
  status: 'submitted' | 'under_review' | 'approved' | 'rejected' | 'converted'
  assigned_to: Id | null; decision_note: string | null; converted_project_id: Id | null; created_at: string
  clients?: Client
}
export type Doc = {
  id: Id; title: string; description: string | null; category: string | null; client_id: Id
  project_id: Id | null; direction: 'to_client' | 'from_client'; storage_path: string; file_name: string
  mime_type: string; size_bytes: number; status: 'pending' | 'approved' | 'rejected'; created_at: string
  clients?: Client; projects?: { title: string } | null
}
export type DocReview = { id: Id; document_id: Id; reviewer_id: Id; decision: string; comment: string | null; created_at: string; profiles?: { full_name: string } | null }
export type Thread = { id: Id; client_id: Id; project_id: Id | null; subject: string; status: 'open' | 'closed'; last_message_at: string; created_at: string; clients?: Client; projects?: { title: string } | null }
export type Message = { id: Id; thread_id: Id; sender_id: Id; from_staff: boolean; body: string | null; attachment_path: string | null; attachment_name: string | null; read_at: string | null; created_at: string }
export type Notification = { id: Id; type: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }
export type Invoice = {
  id: Id; number: string; client_id: Id; project_id: Id | null
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void'
  issue_date: string | null; due_date: string | null; currency: string
  line_items: { description: string; quantity: number; unit_price: number }[]
  subtotal: number; tax: number; total: number; amount_paid: number; notes: string | null; created_at: string
  clients?: Client
}
export type Payment = {
  id: Id; receipt_number: string; invoice_id: Id; client_id: Id; amount: number; method: string
  reference: string | null; paid_at: string; status: 'confirmed' | 'reversed'; reversal_reason: string | null
  created_at: string; invoices?: { number: string } | null; clients?: Client
}
export type LedgerEntry = {
  id: Id; entry_group: Id; account_id: Id; client_id: Id | null; invoice_id: Id | null; payment_id: Id | null
  debit: number; credit: number; description: string; created_at: string; ledger_accounts?: { code: string; name: string } | null
}
export type AuditLog = { id: number; actor_id: Id | null; action: string; table_name: string; record_id: string | null; new_data: unknown; created_at: string }
