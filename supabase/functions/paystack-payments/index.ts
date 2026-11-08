// Paystack payments for the client portal. Two actions, both for a signed-in, active client:
//   initialize { invoice_id }  -> creates a Paystack checkout for the invoice's outstanding balance
//   verify     { reference }   -> asks Paystack whether the client's payment succeeded and records it
// The amount is always taken from the database (never from the browser), the secret key lives only in the
// PAYSTACK_SECRET_KEY secret, and money is recorded only after Paystack confirms it (settle_online_payment).
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = new Set(["https://eatl.co.com", "https://www.eatl.co.com", "http://localhost:5173"]);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(req.headers.get("origin") ?? "") ? req.headers.get("origin")! : "https://eatl.co.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
});
const reply = (req: Request, o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^EAT-[A-Za-z0-9]{10,40}$/;

// Never throws: a timeout or network error comes back as { ok: false, network: true }.
async function paystack(path: string, key: string, body?: unknown) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch("https://api.paystack.co" + path, {
      method: body ? "POST" : "GET", signal: ctl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: r.ok, network: false, json: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, network: true, json: {} };
  } finally { clearTimeout(t); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed" }, 405);

  const key = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!key) return reply(req, { error: "Online payment is not available yet" }, 503);
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return reply(req, { error: "Not signed in" }, 401);
  const user = u.user;

  // The caller's own client record, read as the caller (row level security applies)
  const me = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data: client } = await me.from("clients").select("id").eq("profile_id", user.id).maybeSingle();
  const [{ data: roleRow }, { data: me2 }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
    admin.from("profiles").select("status").eq("id", user.id).maybeSingle(),
  ]);
  const finance = me2?.status === "active" && ["super_admin", "admin", "accountant"].includes(roleRow?.role ?? "");
  if (!client && !finance) return reply(req, { error: "Only clients can pay online" }, 403);

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return reply(req, { error: "Invalid request" }, 400); }

  const settle = async (reference: string) => {
    const v = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`, key);
    const d = v.json?.data;
    if (v.network) return { status: "network" };           // could not reach Paystack: try again later
    if (!v.ok || !d) return { status: "unknown" };
    if (d.status === "failed" || d.status === "reversed") {
      await admin.from("online_payments").update({ status: "failed" }).eq("reference", reference).eq("status", "initiated");
      return { status: "failed" };
    }
    if (d.status !== "success") return { status: String(d.status ?? "unknown") }; // e.g. abandoned / ongoing
    const { data, error } = await admin.rpc("settle_online_payment", {
      p_reference: reference, p_paystack_id: String(d.id ?? ""), p_amount_pesewas: Number(d.amount),
      p_currency: String(d.currency ?? ""), p_channel: String(d.channel ?? ""), p_fees_pesewas: Number(d.fees ?? 0),
    });
    if (error) return { status: "error" };
    return { status: data === "flagged" ? "flagged" : "success", settled: data };
  };

  if (b.action === "verify") {
    const reference = String(b.reference ?? "");
    if (!REF.test(reference)) return reply(req, { error: "Invalid reference" }, 400);
    const { data: row } = await admin.from("online_payments").select("client_id,status").eq("reference", reference).maybeSingle();
    if (!row || (!finance && row.client_id !== client?.id)) return reply(req, { error: "Payment not found" }, 404);
    if (row.status === "success") return reply(req, { status: "success", settled: "already" }); // no Paystack call needed
    return reply(req, await settle(reference));
  }

  if (b.action !== "initialize") return reply(req, { error: "Unknown action" }, 400);
  if (!client) return reply(req, { error: "Only clients can pay online" }, 403);
  const invoiceId = String(b.invoice_id ?? "");
  if (!UUID.test(invoiceId)) return reply(req, { error: "Invalid invoice" }, 400);

  const [{ data: cfg }, { data: prof }, { data: inv }] = await Promise.all([
    admin.from("paystack_config").select("*").maybeSingle(),
    admin.from("profiles").select("status,email").eq("id", user.id).maybeSingle(),
    me.from("invoices").select("id,number,total,amount_paid,status,client_id").eq("id", invoiceId).eq("client_id", client.id).maybeSingle(),
  ]);
  if (!cfg?.enabled) return reply(req, { error: "Online payment is not available yet" }, 503);
  if (prof?.status !== "active" || !prof.email) return reply(req, { error: "Account not active" }, 403);
  if (!inv || !["issued", "partially_paid", "overdue"].includes(inv.status)) return reply(req, { error: "This invoice cannot be paid online" }, 400);

  const owed = Math.round((Number(inv.total) - Number(inv.amount_paid)) * 100); // pesewas
  if (owed < 100) return reply(req, { error: "Nothing to pay" }, 400);

  // Commission (Crestonic's share) is taken from the amount settled, never added to what the client pays.
  const pct = Number(cfg.commission_percent) || 0;
  const commission = Math.round(owed * pct / 100);
  const reference = "EAT-" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const body: Record<string, unknown> = {
    email: prof.email, amount: owed, currency: "GHS", reference,
    callback_url: "https://eatl.co.com/portal/payments?ref=" + reference,
    metadata: { invoice: inv.number, client_id: client.id, custom_fields: [{ display_name: "Invoice", variable_name: "invoice", value: inv.number }] },
  };
  if (cfg.subaccount_code) {
    body.subaccount = cfg.subaccount_code;
    body.bearer = cfg.fee_bearer;
    if (commission > 0) body.transaction_charge = commission; // flat amount to the main (Crestonic) account
  }
  // Limit unfinished attempts so the button cannot be used to flood Paystack or the table
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count: recent } = await admin.from("online_payments").select("id", { count: "exact", head: true })
    .eq("client_id", client.id).gte("created_at", since);
  if ((recent ?? 0) >= 8) return reply(req, { error: "Too many attempts. Please try again in a while." }, 429);
  const { error: ie } = await admin.from("online_payments").insert({
    reference, invoice_id: inv.id, client_id: client.id, amount: owed / 100, commission_percent: pct, commission: commission / 100, initiated_by: user.id,
  });
  if (ie) return reply(req, { error: "Could not start the payment" }, 500);
  const r = await paystack("/transaction/initialize", key, body);
  const link = r.json?.data?.authorization_url;
  // Only ever send the browser to Paystack's own checkout
  if (!r.ok || typeof link !== "string" || !link.startsWith("https://checkout.paystack.com/")) {
    await admin.from("online_payments").update({ status: "failed" }).eq("reference", reference);
    return reply(req, { error: r.network ? "Could not reach Paystack. Please try again." : "Paystack could not start the payment" }, 502);
  }
  return reply(req, { authorization_url: link, reference });
});
