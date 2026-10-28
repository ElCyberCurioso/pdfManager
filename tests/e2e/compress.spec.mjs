import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openTool, upload, downloadResult, loadPdf, pageTexts, fixture } from './helpers.mjs';
import { readFileSync } from 'node:fs';

test('recomprime imágenes manteniendo texto y tamaño de página', async ({ page }) => {
  const errors = await openTool(page, 'compress');
  await upload(page, 'images.pdf');
  await expect(page.locator('input[name=mode][value=images]')).toBeChecked();
  await page.getByTestId('run').click();
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('images_comprimido.pdf');
  const original = readFileSync(fixture('images.pdf'));
  expect(bytes.length).toBeLessThan(original.length * 0.5);
  const doc = await loadPdf(bytes);
  expect(doc.getPageCount()).toBe(3);
  const { width, height } = doc.getPage(0).getSize();
  expect(Math.round(width)).toBe(595);
  expect(Math.round(height)).toBe(842);
  const texts = await pageTexts(bytes);
  expect(texts[0]).toContain('Tj'); // el texto sigue siendo vectorial
  await expect(page.locator('.result-area__title')).toContainText('más ligero');
  expect(errors).toEqual([]);
});

test('sin pérdida y rasterizado generan PDFs válidos', async ({ page }) => {
  await openTool(page, 'compress');
  await upload(page, 'sample-10.pdf');
  await expect(page.locator('input[name=mode][value=lossless]')).toBeChecked();
  await page.locator('#stripMeta').check();
  await page.getByTestId('run').click();
  let { bytes } = await downloadResult(page);
  let doc = await loadPdf(bytes);
  expect(doc.getPageCount()).toBe(10);
  expect(doc.getTitle()).toBeUndefined();

  await page.getByRole('button', { name: 'Empezar de nuevo' }).click();
  await upload(page, 'sample-3.pdf');
  await page.locator('input[name=mode][value=raster]').check();
  await page.getByTestId('run').click();
  ({ bytes } = await downloadResult(page));
  doc = await loadPdf(bytes);
  // La página 3 tenía /Rotate 90: el resultado debe ser apaisado
  const s = doc.getPage(2).getSize();
  expect(s.width).toBeGreaterThan(s.height);
  // qpdf valida la estructura
  const dir = mkdtempSync(join(tmpdir(), 'pdfm-'));
  writeFileSync(join(dir, 'r.pdf'), bytes);
  try { execFileSync('qpdf', ['--check', join(dir, 'r.pdf')]); } catch (err) { if (err.code !== 'ENOENT') throw err; }
});
