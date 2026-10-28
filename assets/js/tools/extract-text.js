/* ============================================================
   EXTRAER TEXTO
   Obtiene el texto del PDF con PDF.js, reconstruyendo líneas
   y espacios a partir de la posición de cada fragmento.
   ============================================================ */
import '../core/app.js';
import { $, plural } from '../core/dom.js';
import { toast, createProgress, toggle } from '../core/ui.js';
import { parsePageList } from '../core/ranges.js';
import { singlePdfTool, runTask, yieldToUI, createResultArea } from '../core/tool.js';
import { buildName, MIME } from '../core/download.js';

const options   = $('#options');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const output    = $('#output');
const outWrap   = $('#outputWrap');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: () => tool.reset() });

const tool = singlePdfTool({ dropZone: $('#dropZone'), summary: $('#fileSummary'), onLoad, onReset });
runBtn.addEventListener('click', () => runTask(runBtn, progress, extract));
$('#copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(output.value); toast('Texto copiado', 'success'); }
  catch { output.select(); toast('Selecciona el texto y cópialo con Ctrl+C', 'info'); }
});

function onLoad() {
  result.hide();
  output.value = '';
  toggle(outWrap, false);
  toggle(options, true);
  toggle(actionBar, true);
}

function onReset() {
  toggle(options, false);
  toggle(actionBar, false);
  toggle(outWrap, false);
  result.hide();
}

/**
 * Convierte los fragmentos de PDF.js en texto con saltos de línea.
 * @param {{str:string, transform:number[], width:number, height:number, hasEOL?:boolean}[]} items
 */
export function itemsToText(items) {
  let out = '';
  let last = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const [, , , d, x, y] = it.transform;
    const size = Math.abs(d) || it.height || 10;
    if (last) {
      const sameLine = Math.abs(y - last.y) < size * 0.5;
      if (!sameLine && !last.eol) out += '\n';
      else if (sameLine && !last.eol) {
        const gap = x - (last.x + last.width);
        if (gap > size * 0.15 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' ';
      }
    }
    out += it.str;
    if (it.hasEOL) out += '\n';
    last = { x, y, width: it.width, eol: Boolean(it.hasEOL) };
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function extract() {
  const ctx = tool.current;
  const v = $('#pagesInput').value.trim();
  const pages = v ? parsePageList(v, ctx.pageCount) : Array.from({ length: ctx.pageCount }, (_, i) => i);
  const withHeaders = $('#pageHeaders').checked;
  const r = await ctx.getRender();
  const parts = [];
  let chars = 0;
  for (let i = 0; i < pages.length; i++) {
    progress.set((i / pages.length) * 95, `Leyendo página ${pages[i] + 1}…`);
    if (i % 5 === 0) await yieldToUI();
    const page = await r.page(pages[i] + 1);
    const content = await page.getTextContent();
    const text = itemsToText(content.items);
    chars += text.replace(/\s/g, '').length;
    parts.push(withHeaders ? `===== Página ${pages[i] + 1} =====\n${text}` : text);
    page.cleanup();
  }
  progress.set(100, 'Listo');
  output.value = parts.join('\n\n');
  toggle(outWrap, true);

  const words = (output.value.match(/\S+/g) || []).length;
  const notes = [];
  if (chars === 0) {
    notes.push({ type: 'warning', text: 'No se ha encontrado texto. Probablemente es un documento escaneado (imágenes): haría falta OCR para reconocerlo.' });
  } else if (chars < pages.length * 20) {
    notes.push({ type: 'info', text: 'Hay muy poco texto: algunas páginas podrían ser imágenes escaneadas.' });
  }
  result.show({
    title: 'Texto extraído',
    meta: `${plural(pages.length, 'página')} · ${plural(words, 'palabra')}`,
    notes,
    files: [{ name: buildName(ctx.file.name, '', 'txt'), data: new TextEncoder().encode(output.value), type: MIME.txt }],
  });
  if (chars) toast('Texto extraído', 'success');
}

toggle(options, false);
toggle(actionBar, false);
toggle(outWrap, false);
