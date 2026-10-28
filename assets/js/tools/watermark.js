/* ============================================================
   MARCA DE AGUA
   Texto o imagen, 9 posiciones o mosaico, encima o debajo del
   contenido, páginas a elegir. La vista previa usa el mismo
   código que el guardado (lo que ves es lo que obtienes).
   ============================================================ */
import '../core/app.js';
import { $, $$, debounce, plural } from '../core/dom.js';
import { toast, createProgress, toggle } from '../core/ui.js';
import { loadPlain, savePdf } from '../core/pdf-engine.js';
import { parsePageList } from '../core/ranges.js';
import { LivePreview } from '../core/live-preview.js';
import { prepareImage } from '../core/images.js';
import { pageFrame } from '../core/geometry.js';
import { FONTS, fontFor, unsupportedChar, stampText, stampImage, sendLastContentToBack, embedImageBytes } from '../core/stamp.js';
import { singlePdfTool, runTask, yieldToUI, createResultArea, radioValue, bindRange, createPager, encryptedInputNote } from '../core/tool.js';
import { buildName } from '../core/download.js';

const editor    = $('#editor');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const canvas    = $('#previewCanvas');
const stage     = $('#previewWrap');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: () => tool.reset() });

const el = {
  text: $('#wmText'), font: $('#wmFont'), size: $('#wmSize'), color: $('#wmColor'),
  opacity: $('#wmOpacity'), angle: $('#wmAngle'), imgScale: $('#wmImgScale'),
  tile: $('#wmTile'), layer: $('#wmLayer'), pages: $('#wmPages'), margin: $('#wmMargin'),
};

let preview = null;
let logo = null; // {bytes, kind, width, height, name}

// Opciones de fuente
el.font.replaceChildren(...Object.entries(FONTS).map(([k, f]) => new Option(f.label, k, k === 'helveticaBold', k === 'helveticaBold')));
bindRange(el.size, $('#wmSizeVal'), (v) => `${v} pt`);
bindRange(el.opacity, $('#wmOpacityVal'), (v) => `${v}%`);
bindRange(el.angle, $('#wmAngleVal'), (v) => `${v}°`);
bindRange(el.imgScale, $('#wmImgScaleVal'), (v) => `${v}%`);

const pager = createPager($('#pager'), () => refresh());
const tool = singlePdfTool({ dropZone: $('#dropZone'), summary: $('#fileSummary'), onLoad, onReset });

const refresh = debounce(() => renderPreview(), 120);
editor.addEventListener('input', (e) => { if (!e.target.closest('#pager')) { result.hide(); refresh(); } });
editor.addEventListener('change', (e) => { if (!e.target.closest('#pager')) refresh(); });
$$('input[name="wmType"]').forEach((r) => r.addEventListener('change', syncType));
$$('[data-angle]').forEach((b) => b.addEventListener('click', () => {
  el.angle.value = b.dataset.angle;
  el.angle.dispatchEvent(new Event('input', { bubbles: true }));
}));
$('#wmImage').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    logo = { ...(await prepareImage(file)), name: file.name };
    $('#wmImageName').textContent = file.name;
    refresh();
  } catch (err) { toast(err.message, 'error'); }
});
runBtn.addEventListener('click', () => runTask(runBtn, progress, save));

function syncType() {
  const isText = radioValue('wmType') === 'text';
  toggle($('#textOpts'), isText);
  toggle($('#imageOpts'), !isText);
  refresh();
}

function onLoad(ctx) {
  result.hide();
  preview = new LivePreview(canvas, ctx.bytes, (doc, page, index, total) => apply(doc, page, index, total, true));
  toggle(editor, true);
  toggle(actionBar, true);
  pager.setTotal(ctx.pageCount);
}

function onReset() {
  preview = null;
  toggle(editor, false);
  toggle(actionBar, false);
  result.hide();
}

function settings() {
  return {
    type: radioValue('wmType'),
    text: el.text.value.trim() || 'CONFIDENCIAL',
    font: el.font.value,
    size: Number(el.size.value),
    color: el.color.value,
    opacity: Number(el.opacity.value) / 100,
    angle: Number(el.angle.value),
    imgScale: Number(el.imgScale.value) / 100,
    position: radioValue('wmPos') || 'center',
    tile: el.tile.checked,
    under: el.layer.value === 'under',
    margin: Math.max(0, Number(el.margin.value) || 0) * 72 / 25.4, // mm → pt
  };
}

/** Páginas afectadas (índices 0-based). */
function targetPages(total) {
  const v = el.pages.value.trim();
  return new Set(v ? parsePageList(v, total) : Array.from({ length: total }, (_, i) => i));
}

const embedded = new WeakMap(); // doc → imagen incrustada

/** Aplica la marca a una página. Se usa igual en la vista previa y al guardar. */
async function apply(doc, page, index, total, isPreview = false) {
  const s = settings();
  if (isPreview) {
    let pages;
    try { pages = targetPages(total); } catch { pages = new Set(); }
    if (!pages.has(index)) return;
  }
  if (s.type === 'text') {
    const font = await fontFor(doc, s.font);
    const bad = unsupportedChar(font, s.text);
    if (bad) throw new Error(`El carácter «${bad}» no está disponible en las fuentes estándar del PDF.`);
    stampText(page, { text: s.text, font, size: s.size, color: s.color, opacity: s.opacity, angle: s.angle, position: s.position, margin: s.margin, tile: s.tile });
  } else {
    if (!logo) return;
    let img = embedded.get(doc);
    if (!img) { img = await embedImageBytes(doc, logo.bytes, logo.kind); embedded.set(doc, img); }
    const width = pageFrame(page).vw * s.imgScale;
    stampImage(page, { image: img, width, angle: s.angle, opacity: s.opacity, position: s.position, margin: s.margin, tile: s.tile });
  }
  if (s.under) sendLastContentToBack(page);
}

async function renderPreview() {
  if (!preview || !tool.current) return;
  stage.classList.add('is-loading');
  try {
    await preview.render(pager.index, tool.current.pageCount);
    $('#previewError').hidden = true;
  } catch (err) {
    $('#previewError').hidden = false;
    $('#previewError').textContent = err.message;
  } finally {
    stage.classList.remove('is-loading');
  }
}

async function save() {
  const ctx = tool.current;
  const s = settings();
  if (s.type === 'image' && !logo) throw new Error('Elige primero una imagen para la marca de agua.');
  const pages = targetPages(ctx.pageCount);
  const doc = await loadPlain(ctx.bytes);
  const all = doc.getPages();
  let n = 0;
  for (const i of pages) {
    await apply(doc, all[i], i, all.length);
    if (++n % 10 === 0) { progress.set((n / pages.size) * 90, `Página ${n} de ${pages.size}…`); await yieldToUI(); }
  }
  progress.set(92, 'Guardando…');
  const bytes = await savePdf(doc);
  progress.set(100, 'Listo');
  const notes = [];
  if (s.under) notes.push({ type: 'info', text: 'La marca está debajo del contenido: no se verá en páginas con fondo opaco (p. ej. escaneos). En ese caso usa «Encima».' });
  const enc = encryptedInputNote(ctx);
  if (enc) notes.push(enc);
  result.show({
    title: '¡Marca de agua añadida!',
    meta: plural(pages.size, 'página'),
    notes,
    files: [{ name: buildName(ctx.file.name, '_marca'), data: bytes }],
  });
  toast('Marca de agua aplicada', 'success');
}

toggle(editor, false);
toggle(actionBar, false);
syncType();
