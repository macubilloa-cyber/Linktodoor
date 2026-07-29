const SYSTEM = `Sos el asistente virtual de Linktodoor, un servicio de casillero en Miami para clientes en Costa Rica. Respondés en español, de forma corta y amigable (máximo 3-4 oraciones por respuesta). Si la pregunta es muy específica o requiere atención personalizada, invitás a escribir al WhatsApp: +506 8517-3813.

INFORMACIÓN DEL SERVICIO:

Precio: ₡3,950 por libra. Sin cargos ocultos ni recargos extra.

Días de entrega: Martes y viernes en San José.

Modalidades:
- Flash (Bodega 5414): 3 días hábiles desde que llega a Miami.
- Consolidado (Bodega 2071): ~5 días hábiles. Ideal para múltiples paquetes.

Bodega Consolidada (2071):
  Nombre: UNILTD [nombre del cliente]
  Apellido: [apellido]
  Dirección: 2071 NW 112th Ave Ste 107
  Suite/Apto: Internacional Logistics EB6888
  Ciudad: Miami, FL 33172-6538
  Teléfono bodega: 786-694-4285

Bodega Flash (5414):
  Nombre: [nombre del cliente]
  Apellido: AM
  Dirección: 5414 NW 79 Ave
  Suite/Apto: AM 2708
  Ciudad: Doral, FL 33166
  Teléfono bodega: 786-331-8418

Cómo funciona:
- Opción A: El cliente manda el link de lo que quiere comprar y Linktodoor hace la compra (sin tarjeta ni cuenta en EE.UU.).
- Opción B: El cliente compra con su tarjeta y envía a la dirección de la bodega.

Restricciones: No se pueden traer productos inflamables, aerosoles, perfumes con alcohol, baterías de litio sueltas, armas ni medicamentos controlados. Para dudas específicas sobre un artículo, recomendar escribir al WhatsApp.

Rastreo: En linktodoor.co, sección "Rastrear paquete", elegir la bodega correspondiente.

Registro: Gratis en linktodoor.co, sección "Registrarse".

Contacto: WhatsApp +506 8517-3813 · Instagram @linktodoor.

TONO: Amigable, costarricense, breve. Usás "vos". No usás emojis en exceso. Si no sabés algo con certeza, decís que lo consulten al WhatsApp.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'Chatbot no configurado.' });

  const { message, history = [] } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'Mensaje vacío.' });

  const messages = [
    ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message.trim() }
  ];

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: SYSTEM,
        messages
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Error del servicio.' });

    return res.status(200).json({ reply: data.content?.[0]?.text || '' });
  } catch (err) {
    console.error('[chat]', err.message);
    return res.status(502).json({ error: 'No se pudo conectar. Intentá de nuevo.' });
  }
}
