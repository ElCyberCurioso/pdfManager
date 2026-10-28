/* ============================================================
   IMÁGENES A PDF
   JPG, PNG, WebP, GIF, BMP, AVIF → PDF. Los JPG se incrustan
   sin recomprimir (sin pérdida) y se respeta la orientación
   EXIF de las fotos del móvil.
   ============================================================ */
import '../core/app.js';
import { $, h, plural } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, createProgress, formatBytes, toggle } from '../core/ui.js';
import { initDropZone } from '../core/file-handler.js';
import { createPdf, savePdf } from '../core/pdf-engine.js';
import { makeSortable, moveItem } from '../core/sortable.js';
import { sniffImage, jpegOrientation, jpegSize, prepareImage, decodeImage } from '../core/images.js';
import { PDFLib } from '../core/libs.js';
import { runTask, yieldToUI, createResultArea, radioValue } from '../core/tool.js';
import { sanitizeFilename } from '../core/download.js';

const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
const MARGINS = { none: 0, small: 10, large: 20 }; // mm
const EXIF_ROT = { 1: 0, 3: 180, 6: 90, 8: 270 };

const dropZone  = $('#dropZone');
const listWrap  = $('#listWrap');
const listEl    = $('#fileList');
const options   = $('#options');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: clearAll });

/** @type {{id:number, file:File, url:string, rotation:number, el?:HTMLElement}[]} */
let images = [];
let seq = 0;

const dz = initDropZone(dropZone, { accept: 'image', multiple: true, onFiles: add });
$('#addMoreBtn').addEventListener('click', () => dz.open());
$('#clearBtn').addEventListener('click', clearAll);
$('#sortNameBtn').addEventListener('click', () => {
  images.sort((a, b) => a.file.name.localeCompare(b.file.name, 'es', { numeric: true, sensitivity: 'base' }));
  render();
});
document.querySelectorAll('input[name="size"]').forEach((r) => r.addEventListener('change', () => {
  toggle($('#orientBox'), radioValue('size') !== 'fit');
  result.hide();
}));
runBtn.addEventListener('click', () => runTask(runBtn, progress, build));

makeSortable(listEl, {
  itemSelector: '.file-item',
  handleSelector: '.drag-handle',
  onEnd: (from, to) => { images = moveItem(images, from, to); update(); },
});

function add(files) {
  for (const file of files) images.push({ id: ++seq, file, url: URL.createObjectURL(file), rotation: 0 });
  render();
}

function render() {
  listEl.replaceChildren(...images.map(itemFor));
  update();
}

function itemFor(it) {
  if (it.el) return it.el;
  const img = h('img', { src: it.url, alt: '', loading: 'lazy', decoding: 'async' });
  const paint = () => { img.style.transform = it.rotation ? `rotate(${it.rotation}deg)` : ''; };
  it.el = h('div', { class: 'file-item', 'data-testid': 'file-item' },
    h('span', { class: 'drag-handle', title: 'Arrastrar para reordenar', 'aria-hidden': 'true' }, icon('grip')),
    h('div', { class: 'file-item__thumb' }, img),
    h('div', { class: 'file-item__info' },
      h('div', { class: 'file-item__name', title: it.file.name }, it.file.name),
      h('div', { class: 'file-item__meta' }, formatBytes(it.file.size))),
    h('div', { class: 'file-item__actions' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Girar a la izquierda', 'aria-label': `Girar ${it.file.name} a la izquierda`, onclick: () => { it.rotation = (it.rotation + 270) % 360; paint(); result.hide(); } }, icon('rotateLeft')),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Girar a la derecha', 'aria-label': `Girar ${it.file.name} a la derecha`, onclick: () => { it.rotation = (it.rotation + 90) % 360; paint(); result.hide(); } }, icon('rotate')),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Quitar', 'aria-label': `Quitar ${it.file.name}`, onclick: () => remove(it) }, icon('trash'))),
  );
  return it.el;
}

function remove(it) {
  URL.revokeObjectURL(it.url);
  images = images.filter((x) => x !== it);
  it.el?.remove();
  update();
}

function clearAll() {
  images.forEach((it) => URL.revokeObjectURL(it.url));
  images = [];
  listEl.replaceChildren();
  update();
}

function update() {
  result.hide();
  const has = images.length > 0;
  toggle(listWrap, has);
  toggle(options, has);
  toggle(actionBar, has);
  dropZone.classList.toggle('drop-zone--compact', has);
  $('#listInfo').textContent = plural(images.length, 'imagen', 'imágenes');
}

/** Prepara una imagen para incrustarla: {bytes, kind, w, h, rot} (rot: giro horario EXIF). */
async function load(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (kind === 'jpeg') {
    const o = jpegOrientation(bytes);
    const s = jpegSize(bytes);
    if (s && s.components !== 4 && o in EXIF_ROT) return { bytes, kind, w: s.width, h: s.height, rot: EXIF_ROT[o] };
  }
  if (kind === 'png') {
    const bmp = await decodeImage(new Blob([bytes]));
    const r = { bytes, kind, w: bmp.width, h: bmp.height, rot: 0 };
    bmp.close?.();
    return r;
  }
  const p = await prepareImage(file);
  return { bytes: p.bytes, kind: p.kind, w: p.width, h: p.height, rot: 0 };
}

/**
 * Dibuja una imagen girada `rot` grados (horario) ocupando el rectángulo
 * visual (tx, ty, tw, th). pdf-lib gira en sentido antihorario alrededor
 * de la esquina inferior izquierda.
 */
function drawRotated(page, image, rot, tx, ty, tw, th) {
  const opts = { rotate: PDFLib.degrees(-rot) };
  if (rot === 0) Object.assign(opts, { x: tx, y: ty, width: tw, height: th });
  else if (rot === 90) Object.assign(opts, { x: tx, y: ty + th, width: th, height: tw });
  else if (rot === 180) Object.assign(opts, { x: tx + tw, y: ty + th, width: tw, height: th });
  else Object.assign(opts, { x: tx + tw, y: ty, width: th, height: tw });
  page.drawImage(image, opts);
}

async function build() {
  if (!images.length) throw new Error('Añade al menos una imagen.');
  const sizeMode = radioValue('size');
  const orient = radioValue('orient');
  const margin = (MARGINS[radioValue('margin')] ?? 0) * 72 / 25.4;
  const doc = await createPdf();
  doc.setTitle(($('#outName').value.trim() || 'imagenes').replace(/\.pdf$/i, ''));

  for (let i = 0; i < images.length; i++) {
    const it = images[i];
    progress.set((i / images.length) * 90, `Añadiendo «${it.file.name}» (${i + 1}/${images.length})…`);
    await yieldToUI();
    let data;
    try { data = await load(it.file); }
    catch (err) { throw new Error(`No se pudo leer «${it.file.name}»: ${err.message}`); }
    const embedded = data.kind === 'jpeg' ? await doc.embedJpg(data.bytes) : await doc.embedPng(data.bytes);
    const rot = (data.rot + it.rotation) % 360;
    const swap = rot === 90 || rot === 270;
    const dispW = swap ? data.h : data.w;
    const dispH = swap ? data.w : data.h;

    let pw, ph;
    if (sizeMode === 'fit') {
      // Lado mayor = lado mayor de un A4; la página se ajusta a la imagen.
      const k = 841.89 / Math.max(dispW, dispH);
      pw = dispW * k + 2 * margin;
      ph = dispH * k + 2 * margin;
    } else {
      [pw, ph] = SIZES[sizeMode];
      const landscape = orient === 'landscape' || (orient === 'auto' && dispW > dispH);
      if (landscape) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const boxW = pw - 2 * margin, boxH = ph - 2 * margin;
    const k = Math.min(boxW / dispW, boxH / dispH);
    const tw = dispW * k, th = dispH * k;
    drawRotated(page, embedded, rot, (pw - tw) / 2, (ph - th) / 2, tw, th);
  }
  progress.set(95, 'Guardando…');
  const bytes = await savePdf(doc);
  progress.set(100, 'Listo');
  const name = sanitizeFilename(($('#outName').value.trim() || 'imagenes').replace(/\.pdf$/i, '') + '.pdf');
  result.show({ title: '¡PDF creado!', meta: plural(images.length, 'página'), files: [{ name, data: bytes }] });
  toast('PDF creado', 'success');
}

toggle(listWrap, false);
toggle(options, false);
toggle(actionBar, false);
