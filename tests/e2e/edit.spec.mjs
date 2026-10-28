import { test, expect } from '@playwright/test';
import { openTool, upload, downloadResult, loadPdf, pageTexts } from './helpers.mjs';

/** Decodifica las cadenas hexadecimales <...> Tj de un content stream (WinAnsi). */
const hexStrings = (s) => [...s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) => m[1].match(/../g).map((x) => String.fromCharCode(parseInt(x, 16))).join(''));

test('marca de agua de texto en páginas concretas', async ({ page }) => {
  const errors = await openTool(page, 'watermark');
  await upload(page, 'sample-3.pdf');
  await expect(page.locator('#previewCanvas')).toHaveAttribute('width', /\d+/);
  await page.locator('#wmText').fill('SECRETO');
  await page.locator('#wmPages').fill('2-3');
  await page.getByTestId('run').click();
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('sample-3_marca.pdf');
  const texts = await pageTexts(bytes);
  expect(hexStrings(texts[0])).not.toContain('SECRETO');
  expect(hexStrings(texts[1])).toContain('SECRETO');
  expect(hexStrings(texts[2])).toContain('SECRETO');
  expect(errors).toEqual([]);
});

test('marca de agua con imagen y carácter no soportado', async ({ page }) => {
  await openTool(page, 'watermark');
  await upload(page, 'sample-3.pdf');
  await page.locator('#wmText').fill('日本');
  await expect(page.locator('#previewError')).toContainText('no está disponible');
  await page.locator('input[name=wmType][value=image]').check();
  await page.setInputFiles('#wmImage', 'tests/fixtures/out/logo.png');
  await page.locator('#wmTile').check();
  await page.getByTestId('run').click();
  const { bytes } = await downloadResult(page);
  const texts = await pageTexts(bytes);
  expect((texts[0].match(/ Do/g) || []).length).toBeGreaterThan(3); // mosaico de imágenes
});

test('numerar páginas desde la 2 con plantilla', async ({ page }) => {
  const errors = await openTool(page, 'page-numbers');
  await upload(page, 'sample-10.pdf');
  await page.selectOption('#preset', 'Página {n} de {total}');
  await page.locator('#pages').fill('2-');
  await page.getByTestId('run').click();
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('sample-10_numerado.pdf');
  const texts = await pageTexts(bytes);
  expect(hexStrings(texts[0]).join(' ')).not.toContain('Página 1 de');
  expect(hexStrings(texts[1])).toContain('Página 1 de 9');
  expect(hexStrings(texts[9])).toContain('Página 9 de 9');
  expect(errors).toEqual([]);
});

test('extraer texto', async ({ page }) => {
  const errors = await openTool(page, 'extract-text');
  await upload(page, 'sample-3.pdf');
  await page.getByTestId('run').click();
  await expect(page.locator('#output')).toHaveValue(/===== Página 1 =====/);
  await expect(page.locator('#output')).toHaveValue(/Ñandú, acción, €/);
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('sample-3.txt');
  const txt = new TextDecoder().decode(bytes);
  expect(txt).toContain('Texto de ejemplo para extraer en la página 3.');
  expect(errors).toEqual([]);
});
