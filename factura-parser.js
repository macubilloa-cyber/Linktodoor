/* Lector de facturas de paquetería de AM (Am Express Asociados).
   Recibe las líneas de texto del PDF y devuelve factura + paquetes.
   Sin dependencias: corre en el navegador (panel) y en Node (pruebas). */
(function (root) {
  const AMOUNT = '(\\d{1,3}(?:[ ,.]\\d{3})*[.,]\\d{2})';

  function parseMoney(str) {
    const m = String(str).replace(/\s/g, '').match(/^(.*)[.,](\d{2})$/);
    if (!m) return NaN;
    return parseFloat(m[1].replace(/[.,]/g, '') + '.' + m[2]);
  }

  function parseAmInvoice(lines) {
    const text = lines.join('\n');

    const numero = (text.match(/Factura\s+(\d{12,})/) || [])[1] || null;
    const f = text.match(/Fecha:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    const fecha = f ? `${f[3]}-${f[2]}-${f[1]}` : null;
    const cliente = (text.match(/Cliente:\s*(.+?)\s{2,}/) || [])[1] || null;

    const totals = [...text.matchAll(new RegExp('Total:\\s*CRC\\s+' + AMOUNT, 'g'))];
    const total = totals.length ? parseMoney(totals[totals.length - 1][1]) : null;

    const lineas = [];
    let lastAmount = null;
    let pendingKind = 'flete';   // 'flete' o 'desconocido' (cargo por dirección mal escrita)
    for (let i = 0; i < lines.length; i++) {
      const fl = lines[i].match(new RegExp('Flete Miami San Jos[eé]\\s+' + AMOUNT));
      if (fl) { lastAmount = parseMoney(fl[1]); pendingKind = 'flete'; continue; }
      const dc = lines[i].match(new RegExp('Desconocidos?\\s+' + AMOUNT, 'i'));
      if (dc) { lastAmount = parseMoney(dc[1]); pendingKind = 'desconocido'; continue; }

      const head = lines[i].match(/^\s*(\d{7})\s+(.*)$/);
      if (!head) continue;

      // El bloque puede partirse en varias líneas: se junta hasta "N LBS"
      let block = head[2];
      let j = i;
      while (!/\d\s*LBS/i.test(block) && j + 1 < lines.length && !/Observaciones|Flete Miami/i.test(lines[j + 1])) {
        block += ' ' + lines[++j].trim();
      }
      const m = block.match(/^(.*?)(\d+(?:[.,]\d+)?)(?:\s+0)?\s*LBS/i);
      if (!m) continue;

      const trackings = m[1].split(/\s+/).filter(t => t.length >= 8);
      if (pendingKind === 'desconocido') {
        // El cargo "Desconocidos" repite la guía del paquete: se suma a esa línea, no es otro paquete
        const prev = lineas.find(l => l.id === head[1]);
        if (prev) prev.recargo = (prev.recargo || 0) + (lastAmount || 0);
        else lineas.push({ id: head[1], trackings, tracking: trackings[0] || '', lbs: parseFloat(m[2].replace(',', '.')), costo: 0, recargo: lastAmount || 0 });
      } else {
        lineas.push({
          id: head[1],
          trackings,
          tracking: trackings[0] || '',
          lbs: parseFloat(m[2].replace(',', '.')),
          costo: lastAmount,
          recargo: 0
        });
      }
      lastAmount = null;
      pendingKind = 'flete';
      i = j;
    }

    const suma = lineas.reduce((s, l) => s + (l.costo || 0) + (l.recargo || 0), 0);
    return {
      numero, fecha, cliente, total, lineas,
      totalLbs: lineas.reduce((s, l) => s + l.lbs, 0),
      sumaOk: total !== null && Math.abs(suma - total) < 0.5 && lineas.every(l => l.costo > 0 && l.lbs > 0 && l.tracking)
    };
  }

  /* Junta varias lecturas de la misma factura (p.ej. el mismo PDF en dos formatos) sin duplicar líneas */
  function mergeInvoices(list) {
    const byNum = new Map();
    for (const inv of list) {
      const key = inv.numero || 'sin-numero';
      if (!byNum.has(key)) { byNum.set(key, { ...inv, lineas: [...inv.lineas] }); continue; }
      const cur = byNum.get(key);
      const seen = new Set(cur.lineas.map(l => l.id));
      inv.lineas.forEach(l => { if (!seen.has(l.id)) cur.lineas.push(l); });
      cur.lineas.forEach(c => { const o = inv.lineas.find(l => l.id === c.id); if (o && (o.recargo || 0) > (c.recargo || 0)) c.recargo = o.recargo; });
      cur.total = cur.total ?? inv.total;
    }
    return [...byNum.values()].map(inv => {
      const suma = inv.lineas.reduce((s, l) => s + (l.costo || 0) + (l.recargo || 0), 0);
      return {
        ...inv,
        totalLbs: inv.lineas.reduce((s, l) => s + l.lbs, 0),
        sumaOk: inv.total !== null && Math.abs(suma - inv.total) < 0.5 && inv.lineas.every(l => l.costo > 0 && l.lbs > 0 && l.tracking)
      };
    });
  }

  /* Mensaje de la bodega consolidada (2071):  "1. TRACKING — 0.16 kg (0.35 lb)"  */
  function parseConsolidado(text) {
    const clean = String(text || '').replace(/[\u2060\u200b\u200c\u200d\ufeff\u00a0]/g, ' ');
    const num = v => parseFloat(String(v).replace(',', '.'));
    const lineas = [];
    const seen = new Set();
    const noLeidas = [];
    for (const raw of clean.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(\d+)\s*[.)\-]\s*([A-Za-z0-9]{6,})\s*[—–\-:]+\s*([\d.,]+)\s*kg\s*(?:\(\s*([\d.,]+)\s*lbs?\s*\))?/i);
      if (!m) { noLeidas.push(line); continue; }
      const kg = num(m[3]);
      const lbs = m[4] ? num(m[4]) : Math.round(kg * 2.20462 * 100) / 100;
      const key = m[2].toUpperCase();
      if (seen.has(key)) { noLeidas.push(line + '  (repetido)'); continue; }
      seen.add(key);
      lineas.push({ n: parseInt(m[1], 10), tracking: m[2], kg, lbs });
    }
    return { lineas, totalLbs: Math.round(lineas.reduce((s, l) => s + l.lbs, 0) * 100) / 100, noLeidas };
  }

  /* La consolidada cobra en medias libras, redondeando hacia arriba (0.4 → 0.5, 0.6 → 1) */
  const lbsCobradasConsolidado = lbs => Math.ceil(lbs * 2 - 1e-9) / 2;

  const api = { parseAmInvoice, mergeInvoices, parseMoney, parseConsolidado, lbsCobradasConsolidado };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FacturaAM = api;
})(typeof window !== 'undefined' ? window : globalThis);
