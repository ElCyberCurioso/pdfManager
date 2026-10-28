/* ============================================================
   ANALIZAR Y SANEAR
   Triaje de seguridad de un PDF (JavaScript, acciones, Launch,
   adjuntos, enlaces, ofuscación, políglotas…), informe
   exportable (Markdown/JSON con hashes) y saneado selectivo.
   ============================================================ */
import '../core/app.js';
import { $, h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, createProgress, formatBytes, toggle } from '../core/ui.js';
import { loadPlain, savePdf } from '../core/pdf-engine.js';
import { rawScan, analyze, sanitize, PDFID_KEYWORDS } from '../core/pdf-analyzer.js';
import { stripAllMetadata } from '../core/optimize.js';
import { singlePdfTool, runTask, createResultArea } from '../core/tool.js';
import { buildName, saveFile, MIME } from '../core/download.js';

const LEVELS = {
  ok:     { title: 'No se han detectado riesgos', text: 'No hay JavaScript, acciones automáticas, adjuntos ni otros elementos activos.', icon: 'check' },
  low:    { title: 'Riesgo bajo', text: 'Solo elementos habituales (enlaces, formularios…). Revísalos igualmente.', icon: 'info' },
  medium: { title: 'Riesgo medio', text: 'Hay elementos que pueden usarse con fines maliciosos. Revisa los detalles antes de abrirlo en tu visor habitual.', icon: 'warning' },
  high:   { title: 'Riesgo alto', text: 'Contiene elementos activos típicos de PDFs maliciosos. No lo abras en un visor con JavaScript activado; sanéalo antes.', icon: 'error' },
};
const SEV_LABEL = { high: 'Alto', medium: 'Medio', low: 'Bajo', info: 'Info' };
const SEV_BADGE = { high: 'badge-danger', medium: 'badge-warning', low: 'badge-info', info: '' };

const report    = $('#report');
const sanitizer = $('#sanitizer');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: () => tool.reset() });
let last = null; // {analysis, raw, hashes}

const tool = singlePdfTool({ dropZone: $('#dropZone'), summary: $('#fileSummary'), onLoad, onReset });
runBtn.addEventListener('click', () => runTask(runBtn, progress, clean));
$('#mdBtn').addEventListener('click', () => exportReport('md'));
$('#jsonBtn').addEventListener('click', () => exportReport('json'));

async function digest(algo, bytes) {
  const buf = await crypto.subtle.digest(algo, bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function onLoad(ctx) {
  result.hide();
  const original = new Uint8Array(await ctx.file.arrayBuffer());
  const raw = rawScan(original);
  const analysis = analyze(ctx.doc, raw, { encryption: ctx.encryption });
  const hashes = { sha256: await digest('SHA-256', original), sha1: await digest('SHA-1', original) };
  last = { analysis, raw, hashes };
  renderReport(ctx, analysis, raw, hashes);

  // Opciones de saneado según lo encontrado
  const has = (id) => analysis.findings.some((f) => f.id === id || f.id.startsWith(id));
  $('#sScripts').checked = true;
  $('#sAttach').checked = has('attachments');
  $('#sLinks').checked = analysis.findings.some((f) => f.id === 'links' && f.severity !== 'low');
  $('#sXfa').checked = true;
  $('#sMedia').checked = true;
  $('#sMeta').checked = false;
  toggle(report, true);
  toggle(sanitizer, true);
  toggle(actionBar, true);
}

function onReset() {
  last = null;
  toggle(report, false);
  toggle(sanitizer, false);
  toggle(actionBar, false);
  result.hide();
}

function renderReport(ctx, analysis, raw, hashes) {
  const L = LEVELS[analysis.level];
  const counts = analysis.findings.reduce((m, f) => ({ ...m, [f.severity]: (m[f.severity] || 0) + 1 }), {});
  $('#score').dataset.level = analysis.level;
  $('#score').replaceChildren(
    h('div', { class: 'score__dot' }, icon(L.icon)),
    h('div', { class: 'grow' },
      h('div', { class: 'score__title', 'data-testid': 'risk-level' }, L.title),
      h('p', { class: 'text-sm', style: { margin: 0 } }, L.text),
      h('div', { class: 'flex gap-2 flex-wrap mt-2' },
        ['high', 'medium', 'low'].filter((s) => counts[s]).map((s) => h('span', { class: `badge ${SEV_BADGE[s]}` }, `${counts[s]} ${SEV_LABEL[s].toLowerCase()}`)))),
  );

  $('#findings').replaceChildren(...(analysis.findings.length ? analysis.findings.map((f) =>
    h('details', { class: 'finding', 'data-severity': f.severity, open: f.severity === 'high' ? true : null, 'data-testid': `finding-${f.id}` },
      h('summary', {},
        h('span', { class: `badge ${SEV_BADGE[f.severity]}` }, SEV_LABEL[f.severity]),
        h('span', { class: 'grow' }, f.title),
        icon('down')),
      h('div', { class: 'finding__body' },
        f.detail ? h('p', {}, f.detail) : null,
        f.items.length ? h('ul', { class: 'finding__items' }, f.items.slice(0, 200).map((it) => h('li', {}, it)),
          f.items.length > 200 ? h('li', {}, `… y ${f.items.length - 200} más`) : null) : null)))
    : [h('p', { class: 'text-muted text-sm' }, 'Sin hallazgos.')]));

  const kv = [
    ['Archivo', ctx.file.name],
    ['Tamaño', `${formatBytes(ctx.file.size)} (${ctx.file.size} bytes)`],
    ['Cabecera', raw.header || '—'],
    ['SHA-256', hashes.sha256],
    ['SHA-1', hashes.sha1],
    ['Secciones %%EOF', String(raw.eofCount)],
  ];
  $('#fingerprint').replaceChildren(h('table', { class: 'data-table' },
    h('tbody', {}, kv.map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', { class: k.startsWith('SHA') ? 'mono text-xs' : '' }, v))))));
  $('#pdfid').replaceChildren(h('table', { class: 'data-table mono text-xs' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Palabra clave'), h('th', {}, 'Apariciones'), h('th', {}, 'Ofuscadas'))),
    h('tbody', {}, PDFID_KEYWORDS.map((k) => h('tr', {}, h('td', {}, k), h('td', {}, String(raw.counts[k])), h('td', {}, String(raw.obfuscated[k] || ''))))),
  ));
}

function exportReport(format) {
  const ctx = tool.current;
  if (!ctx || !last) return;
  const { analysis, raw, hashes } = last;
  const base = buildName(ctx.file.name, '_informe', format);
  if (format === 'json') {
    const data = {
      tool: 'PDF Manager — Analizar y sanear', generated: new Date().toISOString(),
      file: { name: ctx.file.name, size: ctx.file.size, ...hashes, header: raw.header },
      risk: analysis.level, findings: analysis.findings, pdfid: { counts: raw.counts, obfuscated: raw.obfuscated, eofCount: raw.eofCount, headerOffset: raw.headerOffset, trailingBytes: raw.trailingBytes },
    };
    saveFile(new TextEncoder().encode(JSON.stringify(data, null, 2)), base, MIME.json);
    return;
  }
  const md = [
    `# Informe de análisis: ${ctx.file.name}`, '',
    `- **Riesgo:** ${LEVELS[analysis.level].title}`,
    `- **Tamaño:** ${ctx.file.size} bytes`,
    `- **SHA-256:** \`${hashes.sha256}\``,
    `- **SHA-1:** \`${hashes.sha1}\``,
    `- **Cabecera:** ${raw.header || '—'} · **Secciones %%EOF:** ${raw.eofCount}`,
    `- **Generado:** ${new Date().toLocaleString('es-ES')} con PDF Manager (análisis local en el navegador)`, '',
    '## Hallazgos', '',
    ...(analysis.findings.length ? analysis.findings.flatMap((f) => [
      `### [${SEV_LABEL[f.severity]}] ${f.title}`, '', f.detail || '', '',
      ...f.items.map((i) => `- \`${i.replace(/`/g, "'")}\``), '',
    ]) : ['Sin hallazgos.', '']),
    '## Recuento de palabras clave (estilo pdfid)', '',
    '| Palabra clave | Apariciones | Ofuscadas |', '|---|---:|---:|',
    ...PDFID_KEYWORDS.map((k) => `| \`${k}\` | ${raw.counts[k]} | ${raw.obfuscated[k] || ''} |`), '',
    '> Nota: el recuento en bruto no ve el interior de los object streams comprimidos; los hallazgos sí (se obtienen del documento analizado).', '',
  ].join('\n');
  saveFile(new TextEncoder().encode(md), base, 'text/markdown;charset=utf-8');
}

async function clean() {
  const ctx = tool.current;
  const opts = {
    scripts: $('#sScripts').checked, attachments: $('#sAttach').checked, links: $('#sLinks').checked,
    xfa: $('#sXfa').checked, media: $('#sMedia').checked,
  };
  if (!Object.values(opts).some(Boolean) && !$('#sMeta').checked) throw new Error('Marca al menos una opción de saneado.');
  progress.set(20, 'Saneando…');
  const doc = await loadPlain(ctx.bytes);
  const removed = sanitize(doc, opts);
  if ($('#sMeta').checked) stripAllMetadata(doc);
  progress.set(70, 'Reconstruyendo el archivo…');
  const bytes = await savePdf(doc);
  progress.set(90, 'Verificando…');
  const after = analyze(await loadPlain(bytes), rawScan(bytes));
  progress.set(100, 'Listo');
  const total = Object.values(removed).reduce((a, b) => a + b, 0);
  const summary = Object.entries(removed).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ');
  const notes = [{
    type: after.level === 'high' || after.level === 'medium' ? 'warning' : 'success',
    text: `Tras sanear: ${LEVELS[after.level].title.toLowerCase()}. El archivo se ha reconstruido desde cero, así que también desaparecen las versiones anteriores (actualizaciones incrementales) y los datos ocultos tras el final.`,
  }];
  if (ctx.encryption) notes.push({ type: 'info', text: 'El PDF original estaba cifrado; el resultado se guarda sin cifrar.' });
  result.show({
    title: '¡PDF saneado!',
    meta: total ? `Eliminado: ${summary}` : 'no había elementos activos que eliminar',
    notes,
    files: [{ name: buildName(ctx.file.name, '_saneado'), data: bytes }],
  });
  toast('PDF saneado', 'success');
}

toggle(report, false);
toggle(sanitizer, false);
toggle(actionBar, false);
