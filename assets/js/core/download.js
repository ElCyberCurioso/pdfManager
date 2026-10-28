/* ============================================================
   DOWNLOAD — Descarga de resultados y nombres de archivo.
   ============================================================ */

export const MIME = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  txt: 'text/plain;charset=utf-8',
  json: 'application/json',
};

/**
 * Descarga bytes o un Blob con el nombre indicado.
 * @param {Uint8Array|Blob} data
 * @param {string} filename
 * @param {string} [type]
 */
export function saveFile(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || guessType(filename) });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename);
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function guessType(name) {
  const ext = name.split('.').pop().toLowerCase();
  return MIME[ext === 'jpeg' ? 'jpg' : ext] || 'application/octet-stream';
}

/** Quita caracteres no válidos en nombres de archivo de Windows/macOS/Linux. */
export function sanitizeFilename(name) {
  const clean = String(name)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 180);
  return clean || 'documento';
}

/** "informe.pdf" → "informe" */
export function stem(name) {
  return String(name || 'documento').replace(/\.[a-z0-9]{1,5}$/i, '') || 'documento';
}

/** Construye un nombre: buildName('informe.pdf', '_rotado') → 'informe_rotado.pdf' */
export function buildName(originalName, suffix = '', ext = 'pdf') {
  return sanitizeFilename(`${stem(originalName)}${suffix}.${ext}`);
}
