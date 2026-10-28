/* ============================================================
   FIRMAR PDF (firma visual)
   Crea la firma dibujándola, escribiéndola o subiendo una
   imagen, y colócala arrastrando sobre la página. Avisa si el
   PDF ya tiene firmas digitales (se invalidarían).
   ============================================================ */
import '../core/app.js';
import { $, $$, plural } from '../core/dom.js';
import { toast, createProgress, toggle } from '../core/ui.js';
import { loadPlain, savePdf } from '../core/pdf-engine.js';
import { parsePageList } from '../core/ranges.js';
import { pageFrame, drawTextVisual, hexToRgb } from '../core/geometry.js';
import { stampImage, fontFor } from '../core/stamp.js';
import { decodeImage, toCanvas, whiteToTransparent, trimCanvas, canvasBytes } from '../core/images.js';
import { PDFLib } from '../core/libs.js';
import { N } from '../core/pdf-objects.js';
import { singlePdfTool, runTask, yieldToUI, createResultArea, radioValue, createPager, encryptedInputNote } from '../core/tool.js';
import { buildName } from '../core/download.js';

const editor    = $('#editor');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const pageCanvas = $('#pageCanvas');
const stageEl   = $('#stage');
const box       = $('#signBox');
const boxCanvas = box.querySelector('canvas');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: () => tool.reset() });

/** Firma actual: canvas recortado con fondo transparente. */
let signature = null;
/** Posición de la firma en fracciones de la página visual (origen arriba-izquierda). */
const place = { fx: 0.58, fy: 0.78, fw: 0.3 };

const pager = createPager($('#pager'), () => renderPage());
const tool = singlePdfTool({ dropZone: $('#dropZone'), summary: $('#fileSummary'), onLoad, onReset });

// ---- Pestañas: dibujar / escribir / imagen ----------------------
$$('[role="tab"]').forEach((tab) => tab.addEventListener('click', () => selectTab(tab.id)));
function selectTab(id) {
  $$('[role="tab"]').forEach((t) => {
    const on = t.id === id;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
  });
}
$('.tabs').addEventListener('keydown', (e) => {
  const tabs = $$('[role="tab"]');
  const i = tabs.indexOf(document.activeElement);
  if (i < 0 || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  next.focus();
  selectTab(next.id);
});

// ---- Dibujar ------------------------------------------------------
const pad = $('#padCanvas');
const strokes = [];
let drawing = null;

function sizePad() {
  const r = pad.getBoundingClientRect();
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  if (!r.width) return;
  pad.width = Math.round(r.width * dpr);
  pad.height = Math.round(r.height * dpr);
  redrawPad();
}
new ResizeObserver(sizePad).observe(pad);

function padPoint(e) {
  const r = pad.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, p: e.pressure || 0.5 };
}
pad.addEventListener('pointerdown', (e) => {
  pad.setPointerCapture(e.pointerId);
  drawing = { color: $('#penColor').value, width: Number($('#penWidth').value), points: [padPoint(e)] };
  strokes.push(drawing);
  $('#padHint').hidden = true;
  redrawPad();
});
pad.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  for (const ev of e.getCoalescedEvents?.() || [e]) drawing.points.push(padPoint(ev));
  redrawPad();
});
const endStroke = () => { if (drawing) { drawing = null; useDrawn(); } };
pad.addEventListener('pointerup', endStroke);
pad.addEventListener('pointercancel', endStroke);
$('#padClear').addEventListener('click', () => { strokes.length = 0; redrawPad(); $('#padHint').hidden = false; });
$('#padUndo').addEventListener('click', () => { strokes.pop(); redrawPad(); if (strokes.length) useDrawn(); });

function paintStrokes(ctx, w, h, scale = 1) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width * scale;
    const pts = s.points.map((p) => ({ x: p.x * w, y: p.y * h }));
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); continue; }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my); // trazo suavizado
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  }
}

function redrawPad() {
  const ctx = pad.getContext('2d');
  ctx.clearRect(0, 0, pad.width, pad.height);
  paintStrokes(ctx, pad.width, pad.height, Math.min(3, window.devicePixelRatio || 1));
}

function useDrawn() {
  if (!strokes.length) return;
  // Se vuelve a dibujar a alta resolución para que la firma sea nítida al imprimir.
  const W = 1500, H = 500;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  paintStrokes(c.getContext('2d'), W, H, 3);
  setSignature(trimCanvas(c, 6));
}

// ---- Escribir ----------------------------------------------------
const typed = $('#typedName');
const typedFont = $('#typedFont');
[typed, typedFont, $('#penColor')].forEach((el) => el.addEventListener('input', () => { if (!$('#tab-type').hidden) useTyped(); }));
function useTyped() {
  const text = typed.value.trim();
  if (!text) return;
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 420;
  const g = c.getContext('2d');
  g.fillStyle = $('#penColor').value;
  g.font = `${typedFont.value === 'serif' ? 'italic ' : ''}160px ${typedFont.value === 'serif' ? 'Georgia, "Times New Roman", serif' : typedFont.value}`;
  g.textBaseline = 'middle';
  let size = 160;
  while (g.measureText(text).width > c.width - 60 && size > 40) { size -= 10; g.font = g.font.replace(/\d+px/, `${size}px`); }
  g.fillText(text, 30, c.height / 2);
  setSignature(trimCanvas(c, 8));
}

// ---- Imagen -------------------------------------------------------
let uploaded = null;
$('#signImage').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const bmp = await decodeImage(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    uploaded = toCanvas(bmp, bmp.width * scale, bmp.height * scale);
    bmp.close?.();
    useUploaded();
  } catch { toast('No se pudo leer la imagen.', 'error'); }
});
$('#removeBg').addEventListener('change', () => uploaded && useUploaded());
function useUploaded() {
  const c = document.createElement('canvas');
  c.width = uploaded.width; c.height = uploaded.height;
  c.getContext('2d').drawImage(uploaded, 0, 0);
  if ($('#removeBg').checked) whiteToTransparent(c);
  const t = trimCanvas(c, 4);
  if (!t) { toast('La imagen está vacía tras quitar el fondo.', 'warning'); return; }
  setSignature(t);
}

// ---- Firma lista ----------------------------------------------------
function setSignature(canvas) {
  if (!canvas) return;
  signature = canvas;
  const prev = $('#signPreview');
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  c.getContext('2d').drawImage(canvas, 0, 0);
  prev.replaceChildren(c);
  boxCanvas.width = canvas.width; boxCanvas.height = canvas.height;
  boxCanvas.getContext('2d').drawImage(canvas, 0, 0);
  box.hidden = false;
  clampPlace();
  positionBox();
  result.hide();
  runBtn.disabled = false;
}

// ---- Página y colocación --------------------------------------------
async function renderPage() {
  const ctx = tool.current;
  if (!ctx) return;
  const r = await ctx.getRender();
  const width = Math.min(760, stageEl.parentElement.clientWidth - 32) * Math.min(2, window.devicePixelRatio || 1);
  await r.renderPage(pager.index + 1, { width, canvas: pageCanvas });
  positionBox();
}

const aspect = () => (signature ? signature.height / signature.width : 0.33);
function pageAspect() { return pageCanvas.height / pageCanvas.width || 1.414; }

function clampPlace() {
  place.fw = Math.min(0.95, Math.max(0.05, place.fw));
  const fh = place.fw * aspect() / pageAspect();
  place.fx = Math.min(1 - place.fw, Math.max(0, place.fx));
  place.fy = Math.min(1 - fh, Math.max(0, place.fy));
}

function positionBox() {
  if (!signature) return;
  clampPlace();
  const fh = place.fw * aspect() / pageAspect();
  Object.assign(box.style, {
    left: `${place.fx * 100}%`, top: `${place.fy * 100}%`,
    width: `${place.fw * 100}%`, height: `${fh * 100}%`,
  });
}

// Arrastrar y redimensionar con Pointer Events (ratón y táctil)
let drag = null;
box.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  box.setPointerCapture(e.pointerId);
  const r = stageEl.getBoundingClientRect();
  drag = { mode: e.target.closest('.sign-box__handle') ? 'resize' : 'move', x: e.clientX, y: e.clientY, start: { ...place }, w: r.width, h: r.height };
});
box.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = (e.clientX - drag.x) / drag.w, dy = (e.clientY - drag.y) / drag.h;
  if (drag.mode === 'move') { place.fx = drag.start.fx + dx; place.fy = drag.start.fy + dy; }
  else place.fw = drag.start.fw + dx;
  positionBox();
});
const endDrag = () => { drag = null; result.hide(); };
box.addEventListener('pointerup', endDrag);
box.addEventListener('pointercancel', endDrag);
box.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.05 : 0.01;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[e.key]) { e.preventDefault(); place.fx += moves[e.key][0]; place.fy += moves[e.key][1]; }
  else if (e.key === '+' || e.key === '=') place.fw *= 1.05;
  else if (e.key === '-') place.fw /= 1.05;
  else return;
  positionBox();
  result.hide();
});
new ResizeObserver(() => positionBox()).observe(stageEl);

// ---- Carga ------------------------------------------------------------
function hasDigitalSignatures(doc) {
  const acro = doc.catalog.lookup(N('AcroForm'));
  if (!(acro instanceof PDFLib.PDFDict)) return false;
  const fields = acro.lookup(N('Fields'));
  if (!(fields instanceof PDFLib.PDFArray)) return false;
  const stack = fields.asArray();
  while (stack.length) {
    const f = doc.context.lookup(stack.pop());
    if (!(f instanceof PDFLib.PDFDict)) continue;
    if (f.get(N('FT')) === N('Sig') && f.get(N('V'))) return true;
    const kids = f.lookup(N('Kids'));
    if (kids instanceof PDFLib.PDFArray) stack.push(...kids.asArray());
  }
  return false;
}

function onLoad(ctx) {
  result.hide();
  $('#sigWarning').hidden = !hasDigitalSignatures(ctx.doc);
  toggle(editor, true);
  toggle(actionBar, true);
  runBtn.disabled = !signature;
  pager.setTotal(ctx.pageCount);
}

function onReset() {
  toggle(editor, false);
  toggle(actionBar, false);
  result.hide();
}

function targetPages(total) {
  const mode = radioValue('where');
  if (mode === 'all') return Array.from({ length: total }, (_, i) => i);
  if (mode === 'last') return [total - 1];
  if (mode === 'list') return parsePageList($('#whereList').value, total);
  return [pager.index];
}
$$('input[name="where"]').forEach((r) => r.addEventListener('change', () => { toggle($('#whereList'), radioValue('where') === 'list'); result.hide(); }));

async function save() {
  if (!signature) throw new Error('Crea primero tu firma (dibújala, escríbela o sube una imagen).');
  const ctx = tool.current;
  const pages = targetPages(ctx.pageCount);
  const doc = await loadPlain(ctx.bytes);
  const png = await canvasBytes(signature, 'image/png');
  const img = await doc.embedPng(png);
  const addDate = $('#addDate').checked;
  const font = addDate ? await fontFor(doc, 'helvetica') : null;
  const all = doc.getPages();
  for (let k = 0; k < pages.length; k++) {
    const page = all[pages[k]];
    const f = pageFrame(page);
    const w = place.fw * f.vw;
    const hgt = w * (img.height / img.width);
    const u = place.fx * f.vw;
    const v = f.vh - place.fy * f.vh - hgt;
    stampImage(page, { image: img, width: w, u, v });
    if (addDate) {
      const size = Math.max(6, Math.min(11, w / 14));
      const text = `Firmado el ${new Date().toLocaleDateString('es-ES')}`;
      // Debajo de la firma, alineado a su izquierda (o encima si no cabe)
      const below = v - size * 1.3;
      drawTextVisual(page, text, { u, v: below > 4 ? below : v + hgt + size * 0.4, size, font, color: hexToRgb('#333333') });
    }
    if (k % 10 === 9) { progress.set((k / pages.length) * 90, 'Firmando…'); await yieldToUI(); }
  }
  progress.set(92, 'Guardando…');
  const bytes = await savePdf(doc);
  progress.set(100, 'Listo');
  const notes = [{ type: 'info', text: 'Es una firma visual (como firmar a mano un papel). No sustituye a una firma electrónica con certificado.' }];
  if (!$('#sigWarning').hidden) notes.unshift({ type: 'warning', text: 'El PDF original tenía firmas digitales: al modificarlo dejan de ser válidas.' });
  const enc = encryptedInputNote(ctx);
  if (enc) notes.push(enc);
  result.show({
    title: '¡PDF firmado!',
    meta: plural(pages.length, 'página firmada', 'páginas firmadas'),
    notes,
    files: [{ name: buildName(ctx.file.name, '_firmado'), data: bytes }],
  });
  toast('Firma añadida', 'success');
}

runBtn.addEventListener('click', () => runTask(runBtn, progress, save));
toggle(editor, false);
toggle(actionBar, false);
selectTab('tabDraw');
