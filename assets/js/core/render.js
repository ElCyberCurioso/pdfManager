/* ============================================================
   RENDER — Renderizado con PDF.js (miniaturas y vistas previas).
   Cada documento se parsea UNA vez y se reutiliza; las
   miniaturas se generan bajo demanda (IntersectionObserver)
   con concurrencia limitada para no bloquear con PDFs grandes.
   ============================================================ */
import { pdfjsLib, PDFJS_OPTIONS } from './libs.js';

/**
 * Abre un documento para renderizar.
 * @param {Uint8Array} bytes  Bytes del PDF (descifrado). Se copian: PDF.js
 *                            transfiere el buffer al worker y lo invalida.
 */
export async function openRender(bytes) {
  const task = pdfjsLib.getDocument({ ...PDFJS_OPTIONS, data: bytes.slice() });
  const pdf = await task.promise;
  return new RenderDoc(pdf, task);
}

export class RenderDoc {
  constructor(pdf, task) {
    this.pdf = pdf;
    this.task = task;
    this.numPages = pdf.numPages;
    this.destroyed = false;
  }

  page(n) { return this.pdf.getPage(n); }

  /**
   * Renderiza la página n (1-based) en un canvas.
   * @param {number} n
   * @param {{width?: number, scale?: number, dpi?: number, canvas?: HTMLCanvasElement,
   *          rotation?: number, background?: string, intent?: string}} opts
   * @returns {Promise<HTMLCanvasElement>}
   */
  async renderPage(n, { width, scale, dpi, canvas, rotation = 0, background = '#ffffff', intent = 'display' } = {}) {
    const page = await this.page(n);
    const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
    let s = scale ?? 1;
    if (width) s = width / base.width;
    if (dpi)   s = dpi / 72;
    // Límite de seguridad: los navegadores fallan con canvas > ~16k px o > 268M px².
    const maxSide = 12000, maxArea = 120e6;
    s = Math.min(s, maxSide / base.width, maxSide / base.height, Math.sqrt(maxArea / (base.width * base.height)));
    const viewport = page.getViewport({ scale: s, rotation: (page.rotate + rotation) % 360 });

    const c = canvas || document.createElement('canvas');
    c.width  = Math.max(1, Math.floor(viewport.width));
    c.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvas: c, viewport, intent, background }).promise;
    page.cleanup();
    return c;
  }

  /** Tamaño visual (pt) de la página, con su rotación aplicada. */
  async pageSize(n) {
    const page = await this.page(n);
    const vp = page.getViewport({ scale: 1 });
    return { width: vp.width, height: vp.height, rotate: page.rotate };
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try { await this.task.destroy(); } catch { /* ignore */ }
  }
}

// ---- Cola de renderizado con concurrencia limitada --------------
const queue = [];
let running = 0;
const MAX_CONCURRENT = 2;

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    if (job.cancelled) continue;
    running++;
    job.fn().then(job.resolve, job.reject).finally(() => { running--; pump(); });
  }
}

/** Encola un trabajo de renderizado. Devuelve {promise, cancel}. */
export function enqueue(fn) {
  const job = { fn, cancelled: false };
  job.promise = new Promise((res, rej) => { job.resolve = res; job.reject = rej; });
  queue.push(job);
  pump();
  return { promise: job.promise, cancel: () => { job.cancelled = true; } };
}

/**
 * Observa elementos y llama a `render(el)` la primera vez que entran
 * en (o se acercan a) la zona visible.
 */
export function createLazyRenderer(render, { root = null, rootMargin = '400px' } = {}) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.unobserve(entry.target);
      enqueue(() => render(entry.target)).promise.catch((err) => {
        if (!/destroyed|Worker was terminated|cancel/i.test(err?.message || '')) console.warn('Render:', err);
      });
    }
  }, { root, rootMargin });
  return {
    observe: (el) => io.observe(el),
    unobserve: (el) => io.unobserve(el),
    disconnect: () => io.disconnect(),
  };
}

/** Convierte un canvas en Blob (por defecto PNG). */
export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo codificar la imagen.'))), type, quality);
  });
}
