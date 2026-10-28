// Utilidades comunes de los tests E2E.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import * as PDFLib from '../../assets/vendor/pdf-lib/pdf-lib.esm.min.js';

export { PDFLib };
export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'out');
export const fixture = (name) => join(FIXTURES, name);

/** Abre una herramienta y registra los errores de la consola/página. */
export async function openTool(page, id) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(`tools/${id}.html`);
  await expect(page.locator('[data-shell="header"] .site-logo')).toBeVisible();
  return errors;
}

/** Sube archivos a la zona principal. */
export async function upload(page, names, selector = '#dropZone input[type=file]') {
  const list = (Array.isArray(names) ? names : [names]).map((n) => (n.includes('/') ? n : fixture(n)));
  await page.setInputFiles(selector, list);
}

/** Pulsa el botón de descarga del resultado y devuelve {name, bytes}. */
export async function downloadResult(page, locator = page.getByTestId('download')) {
  const [dl] = await Promise.all([page.waitForEvent('download'), locator.click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(readFileSync(path)) };
}

/** Responde al diálogo de contraseña. */
export async function answerPassword(page, password) {
  const input = page.locator('dialog[open] #dlgInput');
  await expect(input).toBeVisible();
  await input.fill(password);
  await input.press('Enter');
}

export const loadPdf = (bytes, opts) => PDFLib.PDFDocument.load(bytes, { updateMetadata: false, ...opts });

/** Texto bruto de un PDF (descomprime los streams con pdf-lib) para buscar marcas. */
export async function pageTexts(bytes) {
  const doc = await loadPdf(bytes);
  const { PDFRawStream, decodePDFRawStream, PDFName, PDFArray } = PDFLib;
  return doc.getPages().map((p) => {
    const c = p.node.get(PDFName.of('Contents'));
    const refs = c instanceof PDFArray ? c.asArray() : [c];
    return refs.map((r) => {
      const s = doc.context.lookup(r);
      if (!(s instanceof PDFRawStream)) return '';
      try { return new TextDecoder('latin1').decode(decodePDFRawStream(s).decode()); } catch { return ''; }
    }).join('\n');
  });
}

/** Lee un ZIP sin compresión (el que genera la app). Devuelve [{name, data}]. */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const size = view.getUint32(off + 20, true);
    const local = view.getUint32(off + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
    const lNameLen = view.getUint16(local + 26, true);
    const lExtra = view.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtra;
    out.push({ name, data: bytes.slice(start, start + size) });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
