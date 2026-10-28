/* ============================================================
   IMAGES — Utilidades de imagen: orientación EXIF, detección de
   formato por contenido, decodificación y codificación.
   ============================================================ */

/** Detecta el formato por la firma (magic bytes). */
export function sniffImage(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'avif';
  return null;
}

/**
 * Lee la orientación EXIF (1–8) de un JPEG. Devuelve 1 si no hay.
 * @param {Uint8Array} bytes
 */
export function jpegOrientation(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 2;
  while (off + 4 < bytes.length) {
    if (bytes[off] !== 0xff) return 1;
    const marker = bytes[off + 1];
    const len = view.getUint16(off + 2);
    if (marker === 0xe1 && len >= 8 &&
        view.getUint32(off + 4) === 0x45786966 && view.getUint16(off + 8) === 0) { // "Exif\0\0"
      const tiff = off + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const u16 = (p) => view.getUint16(p, little);
      const u32 = (p) => view.getUint32(p, little);
      if (u16(tiff + 2) !== 42) return 1;
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > bytes.length) return 1;
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) break;
        if (u16(entry) === 0x0112) {
          const v = u16(entry + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    if (marker === 0xda || marker === 0xd9) return 1; // inicio de datos / fin
    off += 2 + len;
  }
  return 1;
}

/** Dimensiones de un JPEG leyendo su marcador SOF (sin decodificar). */
export function jpegSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 2;
  while (off + 9 < bytes.length) {
    if (bytes[off] !== 0xff) return null;
    const marker = bytes[off + 1];
    const len = view.getUint16(off + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: view.getUint16(off + 5), width: view.getUint16(off + 7), components: bytes[off + 9] };
    }
    off += 2 + len;
  }
  return null;
}

/**
 * Decodifica un archivo de imagen aplicando la orientación EXIF.
 * @param {Blob} blob
 * @returns {Promise<ImageBitmap>}
 */
export function decodeImage(blob) {
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

/** Dibuja una imagen en un canvas nuevo (opcionalmente escalada y con fondo). */
export function toCanvas(source, width = source.width, height = source.height, background = null) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  const ctx = c.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/** Canvas → Uint8Array con el formato indicado. */
export async function canvasBytes(canvas, type = 'image/png', quality) {
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo codificar la imagen.'))), type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

/** ¿Tiene el canvas algún píxel no opaco? */
export function hasTransparency(canvas) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * Vuelve transparentes los píxeles casi blancos (firmas escaneadas).
 * @param {HTMLCanvasElement} canvas
 * @param {number} threshold 0–255: luminosidad a partir de la cual es fondo
 */
export function whiteToTransparent(canvas, threshold = 225) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum >= threshold) d[i + 3] = 0;
    else if (lum > threshold - 40) d[i + 3] = Math.round(d[i + 3] * (threshold - lum) / 40); // borde suave
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Recorta un canvas a la caja de sus píxeles no transparentes (+ margen). */
export function trimCanvas(canvas, pad = 4) {
  const { width, height } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null; // vacío
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/**
 * Prepara un archivo de imagen para incrustarlo en un PDF.
 * JPEG (sin rotación EXIF) y PNG se usan tal cual; el resto (WebP, GIF,
 * BMP, AVIF o JPEG girados) se convierte a PNG o JPEG con canvas.
 * @param {File|Blob} file
 * @returns {Promise<{bytes: Uint8Array, kind: 'jpeg'|'png', width: number, height: number}>}
 */
export async function prepareImage(file, { jpegQuality = 0.92 } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) throw new Error(`«${file.name || 'imagen'}» no es una imagen compatible.`);
  if (kind === 'jpeg' && jpegOrientation(bytes) === 1) {
    const s = jpegSize(bytes);
    if (s && s.components !== 4) return { bytes, kind: 'jpeg', width: s.width, height: s.height };
  }
  const bmp = await decodeImage(new Blob([bytes]));
  try {
    if (kind === 'png') return { bytes, kind: 'png', width: bmp.width, height: bmp.height };
    const canvas = toCanvas(bmp);
    const alpha = kind !== 'jpeg' && hasTransparency(canvas);
    const out = await canvasBytes(canvas, alpha ? 'image/png' : 'image/jpeg', alpha ? undefined : jpegQuality);
    return { bytes: out, kind: alpha ? 'png' : 'jpeg', width: canvas.width, height: canvas.height };
  } finally {
    bmp.close?.();
  }
}
