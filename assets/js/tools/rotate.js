/* ============================================================
   ROTAR PDF
   Gira páginas sueltas, una selección (pares, impares, rango)
   o el documento completo. Rotación sin pérdida (/Rotate).
   ============================================================ */
import '../core/app.js';
import { $, plural } from '../core/dom.js';
import { toast, createProgress, toggle } from '../core/ui.js';
import { loadPlain, savePdf } from '../core/pdf-engine.js';
import { parsePageList } from '../core/ranges.js';
import { PageGrid } from '../core/page-grid.js';
import { PDFLib } from '../core/libs.js';
import { singlePdfTool, runTask, createResultArea, pageItems, encryptedInputNote } from '../core/tool.js';
import { buildName } from '../core/download.js';

const editor    = $('#editor');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const infoEl    = $('#gridInfo');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: () => tool.reset() });
let grid = null;

const tool = singlePdfTool({ dropZone: $('#dropZone'), summary: $('#fileSummary'), onLoad, onReset });

$('#selAll').addEventListener('click', () => grid.selectAll(true));
$('#selNone').addEventListener('click', () => grid.selectAll(false));
$('#selEven').addEventListener('click', () => grid.selectIndices(parsePageList('pares', grid.items().length)));
$('#selOdd').addEventListener('click', () => grid.selectIndices(parsePageList('impares', grid.items().length)));
$('#rotLeft').addEventListener('click', () => apply(-90));
$('#rotRight').addEventListener('click', () => apply(90));
$('#rot180').addEventListener('click', () => apply(180));
$('#resetRot').addEventListener('click', () => { grid.items().forEach((it) => { it.rotation = 0; grid.refresh(it); }); update(); });
runBtn.addEventListener('click', () => runTask(runBtn, progress, save));

function onLoad(ctx) {
  result.hide();
  grid?.destroy();
  grid = new PageGrid($('#pageGrid'), {
    selectable: true,
    actions: [
      { id: 'rotl', icon: 'rotateLeft', label: 'Girar a la izquierda' },
      { id: 'rotr', icon: 'rotate', label: 'Girar a la derecha' },
    ],
    ariaLabel: 'Páginas del documento',
    onAction: (id, item) => { rotate(item, id === 'rotl' ? -90 : 90); update(); },
    onChange: update,
  });
  grid.setItems(pageItems(ctx.getRender, ctx.pageCount, () => ({ rotation: 0 })));
  toggle(editor, true);
  toggle(actionBar, true);
  update();
}

function onReset() {
  grid?.destroy();
  grid = null;
  toggle(editor, false);
  toggle(actionBar, false);
  result.hide();
}

function rotate(item, delta) {
  item.rotation = (((item.rotation + delta) % 360) + 360) % 360;
  grid.refresh(item);
}

function apply(delta) {
  const sel = grid.selectedItems();
  const list = sel.length ? sel : grid.items();
  list.forEach((it) => rotate(it, delta));
  update();
}

function update() {
  if (!grid) return;
  result.hide();
  const sel = grid.selectedIndices().length;
  const changed = grid.items().filter((it) => it.rotation).length;
  infoEl.textContent = sel
    ? `${sel} seleccionada${sel === 1 ? '' : 's'} · los botones giran la selección`
    : 'Sin selección · los botones giran todas las páginas';
  runBtn.disabled = changed === 0;
  runBtn.title = changed ? '' : 'Gira al menos una página';
}

async function save() {
  const ctx = tool.current;
  const doc = await loadPlain(ctx.bytes);
  const items = grid.items();
  let changed = 0;
  doc.getPages().forEach((page, i) => {
    const delta = items[i].rotation;
    if (!delta) return;
    changed++;
    page.setRotation(PDFLib.degrees((page.getRotation().angle + delta) % 360));
  });
  progress.set(70, 'Guardando…');
  const bytes = await savePdf(doc);
  progress.set(100, 'Listo');
  const note = encryptedInputNote(ctx);
  result.show({
    title: '¡Rotación aplicada!',
    meta: `${plural(changed, 'página rotada', 'páginas rotadas')}`,
    files: [{ name: buildName(ctx.file.name, '_rotado'), data: bytes }],
    notes: note ? [note] : [],
  });
  toast('Rotación aplicada', 'success');
}

toggle(editor, false);
toggle(actionBar, false);
