// Pagos de gift cards para socio revendedor (sin nombre del socio en Stripe).
// Auth HMAC-SHA256: firma = hex(HMAC(secret, timestamp + '.' + rawBody)), ventana 5 min.

const enc = new TextEncoder();
const AMOUNTS = { 50: 'gcp-50', 75: 'gcp-75', 100: 'gcp-100', 200: 'gcp-200', 300: 'gcp-300', 500: 'gcp-500' };
const ALLOWED = Object.keys(AMOUNTS).map(Number);
const WINDOW_S = 300;
const BACKOFF_S = [30, 120, 600, 1800, 7200, 21600, 43200, 86400]; // ~2.8 días en total

export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
export const signPartner = (secret, ts, body) => hmacHex(secret, `${ts}.${body}`);

async function verifyPartner(request, env, raw) {
  const pid = request.headers.get('x-partner-id'), ts = request.headers.get('x-timestamp'), sig = (request.headers.get('x-signature') || '').toLowerCase();
  if (!env.PARTNER_HMAC_SECRET || !env.PARTNER_ID) return 'no_config';
  if (!safeEqual(pid || '', env.PARTNER_ID)) return 'bad_partner';
  const t = Number(ts);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > WINDOW_S) return 'bad_timestamp';
  return safeEqual(await signPartner(env.PARTNER_HMAC_SECRET, ts, raw), sig) ? null : 'bad_signature';
}

function allowedUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && (x.hostname === 'mandapaya.app' || x.hostname.endsWith('.mandapaya.app')); } catch { return false; }
}

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
export async function stripe(env, method, path, params, idem) {
  const headers = { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (params) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (idem) headers['idempotency-key'] = idem;
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers, body: params ? form(params) : undefined });
  return { ok: r.ok, status: r.status, data: await r.json() };
}
const hub = env => env.PARTNER_HUB.get(env.PARTNER_HUB.idFromName('main'));

// POST /api/partner/giftcard/checkout
export async function partnerCheckout(request, env) {
  const raw = await request.text();
  const err = await verifyPartner(request, env, raw);
  if (err) return json({ error: 'unauthorized' }, err === 'no_config' ? 503 : 401);
  let b; try { b = JSON.parse(raw); } catch { return json({ error: 'invalid_json' }, 400); }
  const amount = Number(b.amount);
  if (!AMOUNTS[amount]) return json({ error: 'invalid_amount', allowed: ALLOWED }, 400);
  // sku opcional: si viene debe ser gcp-<amount>.
  if (b.sku != null && b.sku !== '' && String(b.sku) !== AMOUNTS[amount]) return json({ error: 'sku_mismatch', expected: AMOUNTS[amount] }, 400);
  const price = env[`GC_PRICE_${amount}`];
  if (!price) return json({ error: 'amount_not_configured', amount }, 503);
  if (String(b.currency || '').toLowerCase() !== 'usd') return json({ error: 'invalid_currency' }, 400);
  const ext = String(b.external_order_id || '');
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(ext)) return json({ error: 'invalid_external_order_id' }, 400);
  const email = String(b.buyer_email || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'invalid_buyer_email' }, 400);
  // success_url / cancel_url opcionales: si se omiten, el comprador vuelve a las páginas de Cognition.
  if (b.success_url == null || b.success_url === '') b.success_url = 'https://cognitionindustries.com/compra-confirmada?session_id={CHECKOUT_SESSION_ID}';
  else if (!allowedUrl(b.success_url)) return json({ error: 'url_not_allowed' }, 400);
  if (b.cancel_url == null || b.cancel_url === '') b.cancel_url = 'https://cognitionindustries.com/compra-cancelada?session_id={CHECKOUT_SESSION_ID}';
  else if (!allowedUrl(b.cancel_url)) return json({ error: 'url_not_allowed' }, 400);

  const h = hub(env);
  const prev = await (await h.fetch('https://hub/order/get', { method: 'POST', body: JSON.stringify({ ext }) })).json();
  if (prev?.session_id) {
    if (prev.amount !== amount) return json({ error: 'external_order_id_conflict' }, 409);
    const s = await stripe(env, 'GET', `checkout/sessions/${prev.session_id}`);
    if (s.ok && s.data.status === 'open') return json({ checkout_url: s.data.url, session_id: s.data.id, internal_id: prev.internal_id, expires_at: new Date(s.data.expires_at * 1000).toISOString() });
    if (s.ok && s.data.status === 'complete') return json({ error: 'order_already_paid', session_id: prev.session_id, internal_id: prev.internal_id }, 409);
  }
  const internal_id = 'gc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const meta = { internal_id, external_order_id: ext };
  const s = await stripe(env, 'POST', 'checkout/sessions', {
    mode: 'payment',
    customer_email: email,
    customer_creation: 'always',
    line_items: { 0: { price, quantity: 1 } },
    success_url: b.success_url, cancel_url: b.cancel_url,
    metadata: meta, payment_intent_data: { metadata: meta },
    adaptive_pricing: { enabled: false },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }, `gcp-${ext}-${internal_id}`);
  if (!s.ok) { console.log('partner_stripe_error', s.data?.error?.code, s.data?.error?.message); return json({ error: 'stripe_error' }, 502); }
  await h.fetch('https://hub/order/put', { method: 'POST', body: JSON.stringify({ ext, session_id: s.data.id, internal_id, amount }) });
  return json({ checkout_url: s.data.url, session_id: s.data.id, internal_id, expires_at: new Date(s.data.expires_at * 1000).toISOString() });
}

// Verificación de firma de Stripe (Stripe-Signature: t=...,v1=...)
async function verifyStripe(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')).map(([k, ...v]) => [k, v.join('=')]));
  const v1s = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > WINDOW_S) return false;
  const exp = await hmacHex(secret, `${t}.${raw}`);
  return v1s.some(v => safeEqual(v, exp));
}

// POST /api/stripe/webhook
export async function stripeWebhook(request, env) {
  const raw = await request.text();
  if (!(await verifyStripe(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) return json({ error: 'bad_signature' }, 400);
  const ev = JSON.parse(raw);
  const o = ev.data?.object || {};
  // Compras del sitio: asegurar que Stripe envíe el recibo al comprador.
  if (ev.type === 'checkout.session.completed' && o.metadata?.source === 'cognition-repuestos') {
    const email = o.customer_details?.email || o.customer_email;
    if (o.payment_intent && email) {
      const u = await stripe(env, 'POST', `payment_intents/${o.payment_intent}`, { receipt_email: email }, `receipt-${ev.id}`);
      if (!u.ok) { console.log('receipt_email_error', u.data?.error?.code); return json({ error: 'retry' }, 500); }
    }
    // Guardar la dirección de envío en el cliente de Stripe (futuras facturas y soporte).
    const sd = o.collected_information?.shipping_details || o.shipping_details;
    if (o.customer && sd?.address) {
      const c = await stripe(env, 'POST', `customers/${o.customer}`, { shipping: { name: sd.name || 'Cliente', address: sd.address, phone: o.customer_details?.phone || undefined } }, `ship-${ev.id}`);
      if (!c.ok) console.log('customer_shipping_error', c.data?.error?.code);
    }
    return json({ received: true, receipt: !!email });
  }
  let meta = o.metadata || {}, amount = null, currency = null, status = null, name = null;
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.expired') {
    name = ev.type === 'checkout.session.completed' ? 'payment.completed' : 'checkout.expired';
    status = ev.type === 'checkout.session.completed' ? (o.payment_status === 'paid' ? 'paid' : o.payment_status) : 'expired';
    amount = o.amount_total; currency = o.currency;
  } else if (ev.type === 'charge.refunded' || ev.type === 'charge.dispute.created') {
    if (o.payment_intent) { const pi = await stripe(env, 'GET', `payment_intents/${o.payment_intent}`); if (pi.ok) meta = pi.data.metadata || {}; }
    if (ev.type === 'charge.refunded') { name = 'payment.refunded'; status = o.refunded ? 'refunded' : 'partially_refunded'; amount = o.amount_refunded; }
    else { name = 'payment.disputed'; status = o.status || 'needs_response'; amount = o.amount; }
    currency = o.currency;
  } else return json({ received: true, ignored: ev.type });
  if (!String(meta.internal_id || '').startsWith('gc_')) return json({ received: true, ignored: 'not_partner' });
  const payload = { event: name, external_order_id: meta.external_order_id, internal_id: meta.internal_id, status, amount: amount != null ? amount / 100 : null, currency, gift_card_code: null, occurred_at: new Date((ev.created || Date.now() / 1000) * 1000).toISOString() };
  await hub(env).fetch('https://hub/outbox/add', { method: 'POST', body: JSON.stringify({ event_id: ev.id, payload }) });
  return json({ received: true });
}

// Durable Object: pedidos (idempotencia por external_order_id) y bandeja de salida con reintentos.
export class PartnerHub {
  constructor(state, env) {
    this.state = state; this.env = env; this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS orders(ext TEXT PRIMARY KEY, session_id TEXT, internal_id TEXT, amount INTEGER, created INTEGER);
      CREATE TABLE IF NOT EXISTS outbox(event_id TEXT PRIMARY KEY, payload TEXT, attempts INTEGER DEFAULT 0, next_at INTEGER, status TEXT DEFAULT 'pending', last_error TEXT, created INTEGER)`);
  }
  async fetch(req) {
    const p = new URL(req.url).pathname, b = await req.json().catch(() => ({}));
    if (p === '/order/get') return json(this.sql.exec('SELECT * FROM orders WHERE ext=?', b.ext).toArray()[0] || null);
    if (p === '/order/put') { this.sql.exec('INSERT OR REPLACE INTO orders VALUES(?,?,?,?,?)', b.ext, b.session_id, b.internal_id, b.amount, Date.now()); return json({ ok: true }); }
    if (p === '/outbox/add') {
      const dup = this.sql.exec('SELECT 1 FROM outbox WHERE event_id=?', b.event_id).toArray().length;
      if (!dup) { this.sql.exec('INSERT INTO outbox(event_id,payload,next_at,created) VALUES(?,?,?,?)', b.event_id, JSON.stringify(b.payload), Date.now(), Date.now()); await this.deliver(); }
      return json({ ok: true, duplicate: !!dup });
    }
    if (p === '/outbox/stats') return json(this.sql.exec('SELECT status, COUNT(*) n FROM outbox GROUP BY status').toArray());
    return json({ error: 'not_found' }, 404);
  }
  async alarm() { await this.deliver(); }
  async deliver() {
    const now = Date.now();
    const url = this.env.PARTNER_WEBHOOK_URL, secret = this.env.PARTNER_HMAC_SECRET;
    for (const row of this.sql.exec("SELECT * FROM outbox WHERE status='pending' AND next_at<=? ORDER BY created LIMIT 20", now).toArray()) {
      let ok = false, errMsg = 'PARTNER_WEBHOOK_URL no configurada';
      if (url) {
        try {
          const ts = String(Math.floor(Date.now() / 1000));
          const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-partner-id': this.env.PARTNER_ID, 'x-timestamp': ts, 'x-signature': await signPartner(secret, ts, row.payload), 'x-event-id': row.event_id }, body: row.payload });
          ok = r.status >= 200 && r.status < 300; errMsg = ok ? null : `HTTP ${r.status}`;
        } catch (e) { errMsg = String(e).slice(0, 200); }
      }
      const attempts = row.attempts + 1;
      if (ok) this.sql.exec("UPDATE outbox SET status='delivered', attempts=?, last_error=NULL WHERE event_id=?", attempts, row.event_id);
      else if (attempts > BACKOFF_S.length) this.sql.exec("UPDATE outbox SET status='failed', attempts=?, last_error=? WHERE event_id=?", attempts, errMsg, row.event_id);
      else this.sql.exec('UPDATE outbox SET attempts=?, next_at=?, last_error=? WHERE event_id=?', attempts, now + BACKOFF_S[attempts - 1] * 1000, errMsg, row.event_id);
    }
    const next = this.sql.exec("SELECT MIN(next_at) m FROM outbox WHERE status='pending'").toArray()[0]?.m;
    if (next) await this.state.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }
}
