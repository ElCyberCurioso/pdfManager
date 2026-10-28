/* ============================================================
   FILE HANDLER — Zona de arrastre, selector, pegar (Ctrl+V) y
   recepción de archivos desde otra herramienta ("handoff").
   La validación de PDFs se hace por contenido (cabecera %PDF-),
   no solo por extensión o tipo MIME.
   ============================================================ */
import { toast } from './ui.js';
import { looksLikePdf } from './pdf-engine.js';
import { takeHandoff } from './handoff.js';
import { formatBytes } from './ui.js';

export const MAX_SIZE = 300 * 1024 * 1024; // 300 MB

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

export const ACCEPT = {
  pdf:   { attr: '.pdf,application/pdf', label: 'PDF' },
  image: { attr: 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif', label: 'imagen' },
  any:   { attr: '', label: 'archivo' },
};

/**
 * Valida un archivo. Devuelve un mensaje de error o null.
 * @param {File} file
 * @param {'pdf'|'image'|'any'} accept
 */
export async function validateFile(file, accept) {
  if (file.size === 0) return `«${file.name}» está vacío.`;
  if (file.size > MAX_SIZE) return `«${file.name}» supera el límite de ${formatBytes(MAX_SIZE)}.`;
  if (accept === 'pdf') {
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    if (!looksLikePdf(head)) return `«${file.name}» no es un PDF.`;
  } else if (accept === 'image') {
    if (!(file.type.startsWith('image/') || IMAGE_EXT.test(file.name))) return `«${file.name}» no es una imagen compatible.`;
  }
  return null;
}

/**
 * Conecta una zona de arrastre.
 * @param {HTMLElement} zone   Elemento .drop-zone (con un <input type=file> dentro)
 * @param {{accept?: 'pdf'|'image'|'any', multiple?: boolean,
 *          onFiles: (files: File[]) => void|Promise<void>,
 *          primary?: boolean}} opts
 *   primary: zona principal de la página (recibe archivos soltados en cualquier
 *            parte, Ctrl+V y archivos de otras herramientas). Solo una por página.
 * @returns {{open: () => void, handle: (files: File[]) => Promise<void>}}
 */
export function initDropZone(zone, { accept = 'pdf', multiple = false, onFiles, primary = true }) {
  const input = zone.querySelector('input[type="file"]');
  input.accept = ACCEPT[accept].attr;
  input.multiple = multiple;
  if (!input.getAttribute('aria-label')) {
    input.setAttribute('aria-label', multiple ? `Seleccionar archivos (${ACCEPT[accept].label})` : `Seleccionar ${ACCEPT[accept].label}`);
  }

  let busy = false;
  async function handle(fileList, source = 'drop') {
    const files = Array.from(fileList || []);
    if (!files.length || busy) return;
    busy = true;
    try {
      const valid = [];
      for (const f of files) {
        const err = await validateFile(f, accept);
        if (err) toast(err, 'error');
        else valid.push(f);
      }
      if (!valid.length) return;
      if (!multiple && valid.length > 1 && source !== 'handoff') {
        toast(`Esta herramienta trabaja con un archivo: se usará «${valid[0].name}».`, 'info');
      }
      await onFiles(multiple ? valid : [valid[0]]);
    } catch (err) {
      if (err?.name === 'PasswordCancelledError') toast('No se abrió el archivo: contraseña cancelada.', 'info');
      else { console.error(err); toast(err?.message || String(err), 'error'); }
    } finally {
      busy = false;
    }
  }

  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    input.value = ''; // permite volver a elegir el mismo archivo
    handle(files, 'picker');
  });

  // Arrastre sobre la zona
  let depth = 0;
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; zone.classList.add('drag-over'); });
  zone.addEventListener('dragover',  (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  zone.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; zone.classList.remove('drag-over'); } });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    zone.classList.remove('drag-over');
    handle(e.dataTransfer.files);
  });

  // Evita que soltar un archivo fuera de la zona abra el PDF en la pestaña
  // (y perder el trabajo); en su lugar lo procesamos igualmente.
  if (primary) {
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); document.body.classList.add('file-drag'); }
    });
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('file-drag'); });
    window.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      document.body.classList.remove('file-drag');
      handle(e.dataTransfer.files);
    });

    // Pegar archivos con Ctrl+V
    window.addEventListener('paste', (e) => {
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) { e.preventDefault(); handle(files, 'paste'); }
    });
  }

  // Archivos enviados desde otra herramienta
  if (primary && location.hash === '#handoff') {
    history.replaceState(null, '', location.pathname + location.search);
    takeHandoff().then((files) => {
      if (files.length) handle(files, 'handoff');
      else toast('El archivo enviado ya no está disponible. Vuelve a seleccionarlo.', 'warning');
    });
  }

  return { open: () => input.click(), handle };
}
