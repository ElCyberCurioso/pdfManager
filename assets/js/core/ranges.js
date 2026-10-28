/* ============================================================
   RANGES — Interpretación de rangos de páginas escritos por el
   usuario. Módulo puro (sin DOM): se prueba con node --test.

   Sintaxis admitida (1-based, separadores "," o ";"):
     5        una página
     1-3      rango cerrado (también con – o —)
     8-       desde la 8 hasta la última
     -3       desde la 1 hasta la 3
     pares    páginas pares        (solo en parsePageList)
     impares  páginas impares      (solo en parsePageList)
     todas    todas las páginas    (solo en parsePageList)
   ============================================================ */

export class PageRangeError extends Error {
  constructor(message) { super(message); this.name = 'PageRangeError'; }
}

function parseToken(token, total) {
  const t = token.replace(/\s+/g, '');
  const m = t.match(/^(\d*)([-–—])?(\d*)$/);
  if (!m || (!m[1] && !m[3])) {
    throw new PageRangeError(`"${token}" no es un rango válido. Usa por ejemplo 1-3, 5 u 8-.`);
  }
  const hasDash = Boolean(m[2]);
  const from = m[1] ? parseInt(m[1], 10) : 1;
  const to   = hasDash ? (m[3] ? parseInt(m[3], 10) : total) : from;
  if (from < 1 || to < 1) throw new PageRangeError(`"${token}": las páginas empiezan en 1.`);
  if (from > total || to > total) throw new PageRangeError(`"${token}" se sale del documento (tiene ${total} página${total === 1 ? '' : 's'}).`);
  if (from > to) throw new PageRangeError(`"${token}": el inicio es mayor que el final.`);
  return [from, to];
}

function tokens(input) {
  return String(input ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Convierte "1-3, 5, 8-" en grupos de índices 0-based: [[0,1,2],[4],[7,8,9]].
 * Cada token produce un grupo (útil para "un archivo por rango").
 */
export function parseRanges(input, total) {
  if (!Number.isInteger(total) || total < 1) throw new PageRangeError('El documento no tiene páginas.');
  const parts = tokens(input);
  if (!parts.length) throw new PageRangeError('Introduce al menos un rango de páginas.');
  return parts.map((tok) => {
    const [from, to] = parseToken(tok, total);
    return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  });
}

/**
 * Convierte una selección en una lista ordenada y sin duplicados de índices 0-based.
 * Admite además las palabras clave: todas, pares, impares.
 */
export function parsePageList(input, total) {
  if (!Number.isInteger(total) || total < 1) throw new PageRangeError('El documento no tiene páginas.');
  const parts = tokens(input);
  if (!parts.length) throw new PageRangeError('Indica qué páginas quieres usar.');
  const set = new Set();
  for (const tok of parts) {
    const key = tok.toLowerCase();
    if (key === 'todas' || key === 'all') { for (let i = 0; i < total; i++) set.add(i); continue; }
    if (key === 'pares' || key === 'even') { for (let i = 1; i < total; i += 2) set.add(i); continue; }
    if (key === 'impares' || key === 'odd') { for (let i = 0; i < total; i += 2) set.add(i); continue; }
    const [from, to] = parseToken(tok, total);
    for (let p = from; p <= to; p++) set.add(p - 1);
  }
  return [...set].sort((a, b) => a - b);
}

/** Representación compacta: [0,1,2,4,7,8] → "1-3, 5, 8-9". */
export function formatPageList(indices) {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) end = sorted[++i];
    out.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
  }
  return out.join(', ');
}

/** Divide n páginas en bloques de `size`: chunk(7, 3) → [[0,1,2],[3,4,5],[6]]. */
export function chunkPages(total, size) {
  if (!Number.isInteger(size) || size < 1) throw new PageRangeError('El tamaño de bloque debe ser al menos 1.');
  const chunks = [];
  for (let i = 0; i < total; i += size) {
    chunks.push(Array.from({ length: Math.min(size, total - i) }, (_, k) => i + k));
  }
  return chunks;
}
