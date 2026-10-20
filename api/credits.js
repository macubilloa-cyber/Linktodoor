import {
  sbSelect, clientById, clientByName, ensureCode, creditsFor, loyaltyFor, referralOffer, applyBenefits, REFERRAL_PCT
} from './_credits.js';

/* Acciones de administrador (panel). Requieren PANEL_PASSWORD en Vercel. */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-pw');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const panelPw = process.env.PANEL_PASSWORD;
  if (!panelPw) return res.status(500).json({ ok: false, error: 'Falta la variable PANEL_PASSWORD en Vercel.' });
  if (req.headers['x-admin-pw'] !== panelPw) return res.status(401).json({ ok: false, error: 'Contraseña de panel incorrecta.' });

  const { action, client_id, client_name, carga_id, carga_client_id, charged_crc, use_credit, use_referral } = req.body || {};

  try {
    /* Al cerrar una carga: acreditar fidelidad a los clientes de esa carga */
    if (action === 'accrue_carga') {
      const lines = await sbSelect(`carga_clients?carga_id=eq.${encodeURIComponent(carga_id)}&select=client_name`);
      const names = [...new Set(lines.map(l => l.client_name))];
      const granted = [];
      for (const name of names) {
        const client = await clientByName(name);
        if (!client) continue;
        const l = await loyaltyFor(client, true);
        if (l.created) granted.push({ name: client.name, credits: l.created });
      }
      return res.status(200).json({ ok: true, granted });
    }

    /* Info para el modal de cobro */
    if (action === 'cobro_info') {
      const client = await clientByName(client_name);
      if (!client) return res.status(200).json({ ok: true, client: null });
      await loyaltyFor(client, true);
      const { balance, proxVence } = await creditsFor(client.id);
      const referral = await referralOffer(client, carga_client_id, Number(charged_crc) || 0);
      const applied = (await sbSelect(
        `client_credits?client_id=eq.${encodeURIComponent(client.id)}&origen=eq.${encodeURIComponent('cc:' + carga_client_id)}&tipo=eq.canje&select=monto_crc`
      )).reduce((s, r) => s - Number(r.monto_crc), 0);
      return res.status(200).json({ ok: true, client: { id: client.id, name: client.name }, balance, proxVence, referral, pct: REFERRAL_PCT, applied });
    }

    /* Aprobar y aplicar créditos / descuento en un cobro */
    if (action === 'apply') {
      const client = await clientById(client_id);
      if (!client) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
      const result = await applyBenefits(client, carga_client_id, Number(charged_crc) || 0, !!use_credit, !!use_referral);
      return res.status(200).json({ ok: true, ...result });
    }

    /* Resumen de beneficios de un cliente (panel → lista de clientes) */
    if (action === 'client_benefits') {
      const client = await clientById(client_id);
      if (!client) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
      const code = await ensureCode(client);
      const loyalty = await loyaltyFor(client, true);
      const credits = await creditsFor(client.id);
      const referred = await sbSelect(`referrals?referrer_id=eq.${encodeURIComponent(client.id)}&select=id`);
      return res.status(200).json({ ok: true, name: client.name, code, loyalty, referred_by: client.referred_by || null, referrals: referred.length, ...credits });
    }

    return res.status(400).json({ ok: false, error: 'Acción no válida.' });
  } catch (err) {
    console.error('[credits]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
