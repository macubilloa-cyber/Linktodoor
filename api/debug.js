const SUPABASE_URL = 'https://opqyskmpdnijhvcbewkf.supabase.co';
const ANON_KEY     = 'sb_publishable_RReNHAvDRWNst2YTSnAttQ_duV1PJzL';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const keyToUse    = SERVICE_KEY || ANON_KEY;
  const h = { 'Authorization': `Bearer ${keyToUse}`, 'apikey': keyToUse };

  const results = { service_key_set: !!SERVICE_KEY, tables: {} };

  for (const table of ['saved_clients', 'cargas', 'carga_clients', 'packages', 'package_alerts']) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, { headers: h });
      const d = await r.json();
      results.tables[table] = r.ok
        ? `OK (${Array.isArray(d) ? d.length : '?'} row sample)`
        : `ERROR ${r.status}: ${JSON.stringify(d).slice(0, 120)}`;
    } catch(e) {
      results.tables[table] = 'FETCH ERROR: ' + e.message;
    }
  }

  return res.status(200).json(results);
}
