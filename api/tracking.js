export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = (req.query.q || '').trim();
  if (!q) {
    return res.status(400).json({
      ok: false,
      error: { code: 'INVALID_QUERY', message: 'Ingresá un número de rastreo, código B2B o teléfono.' }
    });
  }

  const API_KEY = process.env.BOX2BOX_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({
      ok: false,
      error: { code: 'CONFIG_ERROR', message: 'Configuración incompleta. Contactá a Linktodoor.' }
    });
  }

  try {
    const upstream = await fetch(
      `https://box2boxcr.us/api/v1/tracking/${encodeURIComponent(q)}`,
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          Accept: 'application/json'
        }
      }
    );

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch {
    return res.status(502).json({
      ok: false,
      error: { code: 'PROVIDER_UNAVAILABLE', message: 'Servicio no disponible. Intentá de nuevo en unos minutos.' }
    });
  }
}
