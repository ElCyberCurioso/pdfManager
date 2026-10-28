/* ============================================================
   STAMP — Dibujo de texto e imágenes sobre páginas existentes
   (marca de agua, numeración, firma). Trabaja en coordenadas
   visuales (ver geometry.js), así que respeta /Rotate y CropBox.
   ============================================================ */
import { PDFLib } from './libs.js';
import { pageFrame, drawTextVisual, drawImageVisual, anchorForCenter, placeBlock, hexToRgb } from './geometry.js';

const { StandardFonts, PDFArray } = PDFLib;

export const FONTS = {
  helvetica:     { label: 'Helvetica',          std: StandardFonts.Helvetica },
  helveticaBold: { label: 'Helvetica negrita',  std: StandardFonts.HelveticaBold },
  times:         { label: 'Times',              std: StandardFonts.TimesRoman },
  timesBold:     { label: 'Times negrita',      std: StandardFonts.TimesRomanBold },
  courier:       { label: 'Courier',            std: StandardFonts.Courier },
  courierBold:   { label: 'Courier negrita',    std: StandardFonts.CourierBold },
};

const fontCache = new WeakMap();

/** Incrusta (una vez por documento) una fuente estándar. */
export async function fontFor(doc, key) {
  let m = fontCache.get(doc);
  if (!m) fontCache.set(doc, (m = new Map()));
  if (!m.has(key)) m.set(key, await doc.embedFont((FONTS[key] || FONTS.helvetica).std));
  return m.get(key);
}

/**
 * Las fuentes estándar del PDF solo cubren WinAnsi (latín occidental).
 * Esta versión de pdf-lib sustituye en silencio lo que no puede
 * codificar por «?», así que lo detectamos nosotros.
 * Devuelve el primer carácter no representable, o null.
 */
export function unsupportedChar(font, text) {
  for (const ch of text) {
    if (ch === '?' || ch === '\n' || ch === '\r') continue;
    try {
      if (String(font.encodeText(ch)) === '<3F>') return ch;
    } catch {
      return ch;
    }
  }
  return null;
}

/** Tamaño de la caja envolvente de un bloque w×h girado `angle` grados. */
export function rotatedBox(w, h, angle) {
  const t = (angle * Math.PI) / 180;
  const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  return { bw: w * c + h * s, bh: w * s + h * c };
}

/** Centros (visuales) de un mosaico que cubre la página. */
function tileCenters(frame, bw, bh, gapX, gapY) {
  const stepX = bw + gapX, stepY = bh + gapY;
  const centers = [];
  let row = 0;
  for (let cy = stepY / 2; cy < frame.vh + stepY / 2; cy += stepY, row++) {
    const offset = row % 2 ? stepX / 2 : 0; // patrón «ladrillo»
    for (let cx = stepX / 2 - offset; cx < frame.vw + stepX / 2; cx += stepX) centers.push({ cx, cy });
  }
  return centers;
}

/**
 * Dibuja un texto en una posición predefinida o en mosaico.
 * @param {PDFLib.PDFPage} page
 * @param {{text:string, font:any, size:number, color?:string, opacity?:number, angle?:number,
 *          position?:string, margin?:number, tile?:boolean, align?: 'center'}} o
 */
export function stampText(page, { text, font, size, color = '#000000', opacity = 1, angle = 0, position = 'center', margin = 36, tile = false }) {
  const frame = pageFrame(page);
  const lines = String(text).split(/\r?\n/);
  const lineH = size * 1.2;
  const capH = font.heightAtSize(size, { descender: false });
  const widths = lines.map((l) => font.widthOfTextAtSize(l, size));
  const w = Math.max(...widths);
  const h = capH + lineH * (lines.length - 1);
  const { bw, bh } = rotatedBox(w, h, angle);
  const rgb = hexToRgb(color);
  const centers = tile ? tileCenters(frame, bw, bh, Math.max(size * 2, 40), Math.max(size * 2.5, 40)) : [placeBlock(frame, position, bw, bh, margin)];
  const t = (angle * Math.PI) / 180;
  const align = position.endsWith('left') ? 0 : position.endsWith('right') ? 1 : 0.5;
  for (const { cx, cy } of centers) {
    // Anclaje del bloque completo y luego cada línea hacia abajo
    const a = anchorForCenter(cx, cy, w, h, angle);
    lines.forEach((line, i) => {
      const dx = (w - widths[i]) * (tile ? 0.5 : align);
      const dy = (lines.length - 1 - i) * lineH; // la primera línea queda arriba
      const u = a.u + dx * Math.cos(t) - dy * Math.sin(t);
      const v = a.v + dx * Math.sin(t) + dy * Math.cos(t);
      drawTextVisual(page, line, { u, v, angle, size, font, color: rgb, opacity });
    });
  }
}

/**
 * Dibuja una imagen.
 * @param {{image:any, width:number, angle?:number, opacity?:number, position?:string,
 *          margin?:number, tile?:boolean, u?:number, v?:number}} o
 *   width en puntos; si se indican u/v (esquina inferior izquierda visual) se ignora position.
 */
export function stampImage(page, { image, width, angle = 0, opacity = 1, position = 'center', margin = 36, tile = false, u, v }) {
  const frame = pageFrame(page);
  const height = width * (image.height / image.width);
  if (u !== undefined && v !== undefined) {
    drawImageVisual(page, image, { u, v, width, height, angle, opacity });
    return;
  }
  const { bw, bh } = rotatedBox(width, height, angle);
  const centers = tile ? tileCenters(frame, bw, bh, bw * 0.5, bh * 0.6) : [placeBlock(frame, position, bw, bh, margin)];
  for (const { cx, cy } of centers) {
    const a = anchorForCenter(cx, cy, width, height, angle);
    drawImageVisual(page, image, { u: a.u, v: a.v, width, height, angle, opacity });
  }
}

/**
 * Lleva el último stream de contenido (lo recién dibujado) al fondo,
 * para que quede DEBAJO del contenido original de la página.
 * (pdf-lib aísla el contenido original entre q/Q y añade el nuevo al final.)
 */
export function sendLastContentToBack(page) {
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray) || contents.size() < 2) return;
  const last = contents.get(contents.size() - 1);
  contents.remove(contents.size() - 1);
  contents.insert(0, last);
}

/** Bytes de imagen → imagen incrustada (JPG/PNG directo; el resto vía PNG). */
export async function embedImageBytes(doc, bytes, kind) {
  if (kind === 'jpeg') return doc.embedJpg(bytes);
  if (kind === 'png') return doc.embedPng(bytes);
  throw new Error('Formato de imagen no admitido.');
}
