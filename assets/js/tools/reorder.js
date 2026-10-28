/* ============================================================
   ORGANIZAR PÁGINAS
   Reordenar (arrastre o Alt+flechas), girar, duplicar, eliminar,
   insertar páginas en blanco o de otros PDFs. Deshacer/rehacer.
   ============================================================ */
import '../core/app.js';
import { $, h, plural } from '../core/dom.js';
import { toast, createProgress, toggle } from '../core/ui.js';
import { readFile, openPdf, loadPlain, createPdf, savePdf } from '../core/pdf-engine.js';
import { openRender } from '../core/render.js';
import { PageGrid } from '../core/page-grid.js';
import { PDFLib } from '../core/libs.js';
import { validateFile } from '../core/file-handler.js';
import { singlePdfTool, runTask, yieldToUI, createResultArea, encryptedInputNote } from '../core/tool.js';
import { buildName } from '../core/download.js';

const editor    = $('#editor');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const infoEl    = $('#gridInfo');
const undoBtn   = $('#undoBtn');
const redoBtn   = $('#redoBtn');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: () => tool.reset() });

/** Documentos de origen: id → {name, bytes, pageCount, getRender, sizes} */
const sources = new Map();
let grid = null;
let keySeq = 0;
let history = [];
let future = [];

const ACTIONS = [
  { id: 'rotl', icon: 'rotateLeft', label: 'Girar a la izquierda' },
  { id: 'rotr', icon: 'rotate', label: 'Girar a la derecha' },
  { id: 'dup', icon: 'copy', label: 'Duplicar' },
  { id: 'delete', icon: 'trash', label: 'Eliminar' },
];

const tool = singlePdfTool({
  dropZone: $('#dropZone'),
  summary: $('#fileSummary'),
  onLoad,
  onReset,
});

// ---- Barra de herramientas -------------------------------------
$('#selAll').addEventListener('click', () => grid.selectAll(true));
$('#selNone').addEventListener('click', () => grid.selectAll(false));
$('#rotLeftSel').addEventListener('click', () => rotateTargets(-90));
$('#rotRightSel').addEventListener('click', () => rotateTargets(90));
$('#dupSel').addEventListener('click', duplicateSelection);
$('#delSel').addEventListener('click', deleteSelection);
$('#reverseBtn').addEventListener('click', () => { commit(); grid.setItems(grid.items().reverse()); });
$('#blankBtn').addEventListener('click', insertBlank);
$('#insertBtn').addEventListener('click', () => $('#insertInput').click());
$('#insertInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for (const f of files) await insertPdf(f).catch(reportError);
});
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
runBtn.addEventListener('click', () => runTask(runBtn, progress, save));

document.addEventListener('keydown', (e) => {
  if (!grid || e.target.closest('input, textarea, select')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
});

function reportError(err) {
  if (err?.name === 'PasswordCancelledError') toast('Inserción cancelada.', 'info');
  else toast(err?.message || String(err), 'error');
}

// ---- Carga ------------------------------------------------------
async function onLoad(ctx) {
  result.hide();
  destroySources();
  history = [];
  future = [];
  const main = addSource(ctx.file.name, ctx.bytes, ctx.doc, ctx.getRender);
  grid?.destroy();
  grid = new PageGrid($('#pageGrid'), {
    selectable: true,
    sortable: true,
    actions: ACTIONS,
    ariaLabel: 'Páginas: arrastra para reordenar o usa Alt + flechas',
    onAction,
    onChange: onGridChange,
  });
  grid.setItems(Array.from({ length: ctx.pageCount }, (_, i) => makeItem({ src: main, index: i })));
  toggle(editor, true);
  toggle(actionBar, true);
  updateInfo();
}

// Instantánea antes de un arrastre o de Alt+flechas, para poder deshacerlo.
let pendingSnapshot = null;
const gridEl = $('#pageGrid');
gridEl.addEventListener('pointerdown', () => { if (grid) pendingSnapshot = snapshot(); }, { capture: true });
gridEl.addEventListener('keydown', (e) => { if (grid && (e.altKey || (e.ctrlKey && e.shiftKey))) pendingSnapshot = snapshot(); }, { capture: true });

function onGridChange() {
  if (pendingSnapshot && orderChanged(pendingSnapshot)) pushHistory(pendingSnapshot);
  pendingSnapshot = null;
  updateInfo();
}

function destroySources() {
  for (const [id, s] of sources) if (id !== 0) s.destroy?.();
  sources.clear();
}

function onReset() {
  grid?.destroy();
  grid = null;
  destroySources();
  toggle(editor, false);
  toggle(actionBar, false);
  result.hide();
}

function addSource(name, bytes, doc, getRender) {
  const id = sources.size;
  const sizes = doc.getPages().map((p) => p.getSize());
  sources.set(id, { id, name, bytes, pageCount: doc.getPageCount(), getRender, sizes });
  return id;
}

/** Crea un elemento de la rejilla a partir de su descripción serializable. */
function makeItem({ src = null, index = 0, rotation = 0, blank = null, key = `k${++keySeq}` }) {
  const thumbW = 170 * Math.min(2, window.devicePixelRatio || 1);
  if (blank) {
    return {
      key, src: null, index: -1, rotation, blank, label: 'En blanco', badge: null,
      render: async (canvas) => {
        const ratio = blank.h / blank.w;
        canvas.width = thumbW;
        canvas.height = Math.round(thumbW * ratio);
        const g = canvas.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, canvas.width, canvas.height);
      },
    };
  }
  const s = sources.get(src);
  return {
    key, src, index, rotation, blank: null,
    label: `Pág. ${index + 1}`,
    badge: src === 0 ? null : s.name,
    render: async (canvas) => { const r = await s.getRender(); await r.renderPage(index + 1, { width: thumbW, canvas }); },
  };
}

// ---- Historial --------------------------------------------------
const snapshot = () => grid.items().map(({ key, src, index, rotation, blank }) => ({ key, src, index, rotation, blank }));
const orderChanged = (snap) => {
  const now = grid.items();
  return now.length !== snap.length || now.some((it, i) => it.key !== snap[i].key || it.rotation !== snap[i].rotation);
};

function pushHistory(snap) {
  history.push(snap);
  if (history.length > 100) history.shift();
  future = [];
  updateUndo();
}

/** Guarda el estado actual antes de un cambio. */
function commit() { pendingSnapshot = null; pushHistory(snapshot()); }

function restore(snap) {
  grid.setItems(snap.map((s) => makeItem(s)));
}

function undo() {
  if (!history.length) return;
  future.push(snapshot());
  restore(history.pop());
  updateUndo();
}

function redo() {
  if (!future.length) return;
  history.push(snapshot());
  restore(future.pop());
  updateUndo();
}

function updateUndo() {
  undoBtn.disabled = history.length === 0;
  redoBtn.disabled = future.length === 0;
}

// ---- Acciones ---------------------------------------------------
function targets() {
  const sel = grid.selectedItems();
  return sel.length ? sel : null;
}

function onAction(id, item) {
  if (id === 'rotl' || id === 'rotr') { commit(); rotate(item, id === 'rotl' ? -90 : 90); }
  else if (id === 'dup') { commit(); duplicate([item]); }
  else if (id === 'delete') { commit(); remove([item]); }
}

function rotate(item, delta) {
  item.rotation = (((item.rotation + delta) % 360) + 360) % 360;
  grid.refresh(item);
}

function rotateTargets(delta) {
  const list = targets() || grid.items();
  commit();
  list.forEach((it) => rotate(it, delta));
  if (!targets()) toast('Sin selección: se han girado todas las páginas.', 'info');
}

function duplicate(list) {
  for (const it of list) {
    const items = grid.items();
    const pos = items.indexOf(it);
    grid.insertItems([makeItem({ src: it.src, index: it.index, rotation: it.rotation, blank: it.blank })], pos + 1);
  }
}

function duplicateSelection() {
  const list = targets();
  if (!list) { toast('Selecciona las páginas que quieres duplicar.', 'warning'); return; }
  commit();
  duplicate(list);
}

function remove(list) {
  if (grid.items().length - list.length < 1) { toast('El documento debe conservar al menos una página.', 'warning'); return; }
  list.forEach((it) => grid.remove(it));
}

function deleteSelection() {
  const list = targets();
  if (!list) { toast('Selecciona las páginas que quieres eliminar.', 'warning'); return; }
  commit();
  remove(list);
}

/** Posición de inserción: tras la última página seleccionada o al final. */
function insertPosition() {
  const sel = grid.selectedIndices();
  return sel.length ? sel[sel.length - 1] + 1 : grid.items().length;
}

function insertBlank() {
  const items = grid.items();
  const pos = insertPosition();
  const ref = items[pos - 1] || items[0];
  let size = { w: 595.28, h: 841.89 }; // A4
  if (ref?.blank) size = ref.blank;
  else if (ref) { const s = sources.get(ref.src).sizes[ref.index]; size = { w: s.width, h: s.height }; }
  commit();
  grid.insertItems([makeItem({ blank: size })], pos);
}

async function insertPdf(file) {
  const err = await validateFile(file, 'pdf');
  if (err) throw new Error(err);
  const { doc, bytes } = await openPdf(await readFile(file), { fileName: file.name });
  let renderPromise = null;
  const id = addSource(file.name, bytes, doc, () => (renderPromise ??= openRender(bytes)));
  sources.get(id).destroy = () => renderPromise?.then((r) => r.destroy());
  commit();
  const pos = insertPosition();
  grid.insertItems(Array.from({ length: doc.getPageCount() }, (_, i) => makeItem({ src: id, index: i })), pos, { select: true });
  toast(`Insertadas ${plural(doc.getPageCount(), 'página')} de «${file.name}».`, 'success');
}

function updateInfo() {
  if (!grid) return;
  result.hide();
  const n = grid.items().length;
  const sel = grid.selectedIndices().length;
  infoEl.textContent = `${plural(n, 'página')}${sel ? ` · ${sel} seleccionada${sel === 1 ? '' : 's'}` : ''}`;
  updateUndo();
}

// ---- Guardar ----------------------------------------------------
async function save() {
  const ctx = tool.current;
  const items = grid.items();
  const out = await createPdf();
  const title = ctx.doc.getTitle();
  if (title) out.setTitle(title);

  // Copia agrupada por origen: los recursos compartidos (fuentes,
  // imágenes) se copian una sola vez aunque haya páginas duplicadas.
  progress.set(10, 'Copiando páginas…');
  const copied = new Map(); // item → PDFPage
  const bySource = new Map();
  items.forEach((it) => { if (!it.blank) (bySource.get(it.src) || bySource.set(it.src, []).get(it.src)).push(it); });
  let done = 0;
  for (const [srcId, list] of bySource) {
    const srcDoc = await loadPlain(sources.get(srcId).bytes);
    const pages = await out.copyPages(srcDoc, list.map((it) => it.index));
    pages.forEach((p, i) => copied.set(list[i], p));
    done++;
    progress.set(10 + (done / bySource.size) * 70, 'Copiando páginas…');
    await yieldToUI();
  }

  for (const it of items) {
    if (it.blank) { out.addPage([it.blank.w, it.blank.h]); continue; }
    const page = out.addPage(copied.get(it));
    if (it.rotation) page.setRotation(PDFLib.degrees((page.getRotation().angle + it.rotation) % 360));
  }
  progress.set(90, 'Guardando…');
  const bytes = await savePdf(out);
  progress.set(100, 'Listo');
  const note = encryptedInputNote(ctx);
  result.show({
    title: '¡Páginas organizadas!',
    meta: plural(items.length, 'página'),
    files: [{ name: buildName(ctx.file.name, '_organizado'), data: bytes }],
    notes: note ? [note] : [],
  });
  toast('PDF guardado', 'success');
}

toggle(editor, false);
toggle(actionBar, false);
