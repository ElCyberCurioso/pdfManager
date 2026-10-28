/* ============================================================
   OPTIMIZE — Reducción de tamaño de PDFs.
   1) Sin pérdida: elimina objetos huérfanos, miniaturas y datos
      privados de aplicaciones, deduplica streams, comprime los
      streams sin filtro y usa object streams.
   2) Imágenes: recomprime las imágenes incrustadas (JPEG y
      bitmaps Flate en RGB/gris) a la calidad y resolución
      elegidas. El texto y los vectores NO se tocan.
   ============================================================ */
import { PDFLib } from './libs.js';
import { N, removeUnreachable, dedupeStreams } from './pdf-objects.js';
import { jpegSize } from './images.js';

const { PDFRawStream, PDFDict, PDFArray, PDFRef, PDFNumber, PDFBool, decodePDFRawStream } = PDFLib;

/** Comprime bytes con zlib (FlateDecode) usando la API nativa del navegador. */
export async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const filtersOf = (dict) => {
  const f = dict.lookup(N('Filter'));
  if (!f) return [];
  if (f instanceof PDFArray) return f.asArray().map((x) => String(x));
  return [String(f)];
};

const isImage = (obj) => obj instanceof PDFRawStream && obj.dict.get(N('Subtype')) === N('Image');

/** Inventario rápido de imágenes del documento. */
export function imageStats(doc) {
  let count = 0, bytes = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (isImage(obj)) { count++; bytes += obj.contents.length; }
  }
  return { count, bytes };
}

// ---- Paso sin pérdida -------------------------------------------
/**
 * @param {PDFLib.PDFDocument} doc
 * @param {{stripMetadata?: boolean}} opts
 * @returns {Promise<{removed:number, deduped:number, deflated:number}>}
 */
export async function losslessPass(doc, { stripMetadata = false } = {}) {
  const ctx = doc.context;
  // Miniaturas incrustadas y datos privados de aplicaciones (Illustrator, etc.)
  for (const page of doc.getPages()) {
    page.node.delete(N('Thumb'));
    page.node.delete(N('PieceInfo'));
  }
  doc.catalog.delete(N('PieceInfo'));
  if (stripMetadata) stripAllMetadata(doc);

  const removed = removeUnreachable(doc);
  const deduped = dedupeStreams(doc);

  // Streams sin compresión (frecuentes en PDFs de algunos generadores)
  let deflated = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(N('Filter')) || obj.contents.length < 512) continue;
    if (obj.dict.get(N('Type')) === N('Metadata')) continue; // el XMP se deja legible
    const packed = await deflate(obj.contents);
    if (packed.length < obj.contents.length * 0.95) {
      const dict = obj.dict.clone(ctx);
      dict.set(N('Filter'), N('FlateDecode'));
      dict.delete(N('DecodeParms'));
      ctx.assign(ref, PDFRawStream.of(dict, packed));
      deflated++;
    }
  }
  return { removed, deduped, deflated };
}

/** Quita /Info, XMP del catálogo y de las páginas. */
export function stripAllMetadata(doc) {
  const ctx = doc.context;
  if (ctx.trailerInfo.Info) delete ctx.trailerInfo.Info;
  doc.catalog.delete(N('Metadata'));
  for (const page of doc.getPages()) page.node.delete(N('Metadata'));
  // pdf-lib escribe TODOS los objetos del contexto, aunque nadie los
  // referencie: sin esto, el /Info y el XMP seguirían dentro del archivo.
  removeUnreachable(doc);
}

// ---- Recompresión de imágenes -------------------------------------
/**
 * @param {PDFLib.PDFDocument} doc
 * @param {{quality:number, maxDpi:number, onProgress?:(done:number,total:number)=>void}} opts
 * @returns {Promise<{total:number, recompressed:number, before:number, after:number, skipped:Object}>}
 */
export async function recompressImages(doc, { quality, maxDpi, onProgress }) {
  const ctx = doc.context;
  // Lado máximo de página en pulgadas → límite de píxeles. Conservador:
  // una imagen nunca necesita más resolución que la página entera.
  const maxSideIn = Math.max(...doc.getPages().map((p) => { const { width, height } = p.getSize(); return Math.max(width, height) / 72; }), 1);
  const maxPx = Math.max(64, Math.round(maxDpi * maxSideIn));

  // Imágenes usadas como máscara: no se tocan (deben seguir en gris y sin pérdida).
  const masks = new Set();
  const images = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!isImage(obj)) continue;
    images.push([ref, obj]);
    for (const k of ['SMask', 'Mask']) {
      const m = obj.dict.get(N(k));
      if (m instanceof PDFRef) masks.add(m.tag);
    }
  }

  const stats = { total: images.length, recompressed: 0, before: 0, after: 0, skipped: {} };
  const skip = (reason) => { stats.skipped[reason] = (stats.skipped[reason] || 0) + 1; };

  for (let i = 0; i < images.length; i++) {
    const [ref, stream] = images[i];
    onProgress?.(i, images.length);
    if (masks.has(ref.tag)) { skip('máscara'); continue; }
    try {
      const res = await recompressOne(ctx, stream, { quality, maxPx });
      if (!res) { skip('no compatible'); continue; }
      if (res.bytes.length >= stream.contents.length * 0.92) { skip('ya optimizada'); continue; }
      stats.before += stream.contents.length;
      stats.after += res.bytes.length;
      ctx.assign(ref, PDFRawStream.of(res.dict, res.bytes));
      stats.recompressed++;
    } catch (err) {
      console.warn('No se pudo recomprimir una imagen:', err);
      skip('error');
    }
  }
  onProgress?.(images.length, images.length);
  return stats;
}

/** Nº de componentes de un espacio de color simple, o null si no se admite. */
function colorComponents(ctx, cs) {
  if (cs === N('DeviceRGB')) return 3;
  if (cs === N('DeviceGray')) return 1;
  const arr = cs instanceof PDFRef ? ctx.lookup(cs) : cs;
  if (arr instanceof PDFArray && arr.get(0) === N('ICCBased')) {
    const icc = ctx.lookup(arr.get(1));
    const n = icc?.dict?.lookup(N('N'));
    if (n instanceof PDFNumber && (n.asNumber() === 3 || n.asNumber() === 1)) return n.asNumber();
  }
  return null;
}

async function recompressOne(ctx, stream, { quality, maxPx }) {
  const d = stream.dict;
  if (d.lookup(N('ImageMask')) === PDFBool.True) return null;
  if (d.get(N('Decode'))) return null;
  const width = d.lookup(N('Width'))?.asNumber?.();
  const height = d.lookup(N('Height'))?.asNumber?.();
  if (!width || !height || width * height < 40_000) return null; // muy pequeña: no compensa

  const filters = filtersOf(d);
  const cs = d.get(N('ColorSpace'));
  const comps = colorComponents(ctx, cs);
  let bitmap;

  if (filters.length === 1 && filters[0] === '/DCTDecode') {
    const info = jpegSize(stream.contents);
    if (!info || info.components === 4) return null; // CMYK: se omite
    // imageOrientation 'none': los visores de PDF ignoran la orientación EXIF.
    bitmap = await createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }), { imageOrientation: 'none' });
  } else if (filters.every((f) => f === '/FlateDecode') && filters.length <= 1) {
    const bpc = d.lookup(N('BitsPerComponent'))?.asNumber?.();
    if (bpc !== 8 || !comps) return null;
    let raw = filters.length ? decodePDFRawStream(stream).decode() : stream.contents;
    const parms = d.lookup(N('DecodeParms'));
    if (parms instanceof PDFDict) {
      const pred = parms.lookup(N('Predictor'))?.asNumber?.() ?? 1;
      if (pred >= 10) raw = unpredictPng(raw, comps, width);
      else if (pred !== 1) return null; // TIFF predictor: poco común, se omite
    }
    if (raw.length < width * height * comps) return null;
    bitmap = rawToCanvas(raw, width, height, comps);
  } else {
    return null; // JPX, JBIG2, CCITT, LZW…: se dejan como están
  }

  const scale = Math.min(1, maxPx / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const hgt = Math.max(1, Math.round(height * scale));
  const canvas = makeCanvas(w, hgt);
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, w, hgt);
  bitmap.close?.();
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
    : await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const dict = d.clone(ctx);
  for (const k of ['Filter', 'DecodeParms', 'Length', 'Decode']) dict.delete(N(k));
  dict.set(N('Filter'), N('DCTDecode'));
  dict.set(N('Width'), PDFNumber.of(w));
  dict.set(N('Height'), PDFNumber.of(hgt));
  dict.set(N('BitsPerComponent'), PDFNumber.of(8));
  // El canvas siempre produce JPEG en color: las imágenes en gris pasan a RGB.
  if (comps !== 3) dict.set(N('ColorSpace'), N('DeviceRGB'));
  return { dict, bytes };
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rawToCanvas(raw, width, height, comps) {
  const canvas = makeCanvas(width, height);
  const g = canvas.getContext('2d');
  const img = g.createImageData(width, height);
  const out = img.data;
  for (let i = 0, p = 0; i < width * height; i++, p += comps) {
    const o = i * 4;
    if (comps === 3) { out[o] = raw[p]; out[o + 1] = raw[p + 1]; out[o + 2] = raw[p + 2]; }
    else { out[o] = out[o + 1] = out[o + 2] = raw[p]; }
    out[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Deshace el predictor PNG (Predictor ≥ 10) de un stream Flate.
 * Cada fila va precedida de un byte con el tipo de filtro (0–4).
 */
export function unpredictPng(data, colors, columns, bpc = 8) {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      switch (type) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: break;
      }
      cur[i] = v & 0xff;
    }
    prev = cur;
  }
  return out;
}
