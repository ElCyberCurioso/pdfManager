/* ============================================================
   EDITAR METADATOS
   Ver y editar el diccionario /Info, ver el XMP y la ficha
   técnica del documento, o eliminarlo todo (privacidad).
   ============================================================ */
import '../core/app.js';
import { $, h, plural } from '../core/dom.js';
import { toast, createProgress, formatBytes, toggle } from '../core/ui.js';
import { loadPlain, savePdf } from '../core/pdf-engine.js';
import { N, textOf, removeUnreachable } from '../core/pdf-objects.js';
import { stripAllMetadata } from '../core/optimize.js';
import { PDFLib } from '../core/libs.js';
import { singlePdfTool, runTask, createResultArea, encryptedInputNote } from '../core/tool.js';
import { buildName } from '../core/download.js';

const { PDFDict, PDFRawStream, PDFHexString, PDFArray, decodePDFRawStream } = PDFLib;

const FIELDS = [
  { key: 'Title', label: 'Título' },
  { key: 'Author', label: 'Autor' },
  { key: 'Subject', label: 'Asunto' },
  { key: 'Keywords', label: 'Palabras clave' },
  { key: 'Creator', label: 'Aplicación de origen' },
  { key: 'Producer', label: 'Productor PDF' },
];

const editor    = $('#editor');
const actionBar = $('#actionBar');
const saveBtn   = $('#runBtn');
const stripBtn  = $('#stripBtn');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: () => tool.reset() });

const tool = singlePdfTool({ dropZone: $('#dropZone'), summary: $('#fileSummary'), onLoad, onReset });
saveBtn.addEventListener('click', () => runTask(saveBtn, progress, () => save(false)));
stripBtn.addEventListener('click', () => runTask(stripBtn, progress, () => save(true)));
editor.addEventListener('input', () => result.hide());

// Campos de texto
$('#fields').replaceChildren(...FIELDS.map((f) => h('div', { class: 'form-group' },
  h('label', { class: 'form-label', for: `f${f.key}` }, f.label),
  h('input', { type: 'text', class: 'form-input', id: `f${f.key}`, spellcheck: 'false', autocomplete: 'off' }))));

const infoDict = (doc) => {
  const ref = doc.context.trailerInfo.Info;
  const d = ref ? doc.context.lookup(ref) : null;
  return d instanceof PDFDict ? d : null;
};

/** Date → valor para <input type="datetime-local"> (hora local). */
const toLocalInput = (d) => (d instanceof Date && !isNaN(d) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

/** Lee el XMP del catálogo como texto (o null). */
function readXmp(doc) {
  const s = doc.catalog.lookup(N('Metadata'));
  if (!(s instanceof PDFRawStream)) return null;
  try {
    const bytes = s.dict.get(N('Filter')) ? decodePDFRawStream(s).decode() : s.contents;
    return new TextDecoder('utf-8').decode(bytes);
  } catch { return '(no se pudo decodificar el XMP)'; }
}

function onLoad(ctx) {
  result.hide();
  const doc = ctx.doc;
  const info = infoDict(doc);
  for (const f of FIELDS) $(`#f${f.key}`).value = info ? textOf(info.lookup(N(f.key))) : '';
  $('#fCreated').value = toLocalInput(doc.getCreationDate());
  $('#fModified').value = toLocalInput(doc.getModificationDate());
  const lang = doc.catalog.lookup(N('Lang'));
  $('#fLang').value = lang ? textOf(lang) : '';

  // Ficha técnica
  const sizes = doc.getPages().map((p) => { const { width, height } = p.getSize(); return `${Math.round(width * 25.4 / 72)} × ${Math.round(height * 25.4 / 72)} mm`; });
  const uniqueSizes = [...new Set(sizes)];
  const acro = doc.catalog.lookup(N('AcroForm'));
  const fields = acro instanceof PDFDict ? acro.lookup(N('Fields')) : null;
  const markInfo = doc.catalog.lookup(N('MarkInfo'));
  const tagged = markInfo instanceof PDFDict && String(markInfo.get(N('Marked'))) === 'true';
  const id = doc.context.trailerInfo.ID;
  const idArr = id ? doc.context.lookup(id) : null;
  const xmp = readXmp(doc);
  const rows = [
    ['Versión PDF', ctx.bytes ? headerVersion(ctx.bytes) : '—'],
    ['Páginas', String(ctx.pageCount)],
    ['Tamaño de página', uniqueSizes.length === 1 ? uniqueSizes[0] : `${uniqueSizes.length} tamaños distintos (p. ej. ${uniqueSizes.slice(0, 2).join(', ')})`],
    ['Tamaño del archivo', formatBytes(ctx.file.size)],
    ['Cifrado', ctx.encryption ? `${ctx.encryption.algorithm}${ctx.needsUserPassword ? ' (con contraseña)' : ' (solo restricciones)'}` : 'No'],
    ['Etiquetado (accesible)', tagged ? 'Sí' : 'No'],
    ['Formulario', fields instanceof PDFArray ? plural(fields.size(), 'campo') : 'No'],
    ['Metadatos XMP', xmp ? `Sí (${formatBytes(xmp.length)})` : 'No'],
    ['Identificador (/ID)', idArr instanceof PDFArray && idArr.get(0) instanceof PDFHexString ? idArr.get(0).asString() : '—'],
  ];
  $('#facts').replaceChildren(h('table', { class: 'data-table' },
    h('caption', { class: 'sr-only' }, 'Ficha técnica'),
    h('tbody', {}, rows.map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', { class: k.includes('/ID') ? 'mono text-xs' : '' }, v))))));
  toggle($('#xmpBox'), Boolean(xmp));
  $('#xmpText').textContent = xmp || '';
  $('#dropXmp').checked = Boolean(xmp);
  $('#dropXmp').disabled = !xmp;
  toggle(editor, true);
  toggle(actionBar, true);
}

function headerVersion(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.match(/%PDF-(\d\.\d)/)?.[1] || '—';
}

function onReset() {
  toggle(editor, false);
  toggle(actionBar, false);
  result.hide();
}

function setOrDelete(info, key, value) {
  if (value) info.set(N(key), PDFHexString.fromText(value));
  else info.delete(N(key));
}

async function save(stripAll) {
  const ctx = tool.current;
  const doc = await loadPlain(ctx.bytes);
  progress.set(40, stripAll ? 'Eliminando metadatos…' : 'Aplicando cambios…');
  if (stripAll) {
    stripAllMetadata(doc);
    doc.catalog.delete(N('PieceInfo'));
    for (const p of doc.getPages()) p.node.delete(N('PieceInfo'));
    // Nuevo identificador: el /ID permite relacionar versiones de un documento.
    const rnd = crypto.getRandomValues(new Uint8Array(16));
    const idHex = PDFHexString.of([...rnd].map((b) => b.toString(16).padStart(2, '0')).join(''));
    doc.context.trailerInfo.ID = doc.context.obj([idHex, idHex]);
  } else {
    if (!doc.context.trailerInfo.Info) doc.context.trailerInfo.Info = doc.context.register(doc.context.obj({}));
    const info = infoDict(doc);
    for (const f of FIELDS) setOrDelete(info, f.key, $(`#f${f.key}`).value.trim());
    const created = $('#fCreated').value;
    if (created) doc.setCreationDate(new Date(created)); else info.delete(N('CreationDate'));
    if ($('#touchMod').checked) doc.setModificationDate(new Date());
    else if ($('#fModified').value) doc.setModificationDate(new Date($('#fModified').value));
    else info.delete(N('ModDate'));
    const lang = $('#fLang').value.trim();
    if (lang) doc.catalog.set(N('Lang'), PDFLib.PDFString.of(lang)); else doc.catalog.delete(N('Lang'));
    if ($('#dropXmp').checked) doc.catalog.delete(N('Metadata'));
  }
  removeUnreachable(doc); // que los valores antiguos no queden huérfanos dentro del archivo
  progress.set(80, 'Guardando…');
  const bytes = await savePdf(doc);
  progress.set(100, 'Listo');
  const notes = [];
  if (!stripAll && !$('#dropXmp').checked && readXmp(doc)) {
    notes.push({ type: 'warning', text: 'Has conservado el XMP: algunos visores muestran sus valores en lugar de los editados.' });
  }
  const enc = encryptedInputNote(ctx);
  if (enc) notes.push(enc);
  result.show({
    title: stripAll ? '¡Metadatos eliminados!' : '¡Metadatos actualizados!',
    meta: stripAll ? 'Info, XMP e identificador renovados' : '',
    notes,
    files: [{ name: buildName(ctx.file.name, stripAll ? '_sin_metadatos' : '_metadatos'), data: bytes }],
  });
  toast(stripAll ? 'Metadatos eliminados' : 'Metadatos guardados', 'success');
}

toggle(editor, false);
toggle(actionBar, false);
