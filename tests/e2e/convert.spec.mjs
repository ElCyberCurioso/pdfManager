import { test, expect } from '@playwright/test';
import { openTool, upload, downloadResult, loadPdf, readZip, PDFLib } from './helpers.mjs';

test('PDF a imagen: PNG de una página y ZIP de JPG', async ({ page }) => {
  const errors = await openTool(page, 'pdf-to-image');
  await upload(page, 'sample-3.pdf');
  await expect(page.locator('#pageGrid .page-thumb.selected')).toHaveCount(3);
  await page.locator('#pagesInput').fill('3');
  await page.locator('#pagesInput').press('Tab');
  await expect(page.locator('#estimate')).toContainText('1 imagen');
  await expect(page.locator('#estimate')).toContainText('1754 × 1240'); // pág. 3 girada, 150 ppp
  await page.getByTestId('run').click();
  let r = await downloadResult(page);
  expect(r.name).toBe('sample-3_p3.png');
  expect([...r.bytes.slice(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
  // IHDR: ancho y alto (big-endian) — página apaisada por /Rotate 90
  const dv = new DataView(r.bytes.buffer, r.bytes.byteOffset);
  expect(dv.getUint32(16)).toBeGreaterThan(dv.getUint32(20));

  await page.locator('#selAll').click();
  await page.locator('input[name=format][value=jpg]').check();
  await page.locator('input[name=dpiPreset][value="72"]').check();
  await page.getByTestId('run').click();
  r = await downloadResult(page);
  expect(r.name).toBe('sample-3_imagenes.zip');
  const entries = readZip(r.bytes);
  expect(entries.map((e) => e.name)).toEqual(['sample-3_p1.jpg', 'sample-3_p2.jpg', 'sample-3_p3.jpg']);
  expect(entries[0].data[0]).toBe(0xff);
  expect(errors).toEqual([]);
});

test('imágenes a PDF: orientación EXIF, giro manual y JPG sin recomprimir', async ({ page }) => {
  const errors = await openTool(page, 'image-to-pdf');
  await upload(page, ['photo.jpg', 'photo-rotated.jpg', 'logo.png', 'image.webp']);
  await expect(page.getByTestId('file-item')).toHaveCount(4);
  // Girar la PNG a la derecha
  await page.getByRole('button', { name: 'Girar logo.png a la derecha' }).click();
  await page.getByTestId('run').click();
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('imagenes.pdf');
  const doc = await loadPdf(bytes);
  expect(doc.getPageCount()).toBe(4);
  const sizes = doc.getPages().map((p) => p.getSize());
  expect(sizes[0].width).toBeGreaterThan(sizes[0].height);   // foto 800×600 → A4 apaisado
  expect(sizes[1].width).toBeLessThan(sizes[1].height);      // EXIF 6 → vertical
  // El JPG original se incrusta tal cual (mismo tamaño en bytes)
  const fs = await import('node:fs');
  const jpg = fs.readFileSync('tests/fixtures/out/photo.jpg');
  const streams = [...doc.context.enumerateIndirectObjects()].map(([, o]) => o).filter((o) => o instanceof PDFLib.PDFRawStream && String(o.dict.get(PDFLib.PDFName.of('Filter'))) === '/DCTDecode');
  expect(streams.some((s) => s.contents.length === jpg.length)).toBe(true);
  expect(errors).toEqual([]);
});
