/* ============================================================
   UI — Toasts, progreso, estado de botones y diálogos modales.
   ============================================================ */
import { h } from './dom.js';
import { icon } from './icons.js';

// ---- Toasts ----------------------------------------------------
const TOAST_ICON = { success: 'check', error: 'error', warning: 'warning', info: 'info' };

function toastContainer() {
  let c = document.getElementById('toastContainer');
  if (!c) {
    c = h('div', { class: 'toast-container', id: 'toastContainer', 'aria-live': 'polite' });
    document.body.append(c);
  }
  return c;
}

/**
 * Muestra una notificación. El mensaje se inserta como texto.
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} [type]
 * @param {number} [duration] ms
 */
export function toast(message, type = 'info', duration = 4000) {
  const el = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
    icon(TOAST_ICON[type] || 'info'),
    h('span', {}, message),
  );
  toastContainer().append(el);
  const close = () => {
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 600); // por si no hay animación (reduced motion)
  };
  setTimeout(close, type === 'error' ? Math.max(duration, 6000) : duration);
  el.addEventListener('click', close);
}

// ---- Progreso --------------------------------------------------
/**
 * Controlador de barra de progreso.
 * @param {HTMLElement} wrap  Contenedor (se muestra/oculta)
 */
export function createProgress(wrap) {
  const bar   = wrap.querySelector('.progress-bar');
  const label = wrap.querySelector('.progress-label');
  const track = wrap.querySelector('.progress-wrap');
  let hideTimer;
  return {
    show() {
      clearTimeout(hideTimer);
      wrap.hidden = false;
      this.set(0, 'Preparando…');
    },
    set(pct, text) {
      const v = Math.min(100, Math.max(0, pct));
      if (bar) bar.style.width = `${v}%`;
      if (track) track.setAttribute('aria-valuenow', String(Math.round(v)));
      if (label) label.textContent = text || `${Math.round(v)}%`;
    },
    hide(delay = 900) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { wrap.hidden = true; }, delay);
    },
  };
}

// ---- Botones ---------------------------------------------------
export function setButtonLoading(btn, loading, label = 'Procesando…') {
  if (!btn) return;
  if (loading) {
    if (btn.dataset.loading) return;
    btn.dataset.loading = '1';
    btn.disabled = true;
    btn._original = Array.from(btn.childNodes);
    btn.replaceChildren(h('span', { class: 'spinner spinner-sm', 'aria-hidden': 'true' }), label);
    btn.setAttribute('aria-busy', 'true');
  } else {
    if (!btn.dataset.loading) return;
    delete btn.dataset.loading;
    btn.disabled = false;
    btn.replaceChildren(...(btn._original || []));
    btn.removeAttribute('aria-busy');
  }
}

// ---- Visibilidad ----------------------------------------------
export const show   = (el) => el && (el.hidden = false);
export const hide   = (el) => el && (el.hidden = true);
export const toggle = (el, cond) => el && (el.hidden = !cond);

// ---- Formato ---------------------------------------------------
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const val = bytes / Math.pow(k, i);
  return `${val.toLocaleString('es-ES', { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
}

// ---- Diálogos (basados en <dialog>, accesibles por teclado) ----
/**
 * Pide un valor al usuario. Resuelve con el texto o null si cancela.
 * @param {{title: string, message?: string, label?: string, type?: string,
 *          confirmText?: string, error?: string, autocomplete?: string}} opts
 */
export function promptDialog({ title, message = '', label = '', type = 'text', confirmText = 'Aceptar', error = '', autocomplete = 'off' }) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'form-input', type, id: 'dlgInput', autocomplete, spellcheck: 'false' });
    const toggleBtn = type === 'password'
      ? h('button', { type: 'button', class: 'password-toggle', 'aria-label': 'Mostrar u ocultar contraseña',
          onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; input.focus(); } }, icon('eye'))
      : null;
    const errEl = h('p', { class: 'dialog__error', role: 'alert' }, error);
    errEl.hidden = !error;

    const form = h('form', { method: 'dialog', class: 'dialog__body' },
      h('h2', { class: 'dialog__title' }, title),
      message ? h('p', { class: 'dialog__msg' }, message) : null,
      h('div', { class: 'form-group' },
        label ? h('label', { class: 'form-label', for: 'dlgInput' }, label) : null,
        type === 'password' ? h('div', { class: 'password-wrap' }, input, toggleBtn) : input,
      ),
      errEl,
      h('div', { class: 'dialog__actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', value: 'cancel', onclick: () => finish(null) }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn btn-primary', value: 'ok' }, confirmText),
      ),
    );
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 'dlgTitle' }, form);
    form.querySelector('.dialog__title').id = 'dlgTitle';

    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); finish(input.value); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });

    document.body.append(dlg);
    dlg.showModal();
    input.focus();
  });
}

/** Confirmación sí/no. Resuelve true/false. */
export function confirmDialog({ title, message = '', confirmText = 'Continuar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; dlg.close(); dlg.remove(); resolve(v); };
    const dlg = h('dialog', { class: 'dialog' },
      h('div', { class: 'dialog__body' },
        h('h2', { class: 'dialog__title' }, title),
        message ? h('p', { class: 'dialog__msg' }, message) : null,
        h('div', { class: 'dialog__actions' },
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => finish(false) }, cancelText),
          h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => finish(true) }, confirmText),
        ),
      ),
    );
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('.btn-primary, .btn-danger').focus();
  });
}
