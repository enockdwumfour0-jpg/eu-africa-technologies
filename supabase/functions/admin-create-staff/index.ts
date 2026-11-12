// Creates a staff account. A Super Administrator may create any role; an Administrator may create
// any role except Super Administrator.
// The role is written to app_metadata (service role only), where the signup trigger picks it up,
// so a user can never choose or change their own role. The new person then gets a password-setup email.
import { createClient } from "npm:@supabase/supabase-js@2";

const ROLES = new Set(["super_admin", "admin", "project_manager", "accountant", "support_officer"]);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ORIGINS = new Set(["https://eatl.co.com", "https://www.eatl.co.com", "http://localhost:5173"]);

const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(req.headers.get("origin") ?? "") ? req.headers.get("origin")! : "https://eatl.co.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const reply = (req: Request, o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // 1. Who is calling? Verify the JWT, then check the role in the database (never trust the client).
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u, error: ue } = await sb.auth.getUser(token);
  if (ue || !u?.user) return reply(req, { error: "Not signed in" }, 401);
  const [{ data: role }, { data: prof }] = await Promise.all([
    sb.from("user_roles").select("role").eq("user_id", u.user.id).maybeSingle(),
    sb.from("profiles").select("status").eq("id", u.user.id).maybeSingle(),
  ]);
  const caller = role?.role ?? "";
  if (!["super_admin", "admin"].includes(caller) || prof?.status !== "active") return reply(req, { error: "Only an Administrator can create staff accounts" }, 403);

  // 2. Validate input.
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return reply(req, { error: "Invalid request" }, 400); }
  const full_name = String(b.full_name ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 120);
  const email = String(b.email ?? "").trim().toLowerCase();
  const newRole = String(b.role ?? "");
  // Position / job title is free text and has no effect on permissions (the role does).
  const job_title = String(b.job_title ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
  if (!full_name) return reply(req, { error: "Full name is required" }, 400);
  if (!EMAIL.test(email) || email.length > 254) return reply(req, { error: "Enter a valid email address" }, 400);
  if (!ROLES.has(newRole)) return reply(req, { error: "Invalid role" }, 400);
  if (caller === "admin" && newRole === "super_admin") {
    return reply(req, { error: "Only a Super Administrator can create a Super Administrator" }, 403);
  }

  // 3. Create the confirmed account with its role.
  const { data: created, error: ce } = await sb.auth.admin.createUser({
    email, email_confirm: true,
    user_metadata: { full_name },
    app_metadata: { provisioned_role: newRole },
  });
  if (ce || !created?.user) {
    const taken = /already|registered|exists/i.test(ce?.message ?? "");
    return reply(req, { error: taken ? "An account with this email already exists" : "Could not create the account" }, taken ? 409 : 500);
  }

  // The profile row is created by the signup trigger; record the position on it (service role, so the guard allows it).
  if (job_title) await sb.from("profiles").update({ job_title }).eq("id", created.user.id);

  // 4. Let them choose their own password.
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
  const { error: re } = await anon.auth.resetPasswordForEmail(email, { redirectTo: "https://eatl.co.com/reset-password" });
  return reply(req, { ok: true, user_id: created.user.id, email_sent: !re });
});
