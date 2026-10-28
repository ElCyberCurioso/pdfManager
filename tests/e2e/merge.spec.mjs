import { test, expect } from '@playwright/test';
import { openTool, upload, downloadResult, answerPassword, loadPdf, PDFLib } from './helpers.mjs';

test('une tres PDFs (uno cifrado) con rango, marcadores y orden cambiado', async ({ page }) => {
  const errors = await openTool(page, 'merge');
  await upload(page, ['sample-3.pdf', 'sample-10.pdf']);
  await expect(page.getByTestId('file-item')).toHaveCount(2);
  await upload(page, 'encrypted-aes256.pdf');
  await answerPassword(page, 'abrir');
  await expect(page.getByTestId('file-item')).toHaveCount(3);

  // Rango en el segundo archivo: 1-2 y 10
  const range = page.getByTestId('range').nth(1);
  await range.fill('1-2, 10');
  await range.press('Tab');
  await expect(page.locator('#listInfo')).toContainText('8 páginas');

  // Mover el último archivo al principio con los botones
  await page.getByRole('button', { name: 'Subir encrypted-aes256.pdf' }).click();
  await page.getByRole('button', { name: 'Subir encrypted-aes256.pdf' }).click();
  await expect(page.getByTestId('file-item').first()).toContainText('encrypted-aes256.pdf');

  await page.getByTestId('run').click();
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('unido.pdf');
  const doc = await loadPdf(bytes);
  expect(doc.getPageCount()).toBe(2 + 3 + 3);
  expect(doc.isEncrypted).toBe(false);
  const outlines = doc.catalog.lookup(PDFLib.PDFName.of('Outlines'));
  expect(outlines.lookup(PDFLib.PDFName.of('Count')).asNumber()).toBe(3);
  expect(errors).toEqual([]);
});

test('reordena arrastrando con el ratón', async ({ page }) => {
  await openTool(page, 'merge');
  await upload(page, ['sample-3.pdf', 'sample-10.pdf', 'outline.pdf']);
  await expect(page.getByTestId('file-item')).toHaveCount(3);
  const handles = page.locator('.drag-handle');
  await page.locator('#fileList').scrollIntoViewIfNeeded();
  const from = await handles.nth(2).boundingBox();
  const to = await handles.nth(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 5, from.y - 10, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('file-item').first()).toContainText('outline.pdf');
});

test('regresión XSS: el nombre del archivo se muestra como texto', async ({ page }) => {
  const errors = await openTool(page, 'merge');
  const { readFileSync } = await import('node:fs');
  const { fixture } = await import('./helpers.mjs');
  const evil = '<img src=x onerror="window.__xss=1">.pdf';
  await page.setInputFiles('#dropZone input[type=file]', [
    { name: evil, mimeType: 'application/pdf', buffer: readFileSync(fixture('sample-3.pdf')) },
  ]);
  await expect(page.getByTestId('file-item')).toHaveCount(1);
  await expect(page.locator('.file-item__name')).toHaveText(evil);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('#fileList img').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('rechaza archivos que no son PDF aunque tengan extensión .pdf', async ({ page }) => {
  await openTool(page, 'merge');
  await page.setInputFiles('#dropZone input[type=file]', [{ name: 'falso.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ\x90\x00 esto no es un pdf') }]);
  await expect(page.locator('.toast-error')).toContainText('no es un PDF');
  await expect(page.getByTestId('file-item')).toHaveCount(0);
});
