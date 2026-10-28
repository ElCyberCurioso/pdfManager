/* ============================================================
   PDF A IMAGEN
   Exporta páginas a PNG, JPG o WebP a la resolución elegida.
   ============================================================ */
import '../core/app.js';
import { $, $$, plural } from '../core/dom.js';
import { toast, createProgress, toggle } from '../core/ui.js';
import { parsePageList, formatPageList } from '../core/ranges.js';
import { PageGrid } from '../core/page-grid.js';
import { canvasToBlob } from '../core/render.js';
import { singlePdfTool, runTask, yieldToUI, createResultArea, radioValue, bindRange, pageItems } from '../core/tool.js';
import { stem } from '../core/download.js';

const FORMATS = {
  png:  { mime: 'image/png',  ext: 'png' },
  jpg:  { mime: 'image/jpeg', ext: 'jpg' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

const options   = $('#options');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const pagesIn   = $('#pagesInput');
const dpiIn     = $('#dpi');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: () => tool.reset() });
let grid = null;

const tool = singlePdfTool({ dropZone: $('#dropZone'), summary: $('#fileSummary'), onLoad, onReset });

bindRange($('#quality'), $('#qualityVal'), (v) => `${v}%`);
$$('input[name="format"]').forEach((r) => r.addEventListener('change', sync));
$$('input[name="dpiPreset"]').forEach((r) => r.addEventListener('change', () => { dpiIn.value = r.value; sync(); }));
dpiIn.addEventListener('input', () => { $$('input[name="dpiPreset"]').forEach((r) => { r.checked = r.value === dpiIn.value; }); sync(); });
pagesIn.addEventListener('change', () => {
  try { grid.selectIndices(parsePageList(pagesIn.value, tool.current.pageCount)); } catch (err) { toast(err.message, 'warning'); }
});
$('#selAll').addEventListener('click', () => grid.selectAll(true));
$('#selNone').addEventListener('click', () => grid.selectAll(false));
runBtn.addEventListener('click', () => runTask(runBtn, progress, exportImages));

function onLoad(ctx) {
  result.hide();
  grid?.destroy();
  grid = new PageGrid($('#pageGrid'), {
    selectable: true,
    initiallySelected: true,
    ariaLabel: 'Páginas a exportar',
    onChange: () => { pagesIn.value = formatPageList(grid.selectedIndices()); sync(); },
  });
  $('#pageGrid').classList.add('page-grid--sm');
  grid.setItems(pageItems(ctx.getRender, ctx.pageCount));
  toggle(options, true);
  toggle(actionBar, true);
  sync();
}

function onReset() {
  grid?.destroy();
  grid = null;
  toggle(options, false);
  toggle(actionBar, false);
  result.hide();
}

async function sync() {
  result.hide();
  const fmt = radioValue('format');
  toggle($('#qualityBox'), fmt !== 'png');
  const ctx = tool.current;
  if (!ctx || !grid) return;
  const n = grid.selectedIndices().length;
  runBtn.disabled = n === 0;
  const dpi = clampDpi();
  const first = ctx.doc.getPage(grid.selectedIndices()[0] ?? 0);
  const { width, height } = first.getSize();
  const rot = first.getRotation().angle % 180 !== 0;
  const px = [Math.round((rot ? height : width) * dpi / 72), Math.round((rot ? width : height) * dpi / 72)];
  $('#estimate').textContent = n
    ? `${plural(n, 'imagen', 'imágenes')} · ≈ ${px[0]} × ${px[1]} px por página`
    : 'Selecciona al menos una página.';
}

const clampDpi = () => Math.min(600, Math.max(36, Number(dpiIn.value) || 150));

async function exportImages() {
  const ctx = tool.current;
  const pages = grid.selectedIndices();
  if (!pages.length) throw new Error('Selecciona al menos una página.');
  const fmt = FORMATS[radioValue('format')];
  const quality = Number($('#quality').value) / 100;
  const dpi = clampDpi();
  const r = await ctx.getRender();
  const files = [];
  const base = stem(ctx.file.name);
  const pad = String(ctx.pageCount).length;
  for (let i = 0; i < pages.length; i++) {
    const n = pages[i] + 1;
    progress.set((i / pages.length) * 95, `Convirtiendo página ${n} (${i + 1}/${pages.length})…`);
    await yieldToUI();
    const canvas = await r.renderPage(n, { dpi });
    const blob = await canvasToBlob(canvas, fmt.mime, fmt.ext === 'png' ? undefined : quality);
    canvas.width = canvas.height = 0;
    if (blob.type !== fmt.mime) throw new Error(`Tu navegador no puede generar imágenes ${fmt.ext.toUpperCase()}. Prueba con PNG o JPG.`);
    files.push({ name: `${base}_p${String(n).padStart(pad, '0')}.${fmt.ext}`, data: new Uint8Array(await blob.arrayBuffer()), type: fmt.mime });
  }
  progress.set(100, 'Listo');
  result.show({
    title: files.length === 1 ? '¡Imagen lista!' : '¡Imágenes listas!',
    meta: `${fmt.ext.toUpperCase()} · ${dpi} ppp`,
    files,
    zipName: `${base}_imagenes.zip`,
  });
  toast(`${plural(files.length, 'imagen generada', 'imágenes generadas')}`, 'success');
}

toggle(options, false);
toggle(actionBar, false);
