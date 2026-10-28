/* ============================================================
   PAGE GRID — Rejilla de miniaturas de páginas.
   - Renderizado diferido (solo lo visible) con cola limitada.
   - Selección accesible: clic, Mayús+clic (rango), Ctrl/Cmd+clic,
     Espacio/Intro, flechas para moverse, Ctrl+A.
   - Reordenación opcional por arrastre (ratón/táctil) o con
     Alt+flechas desde el teclado.
   - Acciones por miniatura (girar, duplicar, eliminar…).
   ============================================================ */
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { createLazyRenderer } from './render.js';
import { makeSortable } from './sortable.js';

let uid = 0;

/**
 * @typedef {Object} GridItem
 * @property {string} [key]
 * @property {string} label                     Texto bajo la miniatura
 * @property {(canvas: HTMLCanvasElement) => Promise<void>} render
 * @property {number} [rotation]                Giro visual extra (0/90/180/270)
 * @property {string} [badge]                   Etiqueta pequeña (p. ej. nombre del archivo origen)
 */

export class PageGrid {
  /**
   * @param {HTMLElement} container
   * @param {{selectable?: boolean, sortable?: boolean, initiallySelected?: boolean,
   *          actions?: {id: string, icon: string, label: string}[],
   *          onAction?: (id: string, item: GridItem, index: number) => void,
   *          onChange?: () => void, ariaLabel?: string}} opts
   */
  constructor(container, opts = {}) {
    this.el = container;
    this.opts = { selectable: true, sortable: false, actions: [], initiallySelected: false, ...opts };
    this.el.classList.add('page-grid');
    this.el.setAttribute('role', this.opts.selectable ? 'listbox' : 'list');
    if (this.opts.selectable) this.el.setAttribute('aria-multiselectable', 'true');
    if (this.opts.ariaLabel) this.el.setAttribute('aria-label', this.opts.ariaLabel);
    this.anchor = null;
    this.lazy = createLazyRenderer((tile) => this.#renderTile(tile));
    this.el.addEventListener('click', (e) => this.#onClick(e));
    this.el.addEventListener('keydown', (e) => this.#onKey(e));
    if (this.opts.sortable) {
      this.unsort = makeSortable(this.el, {
        itemSelector: '.page-thumb',
        onEnd: () => this.#changed(),
      });
    }
  }

  /** Sustituye todos los elementos. */
  setItems(items) {
    this.lazy.disconnect();
    this.lazy = createLazyRenderer((tile) => this.#renderTile(tile));
    clear(this.el);
    this.anchor = null;
    items.forEach((it) => this.el.append(this.#tile(it, this.opts.initiallySelected)));
    this.#updateTabStops();
    this.#changed();
  }

  /** Inserta elementos en una posición (por defecto al final). */
  insertItems(items, index = this.tiles().length, { select = false } = {}) {
    const ref = this.tiles()[index] || null;
    const nodes = items.map((it) => this.#tile(it, select));
    nodes.forEach((n) => this.el.insertBefore(n, ref));
    this.#updateTabStops();
    this.#changed();
    return nodes;
  }

  tiles() { return Array.from(this.el.querySelectorAll(':scope > .page-thumb')); }
  /** Elementos en el orden actual de pantalla. */
  items() { return this.tiles().map((t) => t._item); }
  selectedIndices() { return this.tiles().flatMap((t, i) => (t.classList.contains('selected') ? [i] : [])); }
  selectedItems() { return this.tiles().filter((t) => t.classList.contains('selected')).map((t) => t._item); }

  selectAll(value = true) { this.tiles().forEach((t) => this.#setSelected(t, value)); this.#changed(); }
  invertSelection() { this.tiles().forEach((t) => this.#setSelected(t, !t.classList.contains('selected'))); this.#changed(); }
  /** Selecciona por índices 0-based (deselecciona el resto). */
  selectIndices(indices) {
    const set = new Set(indices);
    this.tiles().forEach((t, i) => this.#setSelected(t, set.has(i)));
    this.#changed();
  }

  /** Vuelve a pintar etiqueta/rotación de un elemento (tras modificarlo). */
  refresh(item) {
    const tile = this.tiles().find((t) => t._item === item);
    if (!tile) return;
    tile.querySelector('.page-thumb__label').textContent = item.label;
    this.#applyRotation(tile);
  }

  /** Vuelve a renderizar la miniatura de un elemento. */
  rerender(item) {
    const tile = this.tiles().find((t) => t._item === item);
    if (tile) { tile._rendered = false; this.lazy.observe(tile); }
  }

  remove(item) {
    const tile = this.tiles().find((t) => t._item === item);
    if (!tile) return;
    const next = tile.nextElementSibling || tile.previousElementSibling;
    this.lazy.unobserve(tile);
    tile.remove();
    next?.focus?.();
    this.#updateTabStops();
    this.#changed();
  }

  destroy() {
    this.lazy.disconnect();
    this.unsort?.();
    clear(this.el);
  }

  // ---- privados ------------------------------------------------
  #tile(item, selected) {
    const id = `pg-${++uid}`;
    const canvas = h('canvas', { 'aria-hidden': 'true' });
    const wrap = h('div', { class: 'page-thumb__canvas-wrap' },
      h('div', { class: 'page-thumb__placeholder', 'aria-hidden': 'true' }, h('span', { class: 'spinner' })),
      canvas,
      h('span', { class: 'rotation-badge', 'aria-hidden': 'true' }),
    );
    if (item.badge) wrap.append(h('span', { class: 'page-thumb__badge', title: item.badge }, item.badge));
    if (this.opts.actions.length) {
      wrap.append(h('div', { class: 'page-thumb__actions' },
        this.opts.actions.map((a) => h('button', {
          type: 'button', class: 'thumb-action', 'data-action': a.id, title: a.label, 'aria-label': `${a.label} (${item.label})`,
          tabindex: '-1',
        }, icon(a.icon)))));
    }
    const tile = h('div', {
      class: 'page-thumb', id, tabindex: '-1',
      role: this.opts.selectable ? 'option' : 'listitem',
      'aria-label': item.label,
    }, wrap, h('span', { class: 'page-thumb__label' }, item.label));
    tile._item = item;
    tile._canvas = canvas;
    if (this.opts.selectable) this.#setSelected(tile, selected);
    this.#applyRotation(tile);
    this.lazy.observe(tile);
    return tile;
  }

  async #renderTile(tile) {
    if (tile._rendered || !tile.isConnected) return;
    tile._rendered = true;
    await tile._item.render(tile._canvas);
    tile.classList.add('is-rendered');
  }

  #applyRotation(tile) {
    const rot = ((tile._item.rotation || 0) % 360 + 360) % 360;
    tile._canvas.style.transform = rot ? `rotate(${rot}deg)` : '';
    const badge = tile.querySelector('.rotation-badge');
    badge.textContent = rot ? `${rot}°` : '';
    tile.classList.toggle('rotated', rot !== 0);
  }

  #setSelected(tile, value) {
    if (!this.opts.selectable) return;
    tile.classList.toggle('selected', value);
    tile.setAttribute('aria-selected', value ? 'true' : 'false');
  }

  #onClick(e) {
    const tile = e.target.closest('.page-thumb');
    if (!tile || !this.el.contains(tile)) return;
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      e.stopPropagation();
      const idx = this.tiles().indexOf(tile);
      this.opts.onAction?.(actionBtn.dataset.action, tile._item, idx);
      return;
    }
    tile.focus({ preventScroll: true });
    this.#updateTabStops(tile);
    if (!this.opts.selectable) return;
    const tiles = this.tiles();
    if (e.shiftKey && this.anchor && tiles.includes(this.anchor)) {
      const a = tiles.indexOf(this.anchor), b = tiles.indexOf(tile);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const value = this.anchor.classList.contains('selected');
      for (let i = lo; i <= hi; i++) this.#setSelected(tiles[i], value);
    } else {
      this.#setSelected(tile, !tile.classList.contains('selected'));
      this.anchor = tile;
    }
    this.#changed();
  }

  #onKey(e) {
    const tile = e.target.closest('.page-thumb');
    if (!tile) return;
    const tiles = this.tiles();
    const idx = tiles.indexOf(tile);
    const cols = Math.max(1, Math.round(this.el.clientWidth / (tile.offsetWidth || 1)));
    const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };

    if (e.key in deltas) {
      e.preventDefault();
      const target = Math.min(tiles.length - 1, Math.max(0, idx + deltas[e.key]));
      if (this.opts.sortable && (e.altKey || (e.ctrlKey && e.shiftKey))) {
        // Mover la página
        if (target === idx) return;
        const ref = target > idx ? tiles[target].nextElementSibling : tiles[target];
        this.el.insertBefore(tile, ref);
        tile.focus();
        this.#changed();
        return;
      }
      tiles[target].focus();
      this.#updateTabStops(tiles[target]);
      if (e.shiftKey && this.opts.selectable) { this.#setSelected(tiles[target], true); this.#changed(); }
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && this.opts.selectable && e.target === tile) {
      e.preventDefault();
      this.#setSelected(tile, !tile.classList.contains('selected'));
      this.anchor = tile;
      this.#changed();
      return;
    }
    if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && this.opts.selectable) {
      e.preventDefault();
      this.selectAll(true);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.opts.actions.some((a) => a.id === 'delete')) {
      e.preventDefault();
      this.opts.onAction?.('delete', tile._item, idx);
    }
  }

  /** Solo una miniatura es tabulable (patrón "roving tabindex"). */
  #updateTabStops(active) {
    const tiles = this.tiles();
    const current = active || tiles.find((t) => t.tabIndex === 0) || tiles[0];
    tiles.forEach((t) => {
      t.tabIndex = t === current ? 0 : -1;
      t.querySelectorAll('.thumb-action').forEach((b) => { b.tabIndex = t === current ? 0 : -1; });
    });
  }

  #changed() { this.opts.onChange?.(); }
}
