# EU-AFRIC Client Portal and Admin Dashboard: setup guide

The portal is a React + TypeScript + Vite + Tailwind app in `portal/`, backed by Supabase (Postgres, Auth,
Storage, Realtime, Edge Functions) and Resend for email. It lives on the same domain as the public site
(`eatl.co.com`); the public pages are unchanged apart from a **Client Portal** button next to
**Book a Consultation**.

| Route | Who |
|---|---|
| `/login`, `/register`, `/forgot-password`, `/reset-password` | everyone |
| `/portal`, `/portal/projects`, `/portal/documents`, `/portal/messages`, `/portal/payments`, `/portal/profile` | approved clients |
| `/admin` and `/admin/*` (clients, projects, requests, documents, messages, finance, reports, settings, website) | staff; each page is limited by role |

After login: clients go to `/portal`; Super Administrators, Administrators, Accountants and Support Officers go
to `/admin`; Project Managers go to `/admin/projects` and only see projects they are assigned to. The old
`/admin.html` website editor (enquiries, land listings, gallery) is now **Admin > Website**.

## How it is built, in one paragraph

Netlify runs `npm run build` (see `netlify.toml`), builds `portal/`, and `scripts/assemble.mjs` copies it to
`/portal-app/` next to the untouched static pages. Rewrites send `/login`, `/portal/*`, `/admin/*` etc. to the app,
so refreshing any dashboard page works. **Security is enforced in the database**: every table has Row Level
Security, roles live in `user_roles` (no one can edit their own), money moves only through checked database
functions, and documents sit in private storage buckets. The screens hide things for convenience, but a hidden
button is never the protection.

## 1. Configure Supabase

The project already exists (`enlkrucktzppkyxrljpr`). In the Supabase dashboard:

1. **Authentication > URL Configuration**: Site URL `https://eatl.co.com`; add redirect URLs
   `https://eatl.co.com/reset-password` and `https://eatl.co.com/login`.
2. **Authentication > Providers > Email**: keep **Confirm email** ON (clients must verify their address).
3. **Authentication > SMTP Settings**: enable custom SMTP so verification and password-reset emails come from your
   domain through Resend: host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key,
   sender `alerts@alerts.eatl.co.com`.
4. **Database > Extensions**: enable **pg_net** (migration 009 tries to enable it too).

## 2. Run the SQL migrations

Files are in `supabase/migrations/`, numbered 001 to 011, and must run in order. They only **add** objects; the
existing `admins`, `enquiries`, `land_listings` and `gallery_items` tables and the current website keep working.

- With the CLI: `supabase link --project-ref enlkrucktzppkyxrljpr` then `supabase db push`.
- Or paste each file, in order, into **SQL Editor** and run it.

Afterwards open **Advisors > Security** and confirm there are no warnings about missing RLS.

To re-check permissions at any time on a scratch Postgres: `supabase/tests/run.sh <socket-dir> <port>`.
It applies every migration and runs 192 checks (for example, one client cannot read another client's projects,
documents, messages or invoices; nobody can edit their own role; the ledger cannot be edited).

## 3. Environment variables

| Where | Name | Value |
|---|---|---|
| Netlify (Site settings > Environment variables) | `VITE_SUPABASE_URL` | `https://enlkrucktzppkyxrljpr.supabase.co` |
| Netlify | `VITE_SUPABASE_ANON_KEY` | the project's **anon / publishable** key |
| Supabase (Edge Functions > Secrets) | `RESEND_API_KEY` | already set for enquiry alerts; reused |
| Supabase (optional) | `ALERT_FROM` | override sender, e.g. `EU-AFRIC <alerts@alerts.eatl.co.com>` |

For local work copy `portal/.env.example` to `portal/.env.local`. **Never** put the service-role key in Netlify
or in the app; Edge Functions receive it from Supabase automatically.

## 4. Configure Resend and deploy the functions

The sending domain `alerts.eatl.co.com` is already verified in Resend. Deploy the two functions:

```
supabase functions deploy send-notification-email --no-verify-jwt
supabase functions deploy admin-create-staff
```

- `send-notification-email` emails the copy of every in-app notification (registration received, approved,
  rejected, project assigned, progress update, new message, document shared/approved/rejected, invoice issued,
  payment received). A database trigger calls it. Admins can switch each type on or off in **Admin > Settings >
  Notifications**; clients can opt out under **Profile**.
- `admin-create-staff` lets a Super Administrator create staff accounts (checks the caller's role on the server).
- Password reset and email verification are sent by Supabase Auth through the SMTP you set in step 1.

## 5. Deploy on Netlify

The GitHub repo is already connected to the Netlify site `eu-africa-technologies`. Merge the
`feature/client-portal` pull request into `main` and Netlify builds and publishes automatically. Add the two
`VITE_` variables **before** merging. Use the deploy preview that Netlify builds for the pull request to check
everything first. `netlify.toml` already holds the build command, SPA rewrites and security headers.

## 6. Create the first Super Administrator

If you already sign in to the old `admin.html`, migration 001 turns every email in the `admins` table that has an
account into an active **Super Administrator**, so nothing else is needed: sign in at `/login`.

To create one from scratch: in **Authentication > Users** add the user (tick *Auto Confirm*), then run in the SQL
Editor, replacing the email:

```sql
update public.profiles set status = 'active', approved_at = now() where email = 'you@eatl.co.com';
update public.user_roles set role = 'super_admin'
  where user_id = (select id from auth.users where email = 'you@eatl.co.com');
delete from public.clients where profile_id = (select id from auth.users where email = 'you@eatl.co.com');
```

Every other staff member is created from **Admin > Settings > Staff** (they get an email to set a password).

## 7. Day-to-day: clients and projects

1. **New client registers** at `/register` and verifies their email. They appear in **Admin > Clients** as *Pending*.
2. **Approve or reject** (with a reason). The client is emailed; only approved clients can enter the portal.
   Suspend or reactivate an account at any time.
3. **Projects**: create one from **Admin > Projects** (or convert an approved request in **Requests**), pick the
   client and project manager. Ten standard milestones are created automatically; edit, add or reorder them.
   Progress is calculated from completed milestones.
4. **Updates and photos**: project managers post progress updates with photos; tick *visible to client* to show them.
5. **Documents**: upload to a client or project; clients upload requested documents; admins approve or reject with
   comments. Allowed: PDF, DOCX, XLSX, JPG, PNG.
6. **Messages**: clients and staff chat per project or in general, in real time, with attachments.
7. **Finance** (Accountants, Administrators): create and issue invoices, record payments (receipts are generated),
   view balances and the ledger, export CSV/PDF. Every change is written to the audit log.
8. **Reports** (CSV and PDF) and **Settings** (company details, notification toggles, email sender, role matrix).

### Editing website text

**Admin > Website > Page text** lets an Administrator or Super Administrator change headings and paragraphs on the
public pages. Pick a page, edit the text, press Save: it appears on eatl.co.com straight away. **Reset to original**
restores the wording that is in the page file. Plain text only; the legal pages (privacy, terms, cookies) are not editable.
How it works: editable elements carry `data-cms="key"` in the HTML, `cms.js` overrides them from the `site_content`
table, and the HTML text stays as the fallback. For new editable text on a page, add `data-cms="page.tag.N"` to a text-only
heading or paragraph (or re-run `scripts/tag-cms.py`).

### Account credit (advance deposits)

When a client pays in advance, the accountant records it under **Finance > Account credit > Record deposit**.
The money is held as a credit balance for that client (ledger account 2100, a liability). It can only be applied to
that client's own invoices (**Apply credit** on an open invoice). Reversing a credit-applied payment returns the
money to the credit balance. Clients see their balance, deposit receipts and movements under **Payments > Account credit**.
It is not a wallet: it cannot be withdrawn or transferred, and nothing is connected to a payment provider.

## Not included in this version

Online payment gateways, stored-value wallets, withdrawals and transfers. Payments and deposits are **recorded** by the accountant. Add a gateway only after the company's payment model and provider are approved.
