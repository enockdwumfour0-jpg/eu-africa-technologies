// Deletes an account. Body: { user_id?: string }. Omit user_id to delete your own (clients only).
// Super Administrator: may delete anyone except themselves/another Super Administrator.
// Administrator: may delete clients, agents and non-admin staff.
// Personal data is erased in the database (public.erase_account); financial records are kept anonymised.
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = new Set(["https://eatl.co.com", "https://www.eatl.co.com", "http://localhost:5173"]);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(req.headers.get("origin") ?? "") ? req.headers.get("origin")! : "https://eatl.co.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const reply = (req: Request, o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u, error: ue } = await sb.auth.getUser(token);
  if (ue || !u?.user) return reply(req, { error: "Not signed in" }, 401);
  const me = u.user.id;

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty body = self */ }
  const target = b.user_id ? String(b.user_id) : me;
  if (!UUID.test(target)) return reply(req, { error: "Invalid account" }, 400);

  const roleOf = async (id: string) => (await sb.from("user_roles").select("role").eq("user_id", id).maybeSingle()).data?.role ?? "client";
  const callerRole = await roleOf(me);
  const targetRole = await roleOf(target);

  if (target === me) {
    // Own account: clients only. Staff and agents are removed by an administrator.
    if (callerRole !== "client") return reply(req, { error: "Staff and agent accounts are removed by an Administrator" }, 403);
  } else {
    const { data: prof } = await sb.from("profiles").select("status, deleted_at").eq("id", me).maybeSingle();
    if (!["super_admin", "admin"].includes(callerRole) || prof?.status !== "active") return reply(req, { error: "Not allowed" }, 403);
    if (targetRole === "super_admin") return reply(req, { error: "The Super Administrator account cannot be deleted" }, 403);
    if (callerRole === "admin" && targetRole === "admin") return reply(req, { error: "Only the Super Administrator can delete an Administrator" }, 403);
  }

  const { data: before } = await sb.from("profiles").select("avatar_path").eq("id", target).maybeSingle();
  const { error: re } = await sb.rpc("erase_account", { p_user: target });
  if (re) return reply(req, { error: re.message.replace(/^.*?: /, "") }, 409);

  // Remove stored files (avatar and message attachments) — best effort.
  try {
    if (before?.avatar_path) await sb.storage.from("avatars").remove([before.avatar_path]);
  } catch { /* ignore */ }

  // Remove the sign-in. If history still references the user, ban and rename instead so they can never sign in.
  const del = await sb.auth.admin.deleteUser(target);
  if (del.error) {
    await sb.auth.admin.updateUserById(target, {
      email: `deleted-${target}@deleted.invalid`, ban_duration: "876000h",
      user_metadata: {}, app_metadata: { deleted: true },
    });
  }
  return reply(req, { ok: true, signed_out: target === me });
});
