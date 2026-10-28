/* ============================================================
   PROTEGER PDF
   Cifrado real AES-256 (o AES-128 por compatibilidad) con
   contraseña de apertura y/o permisos de uso.
   (El original usaba pdf-lib estándar, que ignora las opciones
   de cifrado: el PDF «protegido» salía en claro.)
   ============================================================ */
import '../core/app.js';
import { $, h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { toast, createProgress, toggle } from '../core/ui.js';
import { loadPlain } from '../core/pdf-engine.js';
import { passwordStrength, randomPassword } from '../core/password.js';
import { singlePdfTool, runTask, createResultArea } from '../core/tool.js';
import { buildName } from '../core/download.js';

const options   = $('#options');
const actionBar = $('#actionBar');
const runBtn    = $('#runBtn');
const userPwd   = $('#userPwd');
const userPwd2  = $('#userPwd2');
const ownerPwd  = $('#ownerPwd');
const needOpen  = $('#needOpen');
const progress  = createProgress($('#progress'));
const result    = createResultArea($('#result'), { onRestart: () => tool.reset() });

const tool = singlePdfTool({ dropZone: $('#dropZone'), summary: $('#fileSummary'), onLoad, onReset });

// Mostrar/ocultar contraseñas
document.querySelectorAll('.password-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(input.type === 'text'));
  });
});

userPwd.addEventListener('input', paintStrength);
[userPwd, userPwd2].forEach((el) => el.addEventListener('input', checkMatch));
needOpen.addEventListener('change', () => { toggle($('#openBox'), needOpen.checked); result.hide(); });
$('#genBtn').addEventListener('click', () => {
  const pw = randomPassword(20);
  userPwd.value = userPwd2.value = pw;
  userPwd.type = userPwd2.type = 'text';
  paintStrength();
  checkMatch();
  toast('Contraseña generada: cópiala antes de cerrar la página.', 'info');
});
runBtn.addEventListener('click', () => runTask(runBtn, progress, protect));

function onLoad(ctx) {
  result.hide();
  toggle(options, true);
  toggle(actionBar, true);
  $('#reEncryptNote').hidden = !ctx.encryption;
  userPwd.focus();
}

function onReset() {
  userPwd.value = userPwd2.value = ownerPwd.value = '';
  paintStrength();
  toggle(options, false);
  toggle(actionBar, false);
  result.hide();
}

function paintStrength() {
  const s = passwordStrength(userPwd.value);
  const el = $('#strength');
  el.dataset.level = userPwd.value ? String(s.level) : '';
  $('#strengthLabel').textContent = userPwd.value ? s.label : '';
}

function checkMatch() {
  const bad = userPwd2.value && userPwd.value !== userPwd2.value;
  userPwd2.setAttribute('aria-invalid', bad ? 'true' : 'false');
  $('#matchError').hidden = !bad;
}

function permissions() {
  const print = $('#permPrint').value;
  return {
    printing: print === 'none' ? false : print === 'low' ? 'lowResolution' : 'highResolution',
    copying: $('#permCopy').checked,
    modifying: $('#permModify').checked,
    annotating: $('#permAnnotate').checked,
    fillingForms: $('#permForms').checked,
    documentAssembly: $('#permAssembly').checked,
    contentAccessibility: $('#permAccess').checked,
  };
}

async function protect() {
  const ctx = tool.current;
  const wantsOpen = needOpen.checked;
  const user = wantsOpen ? userPwd.value : '';
  if (wantsOpen) {
    if (!user) throw new Error('Escribe la contraseña de apertura (o desmarca «Exigir contraseña para abrir»).');
    if (user !== userPwd2.value) throw new Error('Las contraseñas no coinciden.');
  }
  const perms = permissions();
  const restricted = Object.values(perms).filter((v) => v !== true && v !== 'highResolution').length;
  if (!wantsOpen && restricted === 0) throw new Error('No hay nada que proteger: añade una contraseña de apertura o quita algún permiso.');

  // Sin contraseña de propietario, cualquiera con la de apertura podría
  // quitar las restricciones: generamos una aleatoria y la mostramos.
  let owner = ownerPwd.value;
  const generated = !owner;
  if (!owner) owner = randomPassword(24);
  if (owner === user && restricted) {
    throw new Error('La contraseña de propietario debe ser distinta de la de apertura; si no, los permisos no protegen nada.');
  }
  const algorithm = $('#algo').value;

  progress.set(30, 'Cifrando…');
  const doc = await loadPlain(ctx.bytes);
  doc.encrypt({ userPassword: user, ownerPassword: owner, permissions: perms, algorithm });
  progress.set(70, 'Guardando…');
  const bytes = await doc.save({ useObjectStreams: true });
  progress.set(100, 'Listo');

  const notes = [];
  if (!wantsOpen) notes.push({ type: 'info', text: 'El PDF se abre sin contraseña. Las restricciones las aplican los visores, pero no impiden leer el contenido.' });
  const extra = generated && restricted
    ? h('div', { class: 'flex flex-col gap-2', style: { width: '100%', maxWidth: '620px' } },
        h('span', { class: 'form-label' }, 'Contraseña de propietario generada (guárdala para poder cambiar los permisos):'),
        h('div', { class: 'secret-box' },
          h('span', { class: 'grow', 'data-testid': 'owner-password' }, owner),
          h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => {
              try { await navigator.clipboard.writeText(owner); toast('Copiada al portapapeles', 'success'); }
              catch { toast('No se pudo copiar: selecciónala manualmente.', 'warning'); }
            },
          }, icon('copy'), 'Copiar')))
    : null;

  result.show({
    title: '¡PDF protegido!',
    meta: [algorithm, wantsOpen ? 'con contraseña de apertura' : 'sin contraseña de apertura', restricted ? `${restricted} restricción(es)` : 'sin restricciones'].join(' · '),
    notes,
    extra,
    files: [{ name: buildName(ctx.file.name, '_protegido'), data: bytes }],
  });
  toast('PDF cifrado correctamente', 'success');
}

toggle(options, false);
toggle(actionBar, false);
paintStrength();
