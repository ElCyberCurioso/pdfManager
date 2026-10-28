/* ============================================================
   UNIR PDFs
   - Reordenación por arrastre (ratón y táctil) o con botones.
   - Rango de páginas opcional por archivo ("1-3, 7").
   - Un marcador por archivo, página en blanco para dúplex y
     deduplicación de recursos repetidos (logos, fuentes).
   - Acepta PDFs cifrados (pide la contraseña).
   ============================================================ */
import '../core/app.js';
import { $, h, plural } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, createProgress, formatBytes, show, hide, toggle } from '../core/ui.js';
import { initDropZone } from '../core/file-handler.js';
import { readFile, openPdf, loadPlain, createPdf, savePdf } from '../core/pdf-engine.js';
import { openRender, enqueue } from '../core/render.js';
import { makeSortable, moveItem } from '../core/sortable.js';
import { parsePageList, PageRangeError } from '../core/ranges.js';
import { setOutline, dedupeStreams } from '../core/pdf-objects.js';
import { runTask, yieldToUI, createResultArea } from '../core/tool.js';
import { stem, sanitizeFilename } from '../core/download.js';

const dropZone  = $('#dropZone');
const listWrap  = $('#listWrap');
const listEl    = $('#fileList');
const infoEl    = $('#listInfo');
const options   = $('#options');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: clearAll });

/** @type {{id:number, file:File, bytes:Uint8Array, pageCount:number, encrypted:boolean, range:string, el?:HTMLElement}[]} */
let files = [];
let nextId = 1;

const dz = initDropZone(dropZone, { accept: 'pdf', multiple: true, onFiles: addFiles });

$('#addMoreBtn').addEventListener('click', () => dz.open());
$('#sortNameBtn').addEventListener('click', () => {
  files.sort((a, b) => a.file.name.localeCompare(b.file.name, 'es', { numeric: true, sensitivity: 'base' }));
  renderList();
});
$('#reverseBtn').addEventListener('click', () => { files.reverse(); renderList(); });
$('#clearBtn').addEventListener('click', clearAll);
runBtn.addEventListener('click', () => runTask(runBtn, progress, merge));

makeSortable(listEl, {
  itemSelector: '.file-item',
  handleSelector: '.drag-handle',
  onEnd: (from, to) => { files = moveItem(files, from, to); afterChange(); },
});

async function addFiles(newFiles) {
  for (const file of newFiles) {
    try {
      const raw = await readFile(file);
      const { doc, bytes, encryption } = await openPdf(raw, { fileName: file.name });
      files.push({ id: nextId++, file, bytes, pageCount: doc.getPageCount(), encrypted: Boolean(encryption), range: '' });
    } catch (err) {
      if (err?.name === 'PasswordCancelledError') toast(`Se omitió «${file.name}» (sin contraseña).`, 'info');
      else toast(`No se pudo leer «${file.name}»: ${err.message}`, 'error');
    }
  }
  renderList();
}

function renderList() {
  listEl.replaceChildren(...files.map(itemFor));
  afterChange();
}

function itemFor(entry) {
  if (entry.el) return entry.el;
  const thumb = h('div', { class: 'file-item__thumb' }, h('span', { class: 'spinner spinner-sm' }));
  const rangeInput = h('input', {
    class: 'form-input', type: 'text', value: entry.range, placeholder: 'Todas las páginas',
    'aria-label': `Páginas de ${entry.file.name}`, spellcheck: 'false', 'data-testid': 'range',
  });
  rangeInput.addEventListener('change', () => {
    entry.range = rangeInput.value.trim();
    validateRange(entry, rangeInput);
    afterChange();
  });

  const move = (delta) => {
    const i = files.indexOf(entry);
    const j = i + delta;
    if (j < 0 || j >= files.length) return;
    files = moveItem(files, i, j);
    renderList();
    entry.el.querySelector(`[data-move="${delta}"]`)?.focus();
  };

  entry.el = h('div', { class: 'file-item', 'data-testid': 'file-item' },
    h('span', { class: 'drag-handle', title: 'Arrastrar para reordenar', 'aria-hidden': 'true' }, icon('grip')),
    thumb,
    h('div', { class: 'file-item__info' },
      h('div', { class: 'file-item__name', title: entry.file.name }, entry.file.name),
      h('div', { class: 'file-item__meta' },
        `${plural(entry.pageCount, 'página')} · ${formatBytes(entry.file.size)}`,
        entry.encrypted ? h('span', { class: 'badge badge-warning', style: { marginLeft: '6px' } }, 'descifrado') : null),
      h('div', { class: 'file-item__extra' },
        h('label', { class: 'text-xs text-muted' }, 'Páginas:'), rangeInput),
    ),
    h('div', { class: 'file-item__actions' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'data-move': '-1', title: 'Subir', 'aria-label': `Subir ${entry.file.name}`, onclick: () => move(-1) }, icon('up')),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'data-move': '1', title: 'Bajar', 'aria-label': `Bajar ${entry.file.name}`, onclick: () => move(1) }, icon('down')),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Quitar', 'aria-label': `Quitar ${entry.file.name}`, onclick: () => remove(entry) }, icon('trash')),
    ),
  );

  // Miniatura de la primera página (en cola, para no saturar con muchos archivos)
  enqueue(async () => {
    const r = await openRender(entry.bytes);
    try {
      const c = await r.renderPage(1, { width: 88 });
      thumb.replaceChildren(c);
    } finally { r.destroy(); }
  }).promise.catch(() => thumb.replaceChildren(icon('file')));

  return entry.el;
}

function validateRange(entry, input) {
  if (!entry.range) { input.removeAttribute('aria-invalid'); return true; }
  try {
    parsePageList(entry.range, entry.pageCount);
    input.removeAttribute('aria-invalid');
    input.title = '';
    return true;
  } catch (err) {
    input.setAttribute('aria-invalid', 'true');
    input.title = err.message;
    return false;
  }
}

function remove(entry) {
  files = files.filter((f) => f !== entry);
  entry.el?.remove();
  afterChange();
}

function selectedPages(entry) {
  if (!entry.range) return Array.from({ length: entry.pageCount }, (_, i) => i);
  return parsePageList(entry.range, entry.pageCount);
}

function afterChange() {
  result.hide();
  const has = files.length > 0;
  toggle(listWrap, has);
  toggle(options, has);
  toggle(actionBar, has);
  dropZone.classList.toggle('drop-zone--compact', has);
  let total = 0;
  for (const f of files) { try { total += selectedPages(f).length; } catch { /* rango no válido */ } }
  infoEl.textContent = `${plural(files.length, 'archivo')} · ${plural(total, 'página')} en total`;
  runBtn.disabled = files.length < 2 && !(files.length === 1 && files[0].range);
  runBtn.title = runBtn.disabled ? 'Añade al menos 2 PDFs (o indica páginas de uno solo)' : '';
}

function clearAll() {
  files = [];
  listEl.replaceChildren();
  afterChange();
}

async function merge() {
  // Validación previa de rangos
  for (const f of files) {
    try { selectedPages(f); } catch (err) {
      if (err instanceof PageRangeError) throw new Error(`«${f.file.name}»: ${err.message}`);
      throw err;
    }
  }
  const withOutline = $('#optOutline').checked;
  const duplex = $('#optDuplex').checked;
  const dedupe = $('#optDedupe').checked;
  const outName = sanitizeFilename(($('#outName').value.trim() || 'unido').replace(/\.pdf$/i, '') + '.pdf');

  const out = await createPdf();
  const outline = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    progress.set((i / files.length) * 85, `Añadiendo «${f.file.name}» (${i + 1}/${files.length})…`);
    await yieldToUI();
    const src = await loadPlain(f.bytes);
    const indices = selectedPages(f);
    outline.push({ title: stem(f.file.name), pageIndex: out.getPageCount() });
    const pages = await out.copyPages(src, indices);
    pages.forEach((p) => out.addPage(p));
    if (duplex && pages.length % 2 === 1 && i < files.length - 1) {
      const { width, height } = pages[pages.length - 1].getSize();
      out.addPage([width, height]);
    }
  }
  if (withOutline && files.length > 1) setOutline(out, outline);
  let deduped = 0;
  if (dedupe) {
    progress.set(90, 'Eliminando recursos duplicados…');
    await yieldToUI();
    deduped = dedupeStreams(out);
  }
  progress.set(95, 'Guardando…');
  const bytes = await savePdf(out);
  progress.set(100, 'Listo');

  const notes = [];
  if (files.some((f) => f.encrypted)) notes.push({ type: 'warning', text: 'Algún PDF de entrada estaba protegido: el resultado se guarda sin cifrar. Usa «Proteger PDF» si lo necesitas.' });
  result.show({
    title: '¡PDFs unidos!',
    meta: [plural(out.getPageCount(), 'página'), deduped ? `${plural(deduped, 'recurso duplicado', 'recursos duplicados')} eliminados` : ''].filter(Boolean).join(' · '),
    notes,
    files: [{ name: outName, data: bytes }],
  });
  toast('PDFs unidos correctamente', 'success');
}

hide(listWrap);
hide(options);
hide(actionBar);
show(dropZone);
