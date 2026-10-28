/* ============================================================
   NUMERAR PÁGINAS
   Números, encabezados y pies con plantilla ({n}, {total},
   {fecha}, {archivo}), posición, márgenes y modo dúplex.
   ============================================================ */
import '../core/app.js';
import { $, $$, debounce, plural } from '../core/dom.js';
import { toast, createProgress, toggle } from '../core/ui.js';
import { loadPlain, savePdf } from '../core/pdf-engine.js';
import { parsePageList } from '../core/ranges.js';
import { LivePreview } from '../core/live-preview.js';
import { FONTS, fontFor, unsupportedChar, stampText } from '../core/stamp.js';
import { singlePdfTool, runTask, yieldToUI, createResultArea, radioValue, bindRange, createPager, encryptedInputNote } from '../core/tool.js';
import { buildName, stem } from '../core/download.js';

const editor    = $('#editor');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const stage     = $('#previewWrap');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: () => tool.reset() });
const el = {
  template: $('#template'), preset: $('#preset'), font: $('#font'), size: $('#size'), color: $('#color'),
  margin: $('#margin'), start: $('#start'), pages: $('#pages'), mirror: $('#mirror'),
};

el.font.replaceChildren(...Object.entries(FONTS).map(([k, f]) => new Option(f.label, k, k === 'helvetica', k === 'helvetica')));
bindRange(el.size, $('#sizeVal'), (v) => `${v} pt`);
// La fila central del selector de posición no tiene sentido para números.
$$('input[name="wmPos"]').forEach((r) => { if (r.value.startsWith('middle') || r.value === 'center') { r.disabled = true; r.closest('label').hidden = true; } });
$('input[name="wmPos"][value="bottom-center"]').checked = true;

el.preset.addEventListener('change', () => {
  if (el.preset.value) el.template.value = el.preset.value;
  refresh();
});
el.template.addEventListener('input', () => { el.preset.value = [...el.preset.options].some((o) => o.value === el.template.value) ? el.template.value : ''; });

let preview = null;
const pager = createPager($('#pager'), () => refresh());
const tool = singlePdfTool({ dropZone: $('#dropZone'), summary: $('#fileSummary'), onLoad, onReset });
const refresh = debounce(renderPreview, 120);
editor.addEventListener('input', (e) => { if (!e.target.closest('#pager')) { result.hide(); refresh(); } });
editor.addEventListener('change', (e) => { if (!e.target.closest('#pager')) refresh(); });
runBtn.addEventListener('click', () => runTask(runBtn, progress, save));

function onLoad(ctx) {
  result.hide();
  preview = new LivePreview($('#previewCanvas'), ctx.bytes, (doc, page, index, total) => apply(doc, page, index, total, plan(total)));
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

/** Qué número lleva cada página: Map(índice → número). */
function plan(total) {
  const v = el.pages.value.trim();
  const pages = v ? parsePageList(v, total) : Array.from({ length: total }, (_, i) => i);
  const start = Number.isFinite(Number(el.start.value)) ? Math.trunc(Number(el.start.value)) : 1;
  return { numbers: new Map(pages.map((p, k) => [p, start + k])), last: start + pages.length - 1 };
}

/** Sustituye las variables de la plantilla. */
export function formatTemplate(tpl, { n, total, file, date = new Date() }) {
  return tpl
    .replace(/\{n\}/gi, String(n))
    .replace(/\{total\}/gi, String(total))
    .replace(/\{fecha\}/gi, date.toLocaleDateString('es-ES'))
    .replace(/\{archivo\}/gi, file);
}

async function apply(doc, page, index, total, { numbers, last }) {
  if (!numbers.has(index)) return;
  const font = await fontFor(doc, el.font.value);
  const text = formatTemplate(el.template.value || '{n}', { n: numbers.get(index), total: last, file: stem(tool.current.file.name) });
  const bad = unsupportedChar(font, text);
  if (bad) throw new Error(`El carácter «${bad}» no está disponible en las fuentes estándar del PDF.`);
  let position = radioValue('wmPos') || 'bottom-center';
  if (el.mirror.checked && index % 2 === 1) {
    position = position.replace(/left|right/, (m) => (m === 'left' ? 'right' : 'left'));
  }
  stampText(page, {
    text, font, size: Number(el.size.value), color: el.color.value, opacity: 1, angle: 0,
    position, margin: Math.max(0, Number(el.margin.value) || 0) * 72 / 25.4,
  });
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
  const p = plan(ctx.pageCount);
  const doc = await loadPlain(ctx.bytes);
  const pages = doc.getPages();
  let k = 0;
  for (const index of p.numbers.keys()) {
    await apply(doc, pages[index], index, pages.length, p);
    if (++k % 20 === 0) { progress.set((k / p.numbers.size) * 90, `Numerando… (${k}/${p.numbers.size})`); await yieldToUI(); }
  }
  progress.set(92, 'Guardando…');
  const bytes = await savePdf(doc);
  progress.set(100, 'Listo');
  const note = encryptedInputNote(ctx);
  result.show({
    title: '¡Páginas numeradas!',
    meta: plural(p.numbers.size, 'página numerada', 'páginas numeradas'),
    notes: note ? [note] : [],
    files: [{ name: buildName(ctx.file.name, '_numerado'), data: bytes }],
  });
  toast('Numeración añadida', 'success');
}

toggle(editor, false);
toggle(actionBar, false);
