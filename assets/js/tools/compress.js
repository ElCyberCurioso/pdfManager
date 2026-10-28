/* ============================================================
   COMPRIMIR PDF
   - Sin pérdida: limpieza estructural y deduplicación.
   - Imágenes (recomendado): recomprime fotos y bitmaps a la
     calidad/resolución elegida; texto y vectores intactos.
   - Rasterizar: cada página pasa a ser una imagen (escaneos).
   ============================================================ */
import '../core/app.js';
import { $, $$, h, plural } from '../core/dom.js';
import { toast, createProgress, formatBytes, toggle } from '../core/ui.js';
import { loadPlain, createPdf, savePdf } from '../core/pdf-engine.js';
import { losslessPass, recompressImages, imageStats, stripAllMetadata } from '../core/optimize.js';
import { canvasToBlob } from '../core/render.js';
import { singlePdfTool, runTask, yieldToUI, createResultArea, radioValue, bindRange, encryptedInputNote } from '../core/tool.js';
import { buildName } from '../core/download.js';

const PRESETS = {
  high:   { quality: 0.85, dpi: 200, label: 'Alta calidad' },
  medium: { quality: 0.72, dpi: 150, label: 'Equilibrada' },
  low:    { quality: 0.55, dpi: 100, label: 'Máxima compresión' },
};

const options   = $('#options');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: () => tool.reset() });
const qualityIn = $('#quality');
const dpiIn     = $('#dpi');

const tool = singlePdfTool({ dropZone: $('#dropZone'), summary: $('#fileSummary'), onLoad, onReset });

bindRange(qualityIn, $('#qualityVal'), (v) => `${v}%`);
$$('input[name="mode"]').forEach((r) => r.addEventListener('change', syncMode));
$$('input[name="preset"]').forEach((r) => r.addEventListener('change', applyPreset));
[qualityIn, dpiIn].forEach((el) => el.addEventListener('input', () => {
  const p = PRESETS[radioValue('preset')];
  if (p && (Number(qualityIn.value) !== Math.round(p.quality * 100) || Number(dpiIn.value) !== p.dpi)) {
    $$('input[name="preset"]').forEach((r) => { r.checked = false; });
  }
  result.hide();
}));
runBtn.addEventListener('click', () => runTask(runBtn, progress, compress));

function onLoad(ctx) {
  result.hide();
  const { count, bytes } = imageStats(ctx.doc);
  const share = ctx.file.size ? Math.round((bytes / ctx.file.size) * 100) : 0;
  $('#analysis').replaceChildren(
    stat('Tamaño actual', formatBytes(ctx.file.size)),
    stat('Páginas', String(ctx.pageCount)),
    stat('Imágenes', count ? `${count} · ${formatBytes(bytes)}` : 'ninguna'),
  );
  // Recomendación automática
  const recommended = count && share > 25 ? 'images' : 'lossless';
  $(`input[name="mode"][value="${recommended}"]`).checked = true;
  $('#hint').textContent = count && share > 25
    ? `Las imágenes ocupan aproximadamente el ${Math.min(share, 100)}% del archivo: recomprimirlas es lo más eficaz.`
    : 'Este PDF apenas tiene imágenes: la optimización sin pérdida es la opción adecuada.';
  syncMode();
  toggle(options, true);
  toggle(actionBar, true);
}

function onReset() {
  toggle(options, false);
  toggle(actionBar, false);
  result.hide();
}

const stat = (label, value, good = false) =>
  h('div', { class: 'stat' }, h('div', { class: 'stat__label' }, label), h('div', { class: `stat__value${good ? ' is-good' : ''}` }, value));

function syncMode() {
  const mode = radioValue('mode');
  toggle($('#qualityBox'), mode !== 'lossless');
  toggle($('#rasterWarn'), mode === 'raster');
  result.hide();
}

function applyPreset() {
  const p = PRESETS[radioValue('preset')];
  if (!p) return;
  qualityIn.value = String(Math.round(p.quality * 100));
  qualityIn.dispatchEvent(new Event('input'));
  dpiIn.value = String(p.dpi);
}

async function compress() {
  const ctx = tool.current;
  const mode = radioValue('mode');
  const quality = Math.min(0.95, Math.max(0.1, Number(qualityIn.value) / 100));
  const dpi = Math.min(600, Math.max(36, Number(dpiIn.value) || 150));
  const stripMeta = $('#stripMeta').checked;
  const notes = [];
  let bytes;
  let detail = '';

  if (mode === 'raster') {
    bytes = await rasterize(ctx, { quality, dpi, stripMeta });
    notes.push({ type: 'warning', text: 'Las páginas se han convertido en imágenes: el texto ya no se puede seleccionar ni buscar, y se pierden enlaces y formularios.' });
  } else {
    progress.set(5, 'Analizando…');
    const doc = await loadPlain(ctx.bytes);
    if (mode === 'images') {
      const st = await recompressImages(doc, {
        quality, maxDpi: dpi,
        onProgress: (i, n) => progress.set(5 + (i / Math.max(1, n)) * 75, `Recomprimiendo imágenes (${Math.min(i + 1, n)}/${n})…`),
      });
      detail = st.recompressed
        ? `${plural(st.recompressed, 'imagen recomprimida', 'imágenes recomprimidas')} (${formatBytes(st.before)} → ${formatBytes(st.after)})`
        : 'ninguna imagen se podía reducir más';
      const skipped = Object.entries(st.skipped).filter(([k]) => k === 'no compatible' || k === 'error');
      if (skipped.length) notes.push({ type: 'info', text: `${skipped.reduce((s, [, n]) => s + n, 0)} imagen(es) en formatos no admitidos (CMYK, JPEG 2000, JBIG2…) se han dejado tal cual.` });
    }
    progress.set(85, 'Optimizando estructura…');
    await yieldToUI();
    const lp = await losslessPass(doc, { stripMetadata: stripMeta });
    if (mode === 'lossless') {
      detail = [lp.removed && `${lp.removed} objetos sin uso`, lp.deduped && `${lp.deduped} duplicados`, lp.deflated && `${lp.deflated} streams comprimidos`]
        .filter(Boolean).join(', ') || 'estructura reescrita';
    }
    progress.set(95, 'Guardando…');
    bytes = await savePdf(doc);
  }
  progress.set(100, 'Listo');

  const before = ctx.file.size;
  const after = bytes.length;
  const saved = before - after;
  const pct = before ? Math.round((saved / before) * 100) : 0;
  if (saved <= 0) notes.unshift({ type: 'warning', text: 'El resultado no es más pequeño que el original (el PDF ya estaba bien optimizado). Te recomendamos conservar el original o probar otro modo.' });
  const enc = encryptedInputNote(ctx);
  if (enc) notes.push(enc);

  result.show({
    title: saved > 0 ? `¡${pct}% más ligero!` : 'Compresión completada',
    meta: detail,
    notes,
    extra: h('div', { class: 'stats' },
      stat('Original', formatBytes(before)),
      stat('Resultado', formatBytes(after), saved > 0),
      stat('Ahorro', saved > 0 ? `${pct}% (${formatBytes(saved)})` : '—', saved > 0)),
    files: [{ name: buildName(ctx.file.name, '_comprimido'), data: bytes }],
  });
  toast(saved > 0 ? `Reducido un ${pct}%` : 'No se ha podido reducir más', saved > 0 ? 'success' : 'warning');
}

/** Convierte cada página en una imagen JPEG del MISMO tamaño físico. */
async function rasterize(ctx, { quality, dpi, stripMeta }) {
  const r = await ctx.getRender();
  const out = await createPdf();
  if (stripMeta) stripAllMetadata(out);
  for (let n = 1; n <= ctx.pageCount; n++) {
    progress.set(((n - 1) / ctx.pageCount) * 92, `Rasterizando página ${n} de ${ctx.pageCount}…`);
    const size = await r.pageSize(n); // en puntos, con la rotación aplicada
    const canvas = await r.renderPage(n, { dpi });
    const jpg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', quality)).arrayBuffer());
    canvas.width = canvas.height = 0; // libera memoria
    const img = await out.embedJpg(jpg);
    const page = out.addPage([size.width, size.height]);
    page.drawImage(img, { x: 0, y: 0, width: size.width, height: size.height });
  }
  progress.set(95, 'Guardando…');
  return savePdf(out);
}

toggle(options, false);
toggle(actionBar, false);
