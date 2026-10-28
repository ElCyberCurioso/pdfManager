/* ============================================================
   LIBS — Punto único de carga de librerías de terceros.
   Todas se sirven desde assets/vendor (versión fijada, ver
   assets/vendor/versions.json). Nada se carga de CDNs.
   ============================================================ */
import * as PDFLib from '../../vendor/pdf-lib/pdf-lib.esm.min.js';
import * as pdfjsLib from '../../vendor/pdfjs/pdf.min.js';

const VENDOR = new URL('../../vendor/', import.meta.url);

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.min.js', VENDOR).href;

/** Opciones comunes para pdfjsLib.getDocument(). */
export const PDFJS_OPTIONS = Object.freeze({
  cMapUrl: new URL('pdfjs/cmaps/', VENDOR).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('pdfjs/standard_fonts/', VENDOR).href,
  wasmUrl: new URL('pdfjs/wasm/', VENDOR).href,
  iccUrl: new URL('pdfjs/iccs/', VENDOR).href,
  // Defensa en profundidad: no renderizar formularios XFA ni evaluar código.
  enableXfa: false,
  isEvalSupported: false,
});

export { PDFLib, pdfjsLib };
