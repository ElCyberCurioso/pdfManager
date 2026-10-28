/* ============================================================
   SORTABLE — Reordenación por arrastre con Pointer Events.
   Funciona con ratón, lápiz y táctil (pulsación larga), hace
   auto-scroll cerca de los bordes y no depende del DnD de HTML5
   (que no funciona en móviles).
   ============================================================ */

const DRAG_THRESHOLD = 6;     // px antes de considerar que es un arrastre
const LONG_PRESS_MS  = 280;   // táctil: pulsación larga para empezar
const EDGE = 70;              // px de borde que activan el auto-scroll

/**
 * @param {HTMLElement} container
 * @param {{itemSelector: string, handleSelector?: string,
 *          onEnd: (from:number, to:number) => void,
 *          ignoreSelector?: string}} opts
 * @returns {() => void} función para desmontar
 */
export function makeSortable(container, { itemSelector, handleSelector, onEnd, ignoreSelector = 'button, input, select, textarea, a' }) {
  let state = null;

  const items = () => Array.from(container.querySelectorAll(itemSelector));

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const item = e.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    const onHandle = handleSelector ? e.target.closest(handleSelector) : null;
    if (handleSelector && !onHandle && e.pointerType === 'mouse') {
      // Con ratón se puede arrastrar desde cualquier parte salvo controles.
      if (e.target.closest(ignoreSelector)) return;
    } else if (!onHandle && e.target.closest(ignoreSelector)) {
      return;
    }

    state = {
      item, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY, active: false, from: items().indexOf(item),
      touch: e.pointerType !== 'mouse' && !onHandle, timer: null, ghost: null, raf: 0,
    };
    if (state.touch) {
      state.timer = setTimeout(() => { if (state) begin(); }, LONG_PRESS_MS);
    }
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
  }

  function onTouchMove(e) {
    if (state?.active) e.preventDefault(); // evita el scroll mientras se arrastra
  }

  function begin() {
    const { item } = state;
    state.active = true;
    const rect = item.getBoundingClientRect();
    state.offX = state.x - rect.left;
    state.offY = state.y - rect.top;
    const ghost = item.cloneNode(true);
    ghost.classList.add('sortable-ghost');
    ghost.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px` });
    // Los canvas clonados salen en blanco: copiamos su contenido.
    const srcCanvases = item.querySelectorAll('canvas');
    ghost.querySelectorAll('canvas').forEach((c, i) => {
      const src = srcCanvases[i];
      if (!src || !src.width) return;
      c.width = src.width; c.height = src.height;
      c.getContext('2d').drawImage(src, 0, 0);
    });
    document.body.append(ghost);
    state.ghost = ghost;
    item.classList.add('sortable-placeholder');
    document.body.classList.add('is-sorting');
    moveGhost();
    autoScroll();
    if (state.touch && navigator.vibrate) { try { navigator.vibrate(10); } catch { /* sin soporte */ } }
  }

  function moveGhost() {
    if (!state?.ghost) return;
    state.ghost.style.transform = `translate(${state.x - state.offX}px, ${state.y - state.offY}px)`;
  }

  function onPointerMove(e) {
    if (!state || e.pointerId !== state.pointerId) return;
    state.x = e.clientX;
    state.y = e.clientY;
    const dist = Math.hypot(state.x - state.startX, state.y - state.startY);
    if (!state.active) {
      if (state.touch) {
        if (dist > DRAG_THRESHOLD) cleanup(); // era un scroll, no un arrastre
        return;
      }
      if (dist < DRAG_THRESHOLD) return;
      begin();
    }
    e.preventDefault();
    moveGhost();
    reorderAt(state.x, state.y);
  }

  function reorderAt(x, y) {
    const { item } = state;
    const list = items();
    let target = null;
    let best = Infinity;
    for (const el of list) {
      if (el === item) continue;
      const r = el.getBoundingClientRect();
      // Distancia del puntero al rectángulo (0 si está dentro).
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; target = el; }
    }
    if (!target || best > 80 * 80) return;
    const r = target.getBoundingClientRect();
    const isGrid = r.width < container.clientWidth * 0.9;      // rejilla vs lista vertical
    const inRow = y >= r.top && y <= r.bottom;
    const after = isGrid && inRow ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
    if (after) {
      if (target.nextElementSibling !== item) container.insertBefore(item, target.nextElementSibling);
    } else if (target.previousElementSibling !== item) {
      container.insertBefore(item, target);
    }
  }

  function autoScroll() {
    if (!state?.active) return;
    const { y } = state;
    let dy = 0;
    if (y < EDGE) dy = -Math.ceil((EDGE - y) / 4);
    else if (y > window.innerHeight - EDGE) dy = Math.ceil((y - (window.innerHeight - EDGE)) / 4);
    if (dy) {
      window.scrollBy(0, dy);
      reorderAt(state.x, state.y);
    }
    state.raf = requestAnimationFrame(autoScroll);
  }

  function onPointerUp(e) {
    if (!state || e.pointerId !== state.pointerId) return;
    const { active, item, from } = state;
    cleanup();
    if (!active) return;
    // Evita que el "click" posterior al arrastre seleccione la miniatura.
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
    const to = items().indexOf(item);
    if (to !== from && to !== -1) onEnd(from, to);
  }

  function onCancel() {
    if (!state) return;
    const { active, item, from } = state;
    cleanup();
    if (active) {
      // Restaurar posición original
      const list = items().filter((el) => el !== item);
      container.insertBefore(item, list[from] || null);
    }
  }

  function cleanup() {
    if (!state) return;
    clearTimeout(state.timer);
    cancelAnimationFrame(state.raf);
    state.ghost?.remove();
    state.item.classList.remove('sortable-placeholder');
    document.body.classList.remove('is-sorting');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('touchmove', onTouchMove);
    state = null;
  }

  container.addEventListener('pointerdown', onPointerDown);
  return () => { cleanup(); container.removeEventListener('pointerdown', onPointerDown); };
}

/** Mueve un elemento de un array (inmutable). */
export function moveItem(arr, from, to) {
  const copy = arr.slice();
  const [it] = copy.splice(from, 1);
  copy.splice(to, 0, it);
  return copy;
}
