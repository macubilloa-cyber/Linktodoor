const SUPABASE_URL = 'https://opqyskmpdnijhvcbewkf.supabase.co';
const ANON_KEY     = 'sb_publishable_RReNHAvDRWNst2YTSnAttQ_duV1PJzL';

export default async function handler(req, res) {
  const key = process.env.SUPABASE_SERVICE_KEY || ANON_KEY;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/saved_clients?select=id&limit=1`, {
      headers: { 'Authorization': `Bearer ${key}`, 'apikey': key }
    });
    const ok = r.ok || r.status === 406;
    console.log('[keep-alive] Supabase ping:', r.status);
    return res.status(200).json({ ok, status: r.status, ts: new Date().toISOString() });
  } catch (e) {
    console.error('[keep-alive] error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
