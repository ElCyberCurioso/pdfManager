/* ============================================================
   DIVIDIR PDF
   Modos: por rangos, cada N páginas, extraer páginas
   seleccionadas (en uno o varios PDFs) y por marcadores.
   ============================================================ */
import '../core/app.js';
import { $, $$, h, plural } from '../core/dom.js';
import { toast, createProgress, toggle } from '../core/ui.js';
import { loadPlain, createPdf, savePdf } from '../core/pdf-engine.js';
import { parseRanges, parsePageList, chunkPages, formatPageList } from '../core/ranges.js';
import { readOutline } from '../core/pdf-objects.js';
import { PageGrid } from '../core/page-grid.js';
import { singlePdfTool, runTask, yieldToUI, createResultArea, radioValue, pageItems, encryptedInputNote } from '../core/tool.js';
import { stem, sanitizeFilename } from '../core/download.js';

const options    = $('#options');
const actionBar  = $('#actionBar');
const runBtn     = $('#runBtn');
const preview    = $('#planPreview');
const progress   = createProgress($('#progress'));
const result     = createResultArea($('#result'), { onRestart: () => tool.reset() });

const rangesInput = $('#rangesInput');
const everyInput  = $('#everyInput');
const pickInput   = $('#pickInput');
const bmList      = $('#bookmarkList');

let grid = null;
let outline = [];

const tool = singlePdfTool({
  dropZone: $('#dropZone'),
  summary: $('#fileSummary'),
  onLoad,
  onReset,
});

$$('input[name="mode"]').forEach((r) => r.addEventListener('change', syncMode));
[rangesInput, everyInput, pickInput, $('#pickSeparate')].forEach((el) => el.addEventListener('input', updatePlan));
pickInput.addEventListener('change', () => {
  try { grid?.selectIndices(parsePageList(pickInput.value, tool.current.pageCount)); } catch { /* el plan muestra el error */ }
});
$('#selAll').addEventListener('click', () => grid?.selectAll(true));
$('#selNone').addEventListener('click', () => grid?.selectAll(false));
$('#selInvert').addEventListener('click', () => grid?.invertSelection());
runBtn.addEventListener('click', () => runTask(runBtn, progress, split));

async function onLoad(ctx) {
  result.hide();
  outline = readOutline(ctx.doc).filter((o) => o.pageIndex >= 0);
  const bmRadio = $('input[name="mode"][value="bookmarks"]');
  bmRadio.disabled = outline.length === 0;
  bmRadio.closest('.choice').title = outline.length ? '' : 'Este PDF no tiene marcadores';
  if (bmRadio.disabled && bmRadio.checked) $('input[name="mode"][value="ranges"]').checked = true;
  bmList.replaceChildren(...outline.map((o) => h('li', {}, `${o.title} `, h('span', { class: 'text-muted' }, `(pág. ${o.pageIndex + 1})`))));

  everyInput.max = String(ctx.pageCount);
  if (!rangesInput.value) rangesInput.value = ctx.pageCount > 1 ? `1-${Math.ceil(ctx.pageCount / 2)}, ${Math.ceil(ctx.pageCount / 2) + 1}-` : '1';

  grid?.destroy();
  grid = new PageGrid($('#pageGrid'), {
    selectable: true,
    ariaLabel: 'Páginas del documento',
    onChange: () => {
      const sel = grid.selectedIndices();
      pickInput.value = formatPageList(sel);
      updatePlan();
    },
  });
  grid.setItems(pageItems(ctx.getRender, ctx.pageCount));
  toggle(options, true);
  toggle(actionBar, true);
  syncMode();
}

function onReset() {
  grid?.destroy();
  grid = null;
  toggle(options, false);
  toggle(actionBar, false);
  result.hide();
}

function syncMode() {
  const mode = radioValue('mode');
  for (const m of ['ranges', 'every', 'pick', 'bookmarks']) toggle($(`#mode-${m}`), m === mode);
  updatePlan();
}

/** Calcula los archivos a generar: [{name, pages:number[]}] */
function plan() {
  const ctx = tool.current;
  const total = ctx.pageCount;
  const base = stem(ctx.file.name);
  const mode = radioValue('mode');
  const label = (pages) => (pages.length === 1 ? `p${pages[0] + 1}` : `p${pages[0] + 1}-${pages[pages.length - 1] + 1}`);

  if (mode === 'ranges') {
    return parseRanges(rangesInput.value, total).map((pages) => ({ name: `${base}_${label(pages)}.pdf`, pages }));
  }
  if (mode === 'every') {
    const n = parseInt(everyInput.value, 10);
    if (!Number.isInteger(n) || n < 1) throw new Error('Indica cada cuántas páginas dividir (1 o más).');
    return chunkPages(total, n).map((pages) => ({ name: `${base}_${label(pages)}.pdf`, pages }));
  }
  if (mode === 'pick') {
    const pages = parsePageList(pickInput.value, total);
    if ($('#pickSeparate').checked) return pages.map((p) => ({ name: `${base}_p${p + 1}.pdf`, pages: [p] }));
    return [{ name: `${base}_extracto.pdf`, pages }];
  }
  if (mode === 'bookmarks') {
    const starts = [...new Map(outline.map((o) => [o.pageIndex, o])).values()].sort((a, b) => a.pageIndex - b.pageIndex);
    const parts = [];
    if (starts[0].pageIndex > 0) parts.push({ title: 'Inicio', from: 0, to: starts[0].pageIndex - 1 });
    starts.forEach((o, i) => parts.push({ title: o.title, from: o.pageIndex, to: (starts[i + 1]?.pageIndex ?? total) - 1 }));
    return parts.map((p, i) => ({
      name: `${String(i + 1).padStart(2, '0')} ${sanitizeFilename(p.title).slice(0, 80)}.pdf`,
      pages: Array.from({ length: p.to - p.from + 1 }, (_, k) => p.from + k),
    }));
  }
  return [];
}

function updatePlan() {
  if (!tool.current) return;
  result.hide();
  try {
    const files = plan();
    const shown = files.slice(0, 12).map((f) => formatPageList(f.pages)).join(' · ');
    preview.className = 'alert alert-info';
    preview.replaceChildren(h('span', {},
      h('strong', {}, `Se generará${files.length === 1 ? '' : 'n'} ${plural(files.length, 'archivo')}: `),
      shown, files.length > 12 ? ` … (+${files.length - 12})` : ''));
    runBtn.disabled = files.length === 0;
  } catch (err) {
    preview.className = 'alert alert-warning';
    preview.replaceChildren(h('span', {}, err.message));
    runBtn.disabled = true;
  }
}

async function split() {
  const ctx = tool.current;
  const files = plan();
  if (!files.length) throw new Error('No hay páginas para procesar.');
  const src = await loadPlain(ctx.bytes);
  const out = [];
  for (let i = 0; i < files.length; i++) {
    progress.set((i / files.length) * 95, `Generando ${i + 1} de ${files.length}…`);
    if (i % 4 === 0) await yieldToUI();
    const doc = await createPdf();
    const title = src.getTitle();
    if (title) doc.setTitle(title);
    const pages = await doc.copyPages(src, files[i].pages);
    pages.forEach((p) => doc.addPage(p));
    out.push({ name: files[i].name, data: await savePdf(doc) });
  }
  progress.set(100, 'Listo');
  const note = encryptedInputNote(ctx);
  result.show({
    title: files.length === 1 ? '¡Páginas extraídas!' : '¡PDF dividido!',
    files: out,
    zipName: `${stem(ctx.file.name)}_dividido.zip`,
    notes: note ? [note] : [],
  });
  toast(files.length === 1 ? 'Páginas extraídas' : `PDF dividido en ${files.length} archivos`, 'success');
}

toggle(options, false);
toggle(actionBar, false);
