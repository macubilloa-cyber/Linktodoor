/* Lógica compartida de fidelidad y referidos. El prefijo _ evita que Vercel lo exponga como ruta. */
export const SUPABASE_URL = 'https://opqyskmpdnijhvcbewkf.supabase.co';
const ANON_KEY = 'sb_publishable_RReNHAvDRWNst2YTSnAttQ_duV1PJzL';

export const RATE = 3950;
export const LBS_PER_CREDIT = 20;
export const REFERRAL_PCT = 0.10;
const EXPIRY_MONTHS = 6;

const key = () => process.env.SUPABASE_SERVICE_KEY || ANON_KEY;
const headers = () => ({ Authorization: `Bearer ${key()}`, apikey: key(), 'Content-Type': 'application/json' });
const enc = v => encodeURIComponent(String(v));

export async function sbSelect(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d;
}

export async function sbInsert(table, rows) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=representation' },
    body: JSON.stringify(rows)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d;
}

const expiry = () => { const d = new Date(); d.setMonth(d.getMonth() + EXPIRY_MONTHS); return d.toISOString(); };

/* ── Clientes ── */
export const clientById    = async id    => (await sbSelect(`saved_clients?id=eq.${enc(id)}&limit=1`))[0] || null;
export const clientByEmail = async email => (await sbSelect(`saved_clients?email=eq.${enc(email)}&limit=1`))[0] || null;
export const clientByName  = async name  => (await sbSelect(`saved_clients?name=ilike.${enc(name)}&limit=1`))[0] || null;
export const clientByCode  = async code  => (await sbSelect(`saved_clients?referral_code=eq.${enc(String(code).trim().toUpperCase())}&limit=1`))[0] || null;

function makeCode(name) {
  const base = (name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'LTD';
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 3; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return `${base}-${s}`;
}

export async function ensureCode(client) {
  if (client.referral_code) return client.referral_code;
  for (let i = 0; i < 5; i++) {
    const code = makeCode(client.name);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/saved_clients?id=eq.${enc(client.id)}&referral_code=is.null`, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ referral_code: code })
    });
    if (r.ok) { client.referral_code = code; return code; }
    if (r.status !== 409) throw new Error('No se pudo generar el código: ' + (await r.text()));
  }
  throw new Error('No se pudo generar un código único.');
}

/* ── Saldo de créditos (los positivos vencidos no cuentan) ── */
export async function creditsFor(clientId) {
  const rows = await sbSelect(`client_credits?client_id=eq.${enc(clientId)}&order=created_at.desc`);
  const now = Date.now();
  let pos = 0, neg = 0, proxVence = null;
  for (const r of rows) {
    const m = Number(r.monto_crc);
    if (m < 0) { neg += -m; continue; }
    const exp = r.expira_at ? new Date(r.expira_at).getTime() : null;
    if (exp !== null && exp <= now) continue;
    pos += m;
    if (exp !== null && (proxVence === null || exp < proxVence)) proxVence = exp;
  }
  const balance = Math.max(0, pos - neg);
  return { balance, proxVence: balance > 0 && proxVence ? new Date(proxVence).toISOString() : null, history: rows };
}

/* ── Fidelidad: 1 crédito de ₡3,950 por cada 20 lbs cobradas en cargas cerradas.
      Idempotente: crea solo la diferencia entre lo ganado y lo ya acreditado. ── */
export async function loyaltyFor(client, accrue = false) {
  const lines = await sbSelect(
    `carga_clients?select=charged_crc,cargas!inner(status)&client_name=ilike.${enc(client.name)}&cargas.status=eq.closed`
  );
  const totalLbs = Math.round(lines.reduce((s, l) => s + (Number(l.charged_crc) || 0), 0) / RATE * 100) / 100;
  const earned = Math.floor(totalLbs / LBS_PER_CREDIT);
  let created = 0;
  if (accrue) {
    const have = (await sbSelect(`client_credits?client_id=eq.${enc(client.id)}&tipo=eq.fidelidad&select=id`)).length;
    created = Math.max(0, earned - have);
    if (created) {
      await sbInsert('client_credits', Array.from({ length: created }, () => ({
        client_id: String(client.id), tipo: 'fidelidad', monto_crc: RATE,
        origen: 'fidelidad', nota: `${LBS_PER_CREDIT} lbs acumuladas`, expira_at: expiry()
      })));
    }
  }
  const into = Math.round((totalLbs - earned * LBS_PER_CREDIT) * 100) / 100;
  return { totalLbs, earned, into, toNext: Math.round((LBS_PER_CREDIT - into) * 100) / 100, created };
}

/* ── Referido: 10% en el primer envío del referido, para ambos ── */
export async function referralOffer(client, cargaClientId, chargedCrc) {
  if (!client.referred_by) return null;
  if ((await sbSelect(`referrals?referred_id=eq.${enc(client.id)}&select=id`)).length) return null;
  const first = await sbSelect(
    `carga_clients?select=id&client_name=ilike.${enc(client.name)}&order=created_at.asc&limit=1`
  );
  if (!first[0] || String(first[0].id) !== String(cargaClientId)) return null;
  const referrer = await clientByCode(client.referred_by);
  if (!referrer || String(referrer.id) === String(client.id)) return null;
  const amount = Math.round(chargedCrc * REFERRAL_PCT);
  return { referrer_id: referrer.id, referrer_name: referrer.name, discount_crc: amount, reward_crc: amount };
}

export async function applyBenefits(client, cargaClientId, chargedCrc, useCredit, useReferral) {
  const origen = `cc:${cargaClientId}`;
  const done = await sbSelect(`client_credits?client_id=eq.${enc(client.id)}&origen=eq.${enc(origen)}&tipo=eq.canje&select=id`);
  if (done.length) throw new Error('Ya se aplicó un crédito a este cobro.');

  let referralDiscount = 0;
  if (useReferral) {
    const offer = await referralOffer(client, cargaClientId, chargedCrc);
    if (!offer) throw new Error('Este cliente no tiene descuento de referido disponible para este cobro.');
    await sbInsert('referrals', {
      referrer_id: String(offer.referrer_id), referred_id: String(client.id),
      carga_client_id: String(cargaClientId), discount_crc: offer.discount_crc, reward_crc: offer.reward_crc
    });
    await sbInsert('client_credits', {
      client_id: String(offer.referrer_id), tipo: 'referido_dado', monto_crc: offer.reward_crc,
      origen: `ref:${client.id}`, nota: `Referido: ${client.name}`, expira_at: expiry()
    });
    referralDiscount = offer.discount_crc;
  }

  let creditUsed = 0;
  if (useCredit) {
    const { balance } = await creditsFor(client.id);
    creditUsed = Math.min(balance, Math.max(0, chargedCrc - referralDiscount));
    if (creditUsed > 0) {
      await sbInsert('client_credits', {
        client_id: String(client.id), tipo: 'canje', monto_crc: -creditUsed, origen, nota: 'Aplicado en cobro'
      });
    }
  }
  return { referralDiscount, creditUsed, total: chargedCrc - referralDiscount - creditUsed };
}
