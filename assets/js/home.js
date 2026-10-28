/* ============================================================
   PORTADA — Catálogo de herramientas con buscador.
   ============================================================ */
import './core/app.js';
import { $, h } from './core/dom.js';
import { icon } from './core/icons.js';
import { TOOLS, CATEGORIES, toolUrl } from './core/registry.js';

const catalog = $('#catalog');
const search = $('#search');
const empty = $('#empty');

/** Normaliza para buscar sin tildes ni mayúsculas. */
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const cards = new Map();
function card(t) {
  const el = h('a', { href: toolUrl(t), class: 'tool-card', 'data-tool': t.id },
    h('div', { class: 'tool-card__icon' }, icon(t.icon)),
    t.isNew ? h('span', { class: 'badge badge-primary tool-card__new' }, 'Nuevo') : null,
    h('div', { class: 'tool-card__body' },
      h('h3', { class: 'tool-card__title' }, t.title),
      h('p', { class: 'tool-card__desc' }, t.desc)));
  el._haystack = norm(`${t.title} ${t.desc} ${t.keywords || ''}`);
  cards.set(t.id, el);
  return el;
}

catalog.replaceChildren(...CATEGORIES.map((cat) =>
  h('section', { class: 'tools-category', 'data-category': cat.id, 'aria-labelledby': `cat-${cat.id}` },
    h('h2', { class: 'tools-category__title', id: `cat-${cat.id}` }, cat.name),
    h('div', { class: 'tools-grid' }, TOOLS.filter((t) => t.category === cat.id).map(card)))));

function filter() {
  const terms = norm(search.value.trim()).split(/\s+/).filter(Boolean);
  let visible = 0;
  for (const el of cards.values()) {
    const ok = terms.every((t) => el._haystack.includes(t));
    el.hidden = !ok;
    if (ok) visible++;
  }
  catalog.querySelectorAll('.tools-category').forEach((sec) => {
    sec.hidden = !sec.querySelector('.tool-card:not([hidden])');
  });
  empty.hidden = visible > 0;
}

search.addEventListener('input', filter);
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = catalog.querySelector('.tool-card:not([hidden])');
    if (first) location.href = first.href;
  } else if (e.key === 'Escape') {
    search.value = '';
    filter();
  }
});
// «/» enfoca el buscador (como en GitHub)
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.target.closest('input, textarea, select')) {
    e.preventDefault();
    search.focus();
  }
});
