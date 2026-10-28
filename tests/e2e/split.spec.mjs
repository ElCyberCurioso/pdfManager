import { test, expect } from '@playwright/test';
import { openTool, upload, downloadResult, loadPdf, readZip, pageTexts } from './helpers.mjs';

test('divide por rangos en un ZIP', async ({ page }) => {
  const errors = await openTool(page, 'split');
  await upload(page, 'sample-10.pdf');
  await page.locator('#rangesInput').fill('1-3, 4, 8-');
  await expect(page.locator('#planPreview')).toContainText('3 archivos');
  await page.getByTestId('run').click();
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('sample-10_dividido.zip');
  const entries = readZip(bytes);
  expect(entries.map((e) => e.name)).toEqual(['sample-10_p1-3.pdf', 'sample-10_p4.pdf', 'sample-10_p8-10.pdf']);
  const counts = await Promise.all(entries.map(async (e) => (await loadPdf(e.data)).getPageCount()));
  expect(counts).toEqual([3, 1, 3]);
  expect(errors).toEqual([]);
});

test('extrae páginas elegidas en las miniaturas', async ({ page }) => {
  await openTool(page, 'split');
  await upload(page, 'sample-10.pdf');
  await page.locator('input[name=mode][value=pick]').check();
  const thumbs = page.locator('#pageGrid .page-thumb');
  await expect(thumbs).toHaveCount(10);
  await thumbs.nth(1).click();
  await thumbs.nth(4).click({ modifiers: ['Shift'] });
  await expect(page.locator('#pickInput')).toHaveValue('2-5');
  await page.locator('#pickInput').fill('2-5, 9');
  await page.locator('#pickInput').press('Tab');
  await expect(page.locator('#pageGrid .page-thumb.selected')).toHaveCount(5);
  await page.getByTestId('run').click();
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('sample-10_extracto.pdf');
  const texts = await pageTexts(bytes);
  expect(texts.length).toBe(5);
});

test('divide por marcadores', async ({ page }) => {
  await openTool(page, 'split');
  await upload(page, 'outline.pdf');
  await page.locator('input[name=mode][value=bookmarks]').check();
  await expect(page.locator('#bookmarkList li')).toHaveCount(3);
  await page.getByTestId('run').click();
  const { bytes } = await downloadResult(page);
  const entries = readZip(bytes);
  expect(entries.map((e) => e.name)).toEqual(['01 Capítulo 1.pdf', '02 Capítulo 2.pdf', '03 Anexo.pdf']);
  const counts = await Promise.all(entries.map(async (e) => (await loadPdf(e.data)).getPageCount()));
  expect(counts).toEqual([2, 3, 1]);
});
