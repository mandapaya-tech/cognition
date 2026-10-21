// Worker de Cognition: sirve el sitio estático y expone POST /api/checkout.
import catalog from '../repuestos.json';
import { partnerCheckout, stripeWebhook, PartnerHub } from './partner.js';
export { PartnerHub };

const SITE = 'https://cognitionindustries.com';
const BY_ID = new Map(catalog.filter(i => typeof i.price === 'number').map(i => [i.id, i]));
const COUNTRIES = ['US','CA','MX','GT','SV','HN','NI','CR','PA','CO','VE','EC','PE','BO','CL','AR','UY','PY','BR','DO','PR','JM','TT','BS','BB','AW','CW','ES','PT','GB','FR','DE','IT','NL','BE','CH','AT','IE','SE','NO','DK','FI','PL','AU','NZ','JP','KR','SG','AE','IL','ZA'];
const MAX_LINES = 50;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// Convierte un objeto anidado a application/x-www-form-urlencoded estilo Stripe.
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}

// Valida el carrito contra precios del servidor. Nunca usa precios del cliente.
function validateCart(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('El carrito está vacío.');
  if (items.length > MAX_LINES) throw new Error('Demasiados artículos en el carrito.');
  const merged = new Map();
  for (const it of items) {
    const part = BY_ID.get(String(it?.id ?? ''));
    if (!part) throw new Error('Un repuesto del carrito no está disponible para compra en línea.');
    const qty = Math.floor(Number(it.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) throw new Error('La cantidad debe estar entre 1 y 99.');
    merged.set(part.id, Math.min(99, (merged.get(part.id) || 0) + qty));
  }
  return [...merged].map(([id, qty]) => ({ part: BY_ID.get(id), qty }));
}

// Punto de extensión para envío dinámico (p. ej. Shippo con env.SHIPPO_API_KEY).
// Debe devolver un arreglo de shipping_options de Stripe, o [] para no cobrar envío aún.
async function shippingOptions(_lines, _env) {
  return [];
}

async function createCheckout(request, env) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'Pagos no configurados.' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Solicitud inválida.' }, 400); }
  let lines;
  try { lines = validateCart(body?.items); } catch (e) { return json({ error: e.message }, 400); }

  const params = {
    mode: 'payment',
    customer_creation: 'always',
    phone_number_collection: { enabled: true },
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    success_url: `${SITE}/compra-confirmada?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/?compra=cancelada#repuestos`,
    locale: 'es',
    line_items: Object.fromEntries(lines.map(({ part, qty }, i) => [i, {
      quantity: qty,
      adjustable_quantity: { enabled: true, minimum: 1, maximum: 99 },
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(part.price * 100),
        // Precio siempre del servidor; se vincula al producto de Stripe si existe.
        ...(part.stripe_product ? { product: part.stripe_product } : {}),
        product_data: part.stripe_product ? undefined : {
          name: part.name,
          description: part.digital ? part.desc : `${part.line} · ${part.category}${part.pn ? ' · P/N ' + part.pn : ''}`,
          metadata: { catalog_id: part.id, part_number: part.pn || '', line: part.line, category: part.category, digital: part.digital ? 'true' : 'false' },
        },
      },
    }])),
    metadata: { source: 'cognition-repuestos' },
  };
  // Solo se pide dirección de envío si hay al menos un artículo físico (las gift cards son digitales).
  const physical = lines.filter(l => !l.part.digital);
  if (physical.length) {
    params.shipping_address_collection = { allowed_countries: Object.fromEntries(COUNTRIES.map((c, i) => [i, c])) };
    params.custom_text = { shipping_address: { message: 'El costo de envío se calcula y se confirma contigo después de la compra.' } };
  }
  const ship = physical.length ? await shippingOptions(physical, env) : [];
  if (ship.length) params.shipping_options = Object.fromEntries(ship.map((s, i) => [i, s]));

  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form(params),
  });
  const data = await r.json();
  if (!r.ok) { console.log('stripe_error', data?.error?.type, data?.error?.code, data?.error?.message); return json({ error: 'No pudimos iniciar el pago. Intenta de nuevo o escríbenos por WhatsApp.' }, 502); }
  return json({ url: data.url, id: data.id });
}

const maskEmail = e => {
  if (!e || !e.includes('@')) return null;
  const [u, d] = e.split('@');
  return `${u.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}`;
};

// Resumen seguro de una compra del sitio (solo sesiones creadas por /api/checkout).
async function sessionSummary(url, env) {
  const id = url.searchParams.get('id') || '';
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(id)) return json({ error: 'not_found' }, 404);
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'unavailable' }, 503);
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}?expand[]=line_items`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) return json({ error: 'not_found' }, 404);
  const s = await r.json();
  if (s.metadata?.source !== 'cognition-repuestos') return json({ error: 'not_found' }, 404);
  return json({
    order_ref: 'CI-' + id.slice(-8).toUpperCase(),
    status: s.status, payment_status: s.payment_status, currency: s.currency,
    amount_subtotal: s.amount_subtotal, amount_tax: s.total_details?.amount_tax ?? 0, amount_shipping: s.total_details?.amount_shipping ?? 0, amount_total: s.amount_total,
    items: (s.line_items?.data || []).map(l => ({ name: l.description, qty: l.quantity, amount: l.amount_total })),
    has_physical: !!s.shipping_address_collection,
    email: maskEmail(s.customer_details?.email || s.customer_email),
    created: s.created,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/partner/giftcard/checkout') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return partnerCheckout(request, env);
    }
    if (url.pathname === '/api/stripe/webhook') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return stripeWebhook(request, env);
    }
    if (url.pathname === '/api/checkout/session') {
      if (request.method !== 'GET') return json({ error: 'Método no permitido.' }, 405);
      return sessionSummary(url, env);
    }
    if (url.pathname === '/api/checkout') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
      return createCheckout(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
