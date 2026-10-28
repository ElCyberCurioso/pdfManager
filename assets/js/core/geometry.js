/* ============================================================
   GEOMETRY — Coordenadas "visuales" de una página.
   Las herramientas que dibujan (marca de agua, numeración,
   firma) trabajan en el espacio que ve el usuario: origen abajo
   a la izquierda de la página TAL COMO SE MUESTRA, teniendo en
   cuenta /Rotate y el CropBox. Este módulo traduce esas
   coordenadas al espacio de usuario del PDF.
   ============================================================ */
import { PDFLib } from './libs.js';

/**
 * @param {PDFLib.PDFPage} page
 * @returns {{vw:number, vh:number, rot:number, toUser:(u:number,v:number)=>{x:number,y:number}}}
 *   vw/vh: ancho y alto visibles; rot: rotación de la página (0/90/180/270);
 *   toUser: convierte un punto visual (u→derecha, v→arriba) a coordenadas PDF.
 */
export function pageFrame(page) {
  const box = page.getCropBox(); // por defecto = MediaBox
  const { x, y, width: W, height: H } = box;
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const vw = swap ? H : W;
  const vh = swap ? W : H;

  let toUser;
  switch (rot) {
    case 90:  toUser = (u, v) => ({ x: x + W - v, y: y + u }); break;
    case 180: toUser = (u, v) => ({ x: x + W - u, y: y + H - v }); break;
    case 270: toUser = (u, v) => ({ x: x + v,     y: y + H - u }); break;
    default:  toUser = (u, v) => ({ x: x + u,     y: y + v });
  }
  return { vw, vh, rot, toUser };
}

/**
 * Dibuja texto en coordenadas visuales.
 * @param {PDFLib.PDFPage} page
 * @param {string} text
 * @param {{u:number, v:number, angle?:number, size:number, font:any, color:any, opacity?:number}} o
 *   (u,v): inicio de la línea base en espacio visual; angle: grados antihorario, visual.
 */
export function drawTextVisual(page, text, { u, v, angle = 0, size, font, color, opacity = 1 }) {
  const f = pageFrame(page);
  const { x, y } = f.toUser(u, v);
  page.drawText(text, { x, y, size, font, color, opacity, rotate: PDFLib.degrees(angle + f.rot) });
}

/**
 * Dibuja una imagen con su esquina inferior izquierda (visual) en (u,v).
 */
export function drawImageVisual(page, image, { u, v, width, height, angle = 0, opacity = 1 }) {
  const f = pageFrame(page);
  const { x, y } = f.toUser(u, v);
  page.drawImage(image, { x, y, width, height, opacity, rotate: PDFLib.degrees(angle + f.rot) });
}

/**
 * Punto de anclaje (inicio de línea base) para que un bloque de ancho w y
 * alto h, rotado `angleDeg` alrededor de su centro, quede centrado en (cx, cy).
 */
export function anchorForCenter(cx, cy, w, h, angleDeg) {
  const t = (angleDeg * Math.PI) / 180;
  return {
    u: cx - (w / 2) * Math.cos(t) + (h / 2) * Math.sin(t),
    v: cy - (w / 2) * Math.sin(t) - (h / 2) * Math.cos(t),
  };
}

/** Posiciones predefinidas (3×3) en espacio visual, con margen. */
export const POSITIONS = {
  'top-left':      { ax: 0,   ay: 1 },
  'top-center':    { ax: 0.5, ay: 1 },
  'top-right':     { ax: 1,   ay: 1 },
  'middle-left':   { ax: 0,   ay: 0.5 },
  center:          { ax: 0.5, ay: 0.5 },
  'middle-right':  { ax: 1,   ay: 0.5 },
  'bottom-left':   { ax: 0,   ay: 0 },
  'bottom-center': { ax: 0.5, ay: 0 },
  'bottom-right':  { ax: 1,   ay: 0 },
};

/**
 * Centro (visual) de un bloque w×h colocado en una posición predefinida.
 */
export function placeBlock(frame, position, w, h, margin) {
  const p = POSITIONS[position] || POSITIONS.center;
  const cx = margin + w / 2 + p.ax * (frame.vw - 2 * margin - w);
  const cy = margin + h / 2 + p.ay * (frame.vh - 2 * margin - h);
  return { cx, cy };
}

/** "#rrggbb" → PDFLib.rgb */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
