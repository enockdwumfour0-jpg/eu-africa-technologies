// Paystack webhook. Trusts nothing in the payload: checks the HMAC signature, then re-verifies the
// transaction with Paystack and records it through settle_online_payment (idempotent).
import { createClient } from "npm:@supabase/supabase-js@2";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const REF = /^EAT-[A-Za-z0-9]{10,40}$/;
const ok = (o: unknown = { ok: true }, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok({ ok: false }, 405);
  const key = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!key) return ok({ ok: false }, 503);
  const raw = await req.text();
  if (raw.length > 100_000) return ok({ ok: false }, 413);
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(raw)));
  const got = req.headers.get("x-paystack-signature") ?? "";
  let diff = expected.length ^ got.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
  if (diff !== 0) return ok({ ok: false }, 401);

  let ev: any = {};
  try { ev = JSON.parse(raw); } catch { return ok({ ok: false }, 400); }
  if (ev.event !== "charge.success") return ok({ ok: true, ignored: true });
  const reference = String(ev.data?.reference ?? "");
  if (!REF.test(reference)) return ok({ ok: true, ignored: true }); // not one of ours

  let v: Response; let d: any;
  try {
    v = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    d = (await v.json().catch(() => ({})))?.data;
  } catch { return ok({ ok: false }, 502); } // network problem: Paystack will retry the webhook
  if (!v.ok || d?.status !== "success") return ok({ ok: false }, 502); // Paystack will retry
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { error } = await admin.rpc("settle_online_payment", {
    p_reference: reference, p_paystack_id: String(d.id ?? ""), p_amount_pesewas: Number(d.amount),
    p_currency: String(d.currency ?? ""), p_channel: String(d.channel ?? ""), p_fees_pesewas: Number(d.fees ?? 0),
  });
  if (error) return ok({ ok: false }, 500);
  return ok();
});
