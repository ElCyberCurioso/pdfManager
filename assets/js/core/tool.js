/* ============================================================
   TOOL — Piezas comunes de una página de herramienta:
   ejecución de tareas con progreso, área de resultado con
   descarga (archivo o ZIP) y "Continuar con…" otra herramienta.
   ============================================================ */
import { h, clear, plural } from './dom.js';
import { icon } from './icons.js';
import { toast, setButtonLoading, formatBytes, show, hide } from './ui.js';
import { initDropZone } from './file-handler.js';
import { readFile, openPdf } from './pdf-engine.js';
import { openRender } from './render.js';
import { saveFile, MIME } from './download.js';
import { createZip } from './zip.js';
import { putHandoff } from './handoff.js';
import { TOOLS, toolUrl } from './registry.js';

/**
 * Ejecuta una tarea con el botón en modo "cargando" y gestión de errores.
 * @param {HTMLButtonElement} btn
 * @param {ReturnType<import('./ui.js').createProgress>} progress
 * @param {() => Promise<void>} fn
 */
export async function runTask(btn, progress, fn) {
  setButtonLoading(btn, true);
  progress?.show();
  try {
    await fn();
  } catch (err) {
    if (err?.name === 'PasswordCancelledError') toast('Operación cancelada.', 'info');
    else {
      console.error(err);
      toast(err?.message || String(err), 'error');
    }
  } finally {
    setButtonLoading(btn, false);
    progress?.hide();
  }
}

/** Cede el hilo principal para que la UI (barra de progreso) se repinte. */
export const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

/**
 * Área de resultado reutilizable.
 * @param {HTMLElement} el   Contenedor vacío (.result-area)
 * @param {{onRestart?: () => void}} [opts]
 */
export function createResultArea(el, { onRestart } = {}) {
  el.classList.add('result-area');
  el.hidden = true;
  el.setAttribute('aria-live', 'polite');
  const currentTool = document.body.dataset.tool;

  return {
    /**
     * @param {{title: string, meta?: string, notes?: {type: string, text: string}[],
     *          files: {name: string, data: Uint8Array|Blob, type?: string}[],
     *          zipName?: string, extra?: Node}} r
     */
    show({ title, meta = '', notes = [], files, zipName = 'resultado.zip', extra = null }) {
      clear(el);
      const single = files.length === 1;
      const totalBytes = files.reduce((s, f) => s + (f.data.byteLength ?? f.data.size ?? 0), 0);

      const downloadBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-testid': 'download' },
        icon('download'),
        single ? 'Descargar' : `Descargar ZIP (${plural(files.length, 'archivo')})`);
      downloadBtn.addEventListener('click', () => {
        if (single) saveFile(files[0].data, files[0].name, files[0].type);
        else saveFile(createZip(files.map((f) => ({ name: f.name, data: toBytesSync(f.data) }))), zipName, MIME.zip);
      });

      const actions = h('div', { class: 'result-area__actions' }, downloadBtn);

      // "Continuar con…" (solo para un único PDF)
      const isPdf = single && (files[0].type || MIME.pdf) === MIME.pdf && /\.pdf$/i.test(files[0].name);
      if (isPdf) actions.append(continueMenu(files[0], currentTool));

      el.append(
        h('div', { class: 'result-area__icon' }, icon('check', { strokeWidth: 2.5 })),
        h('h2', { class: 'result-area__title' }, title),
        h('p', { class: 'result-area__meta' },
          single ? `${files[0].name} · ${formatBytes(totalBytes)}` : `${plural(files.length, 'archivo')} · ${formatBytes(totalBytes)}`,
          meta ? ` · ${meta}` : ''),
        ...notes.map((n) => h('div', { class: `alert alert-${n.type || 'info'} result-area__note` }, icon(n.type === 'warning' ? 'warning' : 'info'), h('span', {}, n.text))),
        ...(extra ? [extra] : []),
        actions,
      );

      // Lista de archivos individuales cuando hay varios (hasta 30)
      if (!single && files.length <= 30) {
        el.append(h('details', { class: 'result-area__files' },
          h('summary', {}, 'Descargar archivos por separado'),
          h('ul', {}, files.map((f) => h('li', {},
            h('button', { type: 'button', class: 'link-btn', onclick: () => saveFile(f.data, f.name, f.type) }, f.name),
            h('span', { class: 'text-muted' }, ` · ${formatBytes(f.data.byteLength ?? f.data.size ?? 0)}`)))),
        ));
      }

      if (onRestart) {
        el.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: onRestart }, 'Empezar de nuevo'));
      }
      el.hidden = false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      downloadBtn.focus({ preventScroll: true });
    },
    hide() { el.hidden = true; clear(el); },
  };
}

function toBytesSync(data) {
  if (data instanceof Uint8Array) return data;
  throw new Error('Para el ZIP los datos deben ser Uint8Array.');
}

function continueMenu(file, currentTool) {
  const options = TOOLS.filter((t) => t.input === 'pdf' && t.id !== currentTool);
  const select = h('select', { class: 'form-select continue-select', 'aria-label': 'Continuar con otra herramienta' },
    h('option', { value: '' }, 'Continuar con…'),
    options.map((t) => h('option', { value: t.id }, t.title)),
  );
  select.addEventListener('change', async () => {
    const tool = options.find((t) => t.id === select.value);
    if (!tool) return;
    try {
      const bytes = file.data instanceof Blob ? new Uint8Array(await file.data.arrayBuffer()) : file.data;
      await putHandoff([{ name: file.name, bytes, type: MIME.pdf }]);
      location.href = `${toolUrl(tool)}#handoff`;
    } catch (err) {
      toast(`No se pudo pasar el archivo: ${err.message}`, 'error');
      select.value = '';
    }
  });
  return h('div', { class: 'continue-wrap' }, icon('arrowRight'), select);
}

/**
 * Nota estándar cuando el PDF de entrada estaba cifrado.
 */
export function encryptedInputNote(info) {
  if (!info?.encryption) return null;
  return {
    type: 'warning',
    text: info.needsUserPassword
      ? 'El PDF original tenía contraseña. El resultado se guarda SIN cifrar; usa «Proteger PDF» si quieres volver a protegerlo.'
      : 'El PDF original tenía restricciones de uso. El resultado se guarda sin ellas.',
  };
}

/**
 * Tarjeta con el archivo cargado y un botón para cambiarlo.
 * @param {File} file
 * @param {string} meta
 * @param {() => void} onChange
 */
export function fileSummary(file, meta, onChange) {
  return h('div', { class: 'file-summary', 'data-testid': 'file-summary' },
    h('div', { class: 'file-summary__icon' }, icon('file')),
    h('div', { class: 'grow' },
      h('div', { class: 'file-summary__name', title: file.name }, file.name),
      h('div', { class: 'file-summary__meta' }, meta)),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: onChange }, icon('swap'), 'Cambiar archivo'),
  );
}

/**
 * Controlador para herramientas que trabajan con UN PDF.
 * Lee el archivo, lo descifra si hace falta (pidiendo la contraseña),
 * muestra el resumen y avisa a la herramienta.
 *
 * @param {{dropZone: HTMLElement, summary: HTMLElement,
 *          onLoad: (ctx: PdfContext) => (void|Promise<void>),
 *          onReset?: () => void}} opts
 *
 * @typedef {Object} PdfContext
 * @property {File} file
 * @property {Uint8Array} bytes      Bytes (descifrados) del PDF
 * @property {import('./libs.js').PDFLib.PDFDocument} doc  Documento de solo lectura (no modificar)
 * @property {number} pageCount
 * @property {null|Object} encryption
 * @property {boolean} needsUserPassword
 * @property {() => Promise<import('./render.js').RenderDoc>} getRender
 */
export function singlePdfTool({ dropZone, summary, onLoad, onReset }) {
  let current = null;

  async function load([file]) {
    const raw = await readFile(file);
    const opened = await openPdf(raw, { fileName: file.name });
    const pageCount = opened.doc.getPageCount();
    if (!pageCount) throw new Error('El PDF no tiene páginas.');
    close();
    let renderPromise = null;
    current = {
      file,
      ...opened,
      pageCount,
      getRender: () => (renderPromise ??= openRender(opened.bytes)),
      destroy: () => renderPromise?.then((r) => r.destroy()).catch(() => {}),
    };
    const meta = [plural(pageCount, 'página'), formatBytes(file.size)];
    if (opened.encryption) meta.push(opened.needsUserPassword ? `cifrado ${opened.encryption.algorithm}` : 'con restricciones');
    summary.replaceChildren(fileSummary(file, meta.join(' · '), reset));
    show(summary);
    hide(dropZone);
    await onLoad(current);
  }

  function close() {
    current?.destroy();
    current = null;
  }

  function reset() {
    close();
    hide(summary);
    show(dropZone);
    onReset?.();
  }

  const dz = initDropZone(dropZone, { accept: 'pdf', onFiles: load });
  hide(summary);
  return {
    get current() { return current; },
    reset,
    open: dz.open,
  };
}

/** Lee el valor del radio marcado de un grupo. */
export function radioValue(name, root = document) {
  return root.querySelector(`input[name="${name}"]:checked`)?.value ?? null;
}

/** Enlaza un <input type=range> con su indicador de valor. */
export function bindRange(input, output, format = (v) => v) {
  const paint = () => { output.textContent = format(input.value); };
  input.addEventListener('input', paint);
  paint();
}

/**
 * Elementos de PageGrid para las páginas de un documento.
 * @param {() => Promise<import('./render.js').RenderDoc>} getRender
 * @param {number} count
 * @param {(i:number) => Partial<import('./page-grid.js').GridItem>} [extra]
 */
export function pageItems(getRender, count, extra = () => ({})) {
  const width = 170 * Math.min(2, window.devicePixelRatio || 1);
  return Array.from({ length: count }, (_, i) => ({
    key: `p${i}`,
    index: i,
    label: `Pág. ${i + 1}`,
    render: async (canvas) => { const r = await getRender(); await r.renderPage(i + 1, { width, canvas }); },
    ...extra(i),
  }));
}

/**
 * Paginador sencillo «‹ [n] de N ›».
 * @param {HTMLElement} el
 * @param {(index:number) => void} onChange  índice 0-based
 */
export function createPager(el, onChange) {
  let total = 1, index = 0;
  const input = h('input', { type: 'number', class: 'form-input', min: '1', value: '1', 'aria-label': 'Página' });
  const totalEl = h('span');
  const prev = h('button', { type: 'button', class: 'btn btn-outline btn-icon btn-sm', 'aria-label': 'Página anterior' }, icon('chevronLeft'));
  const next = h('button', { type: 'button', class: 'btn btn-outline btn-icon btn-sm', 'aria-label': 'Página siguiente' }, icon('chevronRight'));
  el.classList.add('pager');
  el.replaceChildren(prev, h('span', {}, 'Página'), input, totalEl, next);
  const go = (i) => {
    const n = Math.min(total - 1, Math.max(0, i));
    input.value = String(n + 1);
    prev.disabled = n === 0;
    next.disabled = n >= total - 1;
    if (n !== index) { index = n; onChange(n); }
  };
  prev.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  input.addEventListener('change', () => go((parseInt(input.value, 10) || 1) - 1));
  return {
    get index() { return index; },
    setTotal(n) { total = Math.max(1, n); totalEl.textContent = `de ${total}`; input.max = String(total); index = -1; go(0); },
    go,
  };
}
