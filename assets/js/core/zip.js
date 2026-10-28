/* ============================================================
   ZIP — Escritor ZIP mínimo (método STORE, sin compresión).
   Los PDF/PNG/JPG ya van comprimidos, así que almacenar es más
   rápido y apenas pierde tamaño. Nombres en UTF-8 (bit 11).
   Sin dependencias externas.
   ============================================================ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Evita nombres duplicados dentro del ZIP: a.pdf, a (2).pdf, … */
export function uniqueName(name, used) {
  if (!used.has(name)) { used.add(name); return name; }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
}

/**
 * Crea un ZIP.
 * @param {{name: string, data: Uint8Array}[]} entries
 * @returns {Uint8Array}
 */
export function createZip(entries, date = new Date()) {
  const enc = new TextEncoder();
  const { time, date: dosDate } = dosDateTime(date);
  const used = new Set();
  const records = entries.map(({ name, data }) => {
    const nameBytes = enc.encode(uniqueName(name.replace(/[\\]/g, '/').replace(/^\/+/, ''), used));
    return { nameBytes, data, crc: crc32(data) };
  });

  const localSize = records.reduce((s, r) => s + 30 + r.nameBytes.length + r.data.length, 0);
  const centralSize = records.reduce((s, r) => s + 46 + r.nameBytes.length, 0);
  if (localSize + centralSize + 22 > 0xffffffff || records.length > 0xffff) {
    throw new Error('El ZIP resultante es demasiado grande (límite de 4 GB).');
  }

  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let off = 0;
  const offsets = [];

  for (const r of records) {
    offsets.push(off);
    view.setUint32(off, 0x04034b50, true);       // firma local
    view.setUint16(off + 4, 20, true);           // versión necesaria
    view.setUint16(off + 6, 0x0800, true);       // flags: UTF-8
    view.setUint16(off + 8, 0, true);            // método: STORE
    view.setUint16(off + 10, time, true);
    view.setUint16(off + 12, dosDate, true);
    view.setUint32(off + 14, r.crc, true);
    view.setUint32(off + 18, r.data.length, true);
    view.setUint32(off + 22, r.data.length, true);
    view.setUint16(off + 26, r.nameBytes.length, true);
    view.setUint16(off + 28, 0, true);
    out.set(r.nameBytes, off + 30);
    out.set(r.data, off + 30 + r.nameBytes.length);
    off += 30 + r.nameBytes.length + r.data.length;
  }

  const centralStart = off;
  records.forEach((r, i) => {
    view.setUint32(off, 0x02014b50, true);       // firma central
    view.setUint16(off + 4, 20, true);           // versión creadora
    view.setUint16(off + 6, 20, true);
    view.setUint16(off + 8, 0x0800, true);
    view.setUint16(off + 10, 0, true);
    view.setUint16(off + 12, time, true);
    view.setUint16(off + 14, dosDate, true);
    view.setUint32(off + 16, r.crc, true);
    view.setUint32(off + 20, r.data.length, true);
    view.setUint32(off + 24, r.data.length, true);
    view.setUint16(off + 28, r.nameBytes.length, true);
    view.setUint16(off + 30, 0, true);           // extra
    view.setUint16(off + 32, 0, true);           // comentario
    view.setUint16(off + 34, 0, true);           // disco
    view.setUint16(off + 36, 0, true);           // atributos internos
    view.setUint32(off + 38, 0, true);           // atributos externos
    view.setUint32(off + 42, offsets[i], true);
    out.set(r.nameBytes, off + 46);
    off += 46 + r.nameBytes.length;
  });

  view.setUint32(off, 0x06054b50, true);         // fin del directorio central
  view.setUint16(off + 4, 0, true);
  view.setUint16(off + 6, 0, true);
  view.setUint16(off + 8, records.length, true);
  view.setUint16(off + 10, records.length, true);
  view.setUint32(off + 12, off - centralStart, true);
  view.setUint32(off + 16, centralStart, true);
  view.setUint16(off + 20, 0, true);
  return out;
}
