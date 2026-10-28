import { test, expect } from '@playwright/test';
import { openTool, upload, downloadResult, loadPdf, pageTexts } from './helpers.mjs';

async function drawSignature(page) {
  const pad = page.locator('#padCanvas');
  await pad.scrollIntoViewIfNeeded();
  const b = await pad.boundingBox();
  await page.mouse.move(b.x + 30, b.y + b.height * 0.6);
  await page.mouse.down();
  for (let i = 0; i <= 25; i++) await page.mouse.move(b.x + 30 + i * 9, b.y + b.height * 0.6 - Math.sin(i / 3) * 25);
  await page.mouse.up();
}

test('dibuja una firma, la mueve y la aplica en la última página', async ({ page }) => {
  const errors = await openTool(page, 'sign');
  await upload(page, 'sample-3.pdf');
  await expect(page.getByTestId('run')).toBeDisabled();
  await drawSignature(page);
  const box = page.locator('#signBox');
  await expect(box).toBeVisible();
  await expect(page.getByTestId('run')).toBeEnabled();
  // Mover con el teclado
  await box.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowUp');
  await page.locator('input[name=where][value=last]').check();
  await page.locator('#addDate').check();
  await page.getByTestId('run').click();
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('sample-3_firmado.pdf');
  const texts = await pageTexts(bytes);
  expect(texts[0]).not.toMatch(/ Do/);
  expect(texts[2]).toMatch(/ Do/);
  expect(texts[2]).toMatch(/Tj/); // fecha
  expect((await loadPdf(bytes)).getPageCount()).toBe(3);
  expect(errors).toEqual([]);
});

test('firma escrita en todas las páginas', async ({ page }) => {
  await openTool(page, 'sign');
  await upload(page, 'sample-3.pdf');
  await page.getByRole('tab', { name: 'Escribir' }).click();
  await page.locator('#typedName').fill('Ana Pérez');
  await expect(page.locator('#signBox')).toBeVisible();
  await page.locator('input[name=where][value=all]').check();
  await page.getByTestId('run').click();
  const { bytes } = await downloadResult(page);
  const texts = await pageTexts(bytes);
  expect(texts.every((t) => / Do/.test(t))).toBe(true);
});
