/* ============================================================
   DOM — Helpers mínimos para crear nodos de forma segura.
   Regla del proyecto: los datos que vienen del usuario o de un
   PDF (nombres de archivo, metadatos, URLs…) se insertan SIEMPRE
   como texto, nunca con innerHTML.
   ============================================================ */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Crea un elemento. Los hijos de tipo string se añaden como nodos
 * de texto (escapados por el navegador).
 *
 * @param {string} tag
 * @param {Object} [attrs]  class, dataset, style (objeto), on* (listeners), resto → setAttribute
 * @param {...(Node|string|number|null|undefined|false)} children
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'text') el.textContent = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Vacía un nodo. */
export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Plural sencillo en español: plural(3, 'página') → '3 páginas'. */
export function plural(n, singular, pluralForm = singular + 's') {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Espera al siguiente frame (deja respirar al hilo principal). */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** Debounce clásico. */
export function debounce(fn, ms = 150) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
