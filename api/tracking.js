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
    const url = `https://box2boxcr.us/api/v1/tracking/${encodeURIComponent(q)}`;
    console.log('[tracking] query:', q, '| url:', url);

    const upstream = await fetch(url, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'application/json'
      }
    });

    const rawText = await upstream.text();
    console.log('[tracking] status:', upstream.status, '| raw:', rawText.slice(0, 500));

    let data;
    try { data = JSON.parse(rawText); }
    catch { data = { _raw: rawText }; }

    /* Si Box2Box devuelve ok:true pero paquetes vacío, intentar
       buscar también por teléfono si q parece ser un tracking */
    return res.status(upstream.status).json(data);

  } catch (err) {
    console.error('[tracking] fetch error:', err.message);
    return res.status(502).json({
      ok: false,
      error: { code: 'PROVIDER_UNAVAILABLE', message: 'Servicio no disponible. Intentá de nuevo en unos minutos.' }
    });
  }
}
