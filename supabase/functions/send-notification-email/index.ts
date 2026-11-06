// Sends the email copy of an in-app notification through Resend.
// Called by the database trigger private.email_notification() with { id }.
// The caller supplies only an id: recipient, subject and content all come from the database,
// the notification is claimed atomically (emailed_at) so it can never be sent twice, and a
// per-user hourly cap limits abuse.
import { createClient } from "npm:@supabase/supabase-js@2";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

// notification type -> admin toggle key in app_settings('notifications').types
const TOGGLE: Record<string, string> = {
  registration_received: "registration_received", account_approved: "account_approved",
  account_rejected: "account_rejected", project_assigned: "project_assigned", project_update: "project_update",
  message: "new_message", document_approved: "document_approved", document_rejected: "document_rejected",
  document_shared: "document_shared", invoice_issued: "invoice_issued", payment_received: "payment_received",
};
// Accounts that are not active yet (or no longer) may still be told about their own registration outcome.
const ANY_STATUS = new Set(["registration_received", "account_rejected"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  let id = "";
  try { id = String((await req.json()).id ?? ""); } catch { /* ignore */ }
  if (!UUID.test(id)) return json({ ok: false, error: "bad id" }, 400);

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ ok: false, error: "not configured" });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Claim once: only the first call for an id proceeds.
  const { data: n } = await sb.from("notifications").update({ emailed_at: new Date().toISOString() })
    .eq("id", id).is("emailed_at", null).select("*").maybeSingle();
  if (!n) return json({ ok: true, skipped: "unknown or already handled" });

  const release = () => sb.from("notifications").update({ emailed_at: null }).eq("id", id);
  const toggle = TOGGLE[n.type];
  if (!toggle) return json({ ok: true, skipped: "type not emailed" });

  const [{ data: settings }, { data: profile }] = await Promise.all([
    sb.from("app_settings").select("key,value").in("key", ["company", "notifications", "email"]),
    sb.from("profiles").select("email,full_name,status,notification_prefs").eq("id", n.user_id).maybeSingle(),
  ]);
  const cfg = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value as Record<string, any>]));
  const notif = cfg.notifications ?? {};
  if (notif.email_enabled === false || notif.types?.[toggle] === false) return json({ ok: true, skipped: "disabled by admin" });
  if (!profile?.email) return json({ ok: true, skipped: "no recipient" });
  if (profile.notification_prefs?.email === false) return json({ ok: true, skipped: "user opted out" });
  if (profile.status !== "active" && !ANY_STATUS.has(n.type)) return json({ ok: true, skipped: "account not active" });

  // Safety cap: at most 20 emails per recipient per hour.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await sb.from("notifications").select("id", { count: "exact", head: true })
    .eq("user_id", n.user_id).gte("emailed_at", since);
  if ((count ?? 0) > 20) return json({ ok: true, skipped: "rate cap" });

  const company = cfg.company?.name || "EU-AFRIC Technologies Ltd";
  const site = String(cfg.company?.website || "https://eatl.co.com").replace(/\/+$/, "");
  const link = typeof n.link === "string" && n.link.startsWith("/") ? site + n.link : "";
  const first = String(profile.full_name || "").split(" ")[0];
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#151515;max-width:560px">
<h2 style="color:#168447;margin:0 0 4px">${esc(company)}</h2>
<p style="margin:0 0 18px;color:#667">Client portal notification</p>
<p>Hello${first ? " " + esc(first) : ""},</p>
<p style="font-size:16px"><b>${esc(n.title)}</b></p>
${n.body ? `<p style="white-space:pre-wrap">${esc(n.body)}</p>` : ""}
${link ? `<p style="margin:22px 0"><a href="${esc(link)}" style="background:#168447;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Open the portal</a></p>` : ""}
<p style="margin:24px 0 0;color:#667;font-size:12px">You receive this because you have an account with ${esc(company)}. You can change email preferences under Profile in the portal.</p></div>`;
  const text = `${n.title}\n\n${n.body ?? ""}\n\n${link ? "Open the portal: " + link : ""}\n`;

  const fromAddr = Deno.env.get("ALERT_FROM") || "EU-AFRIC Technologies <alerts@alerts.eatl.co.com>";
  const fromName = String(cfg.email?.from_name || "").replace(/[<>"\r\n]/g, "").trim();
  const from = fromName && !Deno.env.get("ALERT_FROM") ? `${fromName} <alerts@alerts.eatl.co.com>` : fromAddr;
  const body: Record<string, unknown> = {
    from, to: [profile.email], subject: String(n.title).replace(/[\r\n]+/g, " ").slice(0, 150), html, text,
  };
  const reply = String(cfg.email?.reply_to || "");
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(reply)) body.reply_to = reply;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) {
    await release(); // allow a later retry
    return json({ ok: false, status: r.status, detail: (await r.text()).slice(0, 300) });
  }
  return json({ ok: true });
});
