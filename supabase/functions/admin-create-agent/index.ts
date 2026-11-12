// Creates an agent / broker account. Super Administrators and Administrators may call it.
// The role goes into app_metadata (service role only) so the signup trigger assigns it and also creates the
// agent record with a referral code. The new agent then gets a password-setup email.
import { createClient } from "npm:@supabase/supabase-js@2";

const TYPES = new Set(["real_estate_agent", "broker", "agent", "other"]);
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
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);

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
  if (!["super_admin", "admin"].includes(role?.role ?? "") || prof?.status !== "active") {
    return reply(req, { error: "Only an Administrator can create agent accounts" }, 403);
  }

  // 2. Validate input.
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return reply(req, { error: "Invalid request" }, 400); }
  const full_name = clean(b.full_name, 120);
  const email = String(b.email ?? "").trim().toLowerCase();
  const phone = clean(b.phone, 40);
  const agency = clean(b.agency, 160);
  const agent_type = String(b.agent_type ?? "agent");
  const rate = Number(b.default_rate ?? 5);
  if (!full_name) return reply(req, { error: "Full name is required" }, 400);
  if (!EMAIL.test(email) || email.length > 254) return reply(req, { error: "Enter a valid email address" }, 400);
  if (!TYPES.has(agent_type)) return reply(req, { error: "Invalid agent type" }, 400);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return reply(req, { error: "Commission rate must be between 0 and 100" }, 400);

  // 3. Create the confirmed account with the agent role.
  const { data: created, error: ce } = await sb.auth.admin.createUser({
    email, email_confirm: true,
    user_metadata: { full_name, phone: phone || undefined },
    app_metadata: { provisioned_role: "agent" },
  });
  if (ce || !created?.user) {
    const taken = /already|registered|exists/i.test(ce?.message ?? "");
    return reply(req, { error: taken ? "An account with this email already exists" : "Could not create the account" }, taken ? 409 : 500);
  }

  // The signup trigger created the profile and the agent row (with its referral code); fill in the details.
  const { error: ae } = await sb.from("agents").update({ agent_type, agency: agency || null, default_rate: Math.round(rate * 100) / 100 }).eq("user_id", created.user.id);

  // 4. Let them choose their own password.
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
  const { error: re } = await anon.auth.resetPasswordForEmail(email, { redirectTo: "https://eatl.co.com/reset-password" });
  return reply(req, { ok: true, user_id: created.user.id, email_sent: !re, details_saved: !ae });
});
