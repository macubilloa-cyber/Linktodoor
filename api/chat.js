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

REGLAS DE COBRO POR BODEGA (MUY IMPORTANTE — aplicar siempre):

Bodega 2071 CONSOLIDADA:
- Se cobra en medias libras. Se redondea AL ALZA a la media libra más cercana.
- Ejemplos: 0.1→0.5, 0.3→0.5, 0.4→0.5, 0.5→0.5, 0.6→1.0, 0.9→1.0, 1.1→1.5, 1.4→1.5, 1.6→2.0
- Costo = libras redondeadas × ₡3,950

Bodega 5414 FLASH:
- Se cobra la libra COMPLETA siempre, sin importar los gramos.
- Ejemplos: 0.4→1, 0.9→1, 1.1→2, 1.5→2, 2.0→2
- Costo = libras redondeadas ARRIBA × ₡3,950

Si el cliente no especifica la bodega, preguntale cuál va a usar antes de dar la cotización.

COTIZACIÓN DE PRODUCTOS (cuando el cliente manda un link o pregunta el precio):
- Si se logró obtener información del producto desde el link, usá esos datos para la cotización.
- Si el producto pesa en onzas: dividí entre 16 para convertir a libras.
- Si el producto pesa en gramos: dividí entre 453.6 para convertir a libras.
- Si el producto pesa en kg: multiplicá por 2.205 para convertir a libras.
- Aplicá la regla de redondeo según la bodega y calculá el total.
- Siempre aclarás que es una ESTIMACIÓN y el peso real puede variar según el empaque.
- Si NO se encontró el peso en el link, pedile al cliente que en la página del producto busque la sección "Product details" (Amazon) o "Detalles del producto", y te diga el campo "Item Weight" o "Peso del artículo".
- Ejemplo de respuesta (2071): "Tu producto pesa 0.4 lbs. En la bodega consolidada, redondeamos a media libra → ₡1,975. ¿Querés que te ayude con el pedido?"
- Ejemplo de respuesta (Flash): "Tu producto pesa 0.4 lbs. En Flash cobramos la libra completa → ₡3,950. ¿Querés que te ayude con el pedido?"

TONO: Amigable, costarricense, breve. Usás "vos". No usás emojis en exceso. Si no sabés algo con certeza, decís que lo consulten al WhatsApp.`;

/* ── URL detection ── */
function extractURL(text) {
  const m = text.match(/https?:\/\/[^\s]+/);
  return m ? m[0] : null;
}

/* ── Fetch product info from a URL ── */
async function fetchProductInfo(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-419,es;q=0.9,en;q=0.8'
      }
    });
    clearTimeout(timer);

    if (!r.ok) return { url, blocked: true };

    const html = await r.text();

    // Title
    const titleM = html.match(/<title[^>]*>([^<]{1,250})<\/title>/i);
    const rawTitle = titleM ? titleM[1].replace(/\s*[-|:]\s*Amazon.*$/i, '').replace(/\s*[-|:]\s*Shein.*$/i, '').trim() : null;

    // Weight patterns — English and Spanish
    const weightPatterns = [
      /Item Weight[\s\S]{0,30}?([0-9]+[.,]?[0-9]*)\s*(pounds?|lbs?)/i,
      /Item Weight[\s\S]{0,30}?([0-9]+[.,]?[0-9]*)\s*(ounces?|oz)/i,
      /Item Weight[\s\S]{0,30}?([0-9]+[.,]?[0-9]*)\s*(kilograms?|kg)/i,
      /Item Weight[\s\S]{0,30}?([0-9]+[.,]?[0-9]*)\s*(grams?|g)\b/i,
      /Peso del artículo[\s\S]{0,30}?([0-9]+[.,]?[0-9]*)\s*(libras?|lbs?)/i,
      /Peso del artículo[\s\S]{0,30}?([0-9]+[.,]?[0-9]*)\s*(gramos?|g)\b/i,
      /"weight"\s*:\s*"([0-9]+[.,]?[0-9]*)\s*(pounds?|lbs?|oz|ounces?|kg|g)"/i,
      /product-weight[^>]*>([0-9]+[.,]?[0-9]*)\s*(lbs?|oz|kg|g|pounds?|ounces?|grams?|kilograms?)/i,
    ];

    let weightRaw = null, weightUnit = null;
    for (const pat of weightPatterns) {
      const m = html.match(pat);
      if (m) { weightRaw = parseFloat(m[1].replace(',', '.')); weightUnit = m[2].toLowerCase(); break; }
    }

    // Convert to lbs
    let weightLbs = null;
    if (weightRaw !== null) {
      if (/oz|ounce/.test(weightUnit))          weightLbs = weightRaw / 16;
      else if (/kg|kilogram/.test(weightUnit))  weightLbs = weightRaw * 2.20462;
      else if (/^g$|gram/.test(weightUnit))     weightLbs = weightRaw / 453.592;
      else                                       weightLbs = weightRaw; // already lbs
    }

    return {
      url,
      title: rawTitle,
      weightLbs: weightLbs !== null ? Math.round(weightLbs * 100) / 100 : null,
      weightDisplay: weightRaw !== null ? `${weightRaw} ${weightUnit}` : null,
      blocked: false
    };
  } catch (e) {
    return { url, blocked: true, error: e.message };
  }
}

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

  let userContent = message.trim();
  let productContext = '';

  // Detect and fetch URL if present
  const url = extractURL(userContent);
  if (url) {
    const info = await fetchProductInfo(url);
    if (info.blocked) {
      productContext = `\n\n[El cliente compartió este link: ${url}. No se pudo acceder al contenido de la página (bloqueado o sin respuesta). Pedile al cliente que busque la sección "Product details" o "Detalles del producto" en la página y te diga el "Item Weight" o "Peso del artículo".]`;
    } else if (info.weightLbs !== null) {
      const lbs = info.weightLbs;
      const lbs2071  = Math.ceil(lbs * 2) / 2;          // redondeo a media libra
      const lbs5414  = Math.ceil(lbs);                   // libra completa
      const costo2071 = Math.round(lbs2071 * 3950).toLocaleString('es-CR');
      const costo5414 = Math.round(lbs5414 * 3950).toLocaleString('es-CR');
      productContext = `\n\n[Información del producto del link:\n- Título: ${info.title || 'No disponible'}\n- Peso real: ${info.weightDisplay} = ${lbs} libras\n- Bodega 2071 (Consolidada): cobra ${lbs2071} lbs → ₡${costo2071}\n- Bodega 5414 (Flash): cobra ${lbs5414} lbs → ₡${costo5414}\nSi el cliente no especificó la bodega, preguntale cuál va a usar y dá el precio correspondiente.]`;
    } else {
      productContext = `\n\n[El cliente compartió este link: ${url}. Título encontrado: "${info.title || 'no disponible'}". No se encontró el peso del producto en la página. Pedile al cliente que en la sección "Product details" de Amazon busque "Item Weight" y te lo diga para calcular el flete.]`;
    }
  }

  const messages = [
    ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent + productContext }
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
        max_tokens: 400,
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
