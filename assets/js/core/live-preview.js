/* ============================================================
   LIVE PREVIEW — Vista previa REAL (WYSIWYG): aplica la misma
   función que se usará al guardar sobre una copia de una sola
   página y la renderiza con PDF.js. Así lo que se ve es
   exactamente lo que se obtiene (fuente, tamaño, rotación…).
   ============================================================ */
import { PDFLib } from './libs.js';
import { loadPlain } from './pdf-engine.js';
import { openRender } from './render.js';

export class LivePreview {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Uint8Array} sourceBytes  PDF (descifrado)
   * @param {(doc: PDFLib.PDFDocument, page: PDFLib.PDFPage, pageIndex: number, total: number) => Promise<void>} apply
   */
  constructor(canvas, sourceBytes, apply, { width = 560 } = {}) {
    this.canvas = canvas;
    this.source = sourceBytes;
    this.apply = apply;
    this.width = width;
    this.cache = new Map(); // pageIndex → bytes de un PDF de 1 página
    this.token = 0;
    this.srcDoc = null;
  }

  async #singlePage(index) {
    if (this.cache.has(index)) return this.cache.get(index);
    this.srcDoc ??= await loadPlain(this.source);
    const one = await PDFLib.PDFDocument.create({ updateMetadata: false });
    const [p] = await one.copyPages(this.srcDoc, [index]);
    one.addPage(p);
    const bytes = await one.save({ useObjectStreams: false });
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(index, bytes);
    return bytes;
  }

  /** Renderiza la página `index` (0-based) con los ajustes actuales. */
  async render(index, total) {
    const my = ++this.token;
    const base = await this.#singlePage(index);
    if (my !== this.token) return;
    const doc = await loadPlain(base);
    await this.apply(doc, doc.getPage(0), index, total);
    const bytes = await doc.save({ useObjectStreams: false });
    if (my !== this.token) return;
    const r = await openRender(bytes);
    try {
      if (my !== this.token) return;
      const off = await r.renderPage(1, { width: this.width * Math.min(2, window.devicePixelRatio || 1) });
      if (my !== this.token) return;
      this.canvas.width = off.width;
      this.canvas.height = off.height;
      this.canvas.getContext('2d').drawImage(off, 0, 0);
    } finally {
      r.destroy();
    }
  }
}
