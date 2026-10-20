import { verifyUser, clientByEmail, ensureCode, creditsFor, loyaltyFor, sbSelect, LBS_PER_CREDIT } from './_credits.js';

/* Beneficios del cliente que inició sesión en el portal (fidelidad + referidos). */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Sesión inválida.' });

  try {
    const client = await clientByEmail(user.email);
    if (!client) return res.status(200).json({ ok: true, client: null });
    const code = await ensureCode(client);
    const loyalty = await loyaltyFor(client, true);
    const credits = await creditsFor(client.id);
    const referred = await sbSelect(`referrals?referrer_id=eq.${encodeURIComponent(client.id)}&select=id`);
    return res.status(200).json({
      ok: true, code, loyalty, lbsPerCredit: LBS_PER_CREDIT, referrals: referred.length,
      balance: credits.balance, proxVence: credits.proxVence,
      history: credits.history.slice(0, 20).map(h => ({ tipo: h.tipo, monto_crc: h.monto_crc, nota: h.nota, created_at: h.created_at, expira_at: h.expira_at }))
    });
  } catch (err) {
    console.error('[benefits]', err.message);
    return res.status(500).json({ ok: false, error: 'No se pudieron cargar los beneficios.' });
  }
}
