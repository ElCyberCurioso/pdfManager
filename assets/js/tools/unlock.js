/* ============================================================
   DESBLOQUEAR PDF
   Quita la contraseña (si la conoces) o las restricciones de
   uso, y muestra cómo estaba protegido el documento.
   ============================================================ */
import '../core/app.js';
import { $, h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, createProgress, toggle } from '../core/ui.js';
import { loadPlain, savePdf } from '../core/pdf-engine.js';
import { singlePdfTool, runTask, createResultArea } from '../core/tool.js';
import { buildName } from '../core/download.js';

const infoBox   = $('#info');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: () => tool.reset() });

const tool = singlePdfTool({ dropZone: $('#dropZone'), summary: $('#fileSummary'), onLoad, onReset });
runBtn.addEventListener('click', () => runTask(runBtn, progress, unlock));

const PERM_LABELS = {
  printing: 'Imprimir',
  copying: 'Copiar texto e imágenes',
  modifying: 'Modificar el contenido',
  annotating: 'Añadir comentarios',
  fillingForms: 'Rellenar formularios',
  assembly: 'Insertar, girar o eliminar páginas',
  accessibility: 'Extracción para accesibilidad',
};

function onLoad(ctx) {
  result.hide();
  const enc = ctx.encryption;
  if (!enc) {
    infoBox.replaceChildren(h('div', { class: 'alert alert-success' }, icon('check'),
      h('p', {}, h('strong', {}, 'Este PDF no está protegido. '), 'No tiene contraseña ni restricciones de uso: no hace falta desbloquearlo.')));
    toggle(infoBox, true);
    toggle(actionBar, false);
    return;
  }
  const rows = [
    ['Cifrado', `${enc.algorithm} (revisión ${enc.revision || '?'})`],
    ['Contraseña de apertura', ctx.needsUserPassword ? 'Sí (la has introducido correctamente)' : 'No: solo tenía restricciones de uso'],
    ...Object.entries(PERM_LABELS).map(([k, label]) => {
      const v = enc.permissions[k];
      const ok = v === true || v === 'sí';
      return [label, h('span', { class: `badge ${ok ? 'badge-success' : v === 'baja resolución' ? 'badge-warning' : 'badge-danger'}` }, typeof v === 'string' ? v : ok ? 'permitido' : 'restringido')];
    }),
  ];
  infoBox.replaceChildren(
    enc.weak ? h('div', { class: 'alert alert-warning' }, icon('warning'),
      h('p', {}, h('strong', {}, 'Cifrado obsoleto. '), `${enc.algorithm} se considera inseguro desde hace años: si necesitas protegerlo, vuelve a cifrarlo con AES-256 en «Proteger PDF».`)) : null,
    h('div', { class: 'table-scroll' }, h('table', { class: 'data-table' },
      h('caption', { class: 'sr-only' }, 'Protección del documento'),
      h('tbody', {}, rows.map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, v)))))),
  );
  toggle(infoBox, true);
  toggle(actionBar, true);
}

function onReset() {
  toggle(infoBox, false);
  toggle(actionBar, false);
  result.hide();
}

async function unlock() {
  const ctx = tool.current;
  // ctx.bytes ya está descifrado: se reescribe para normalizarlo.
  progress.set(50, 'Eliminando la protección…');
  const doc = await loadPlain(ctx.bytes);
  const bytes = await savePdf(doc);
  progress.set(100, 'Listo');
  result.show({
    title: '¡PDF desbloqueado!',
    meta: ctx.needsUserPassword ? 'contraseña eliminada' : 'restricciones eliminadas',
    files: [{ name: buildName(ctx.file.name, '_desbloqueado'), data: bytes }],
  });
  toast('Protección eliminada', 'success');
}

toggle(infoBox, false);
toggle(actionBar, false);
