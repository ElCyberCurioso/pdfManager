import { test, expect } from '@playwright/test';
import { openTool, upload, downloadResult, loadPdf, pageTexts } from './helpers.mjs';

test('organizar: borrar, duplicar, girar, insertar en blanco, deshacer y otro PDF', async ({ page }) => {
  const errors = await openTool(page, 'reorder');
  await upload(page, 'sample-3.pdf');
  const thumbs = page.locator('#pageGrid .page-thumb');
  await expect(thumbs).toHaveCount(3);

  // Eliminar la página 2 con su botón
  await thumbs.nth(1).hover();
  await page.getByRole('button', { name: 'Eliminar (Pág. 2)' }).click();
  await expect(thumbs).toHaveCount(2);
  // Deshacer
  await page.locator('#undoBtn').click();
  await expect(thumbs).toHaveCount(3);
  // Rehacer
  await page.locator('#redoBtn').click();
  await expect(thumbs).toHaveCount(2);

  // Duplicar la primera y girarla
  await thumbs.nth(0).hover();
  await page.getByRole('button', { name: 'Duplicar (Pág. 1)' }).first().click();
  await expect(thumbs).toHaveCount(3);
  await thumbs.nth(1).hover();
  await thumbs.nth(1).getByRole('button', { name: /Girar a la derecha/ }).click();
  await expect(thumbs.nth(1)).toHaveClass(/rotated/);

  // Página en blanco al final e insertar otro PDF
  await page.locator('#blankBtn').click();
  await expect(thumbs).toHaveCount(4);
  await page.setInputFiles('#insertInput', 'tests/fixtures/out/outline.pdf');
  await expect(thumbs).toHaveCount(10);

  // Mover con teclado: última página al principio (Alt+Izquierda repetido no; usamos Home)
  await page.getByTestId('run').click();
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('sample-3_organizado.pdf');
  const doc = await loadPdf(bytes);
  expect(doc.getPageCount()).toBe(10);
  expect(doc.getPage(1).getRotation().angle).toBe(90);
  const texts = await pageTexts(bytes);
  expect(texts[3].trim()).toBe(''); // página en blanco
  expect(errors).toEqual([]);
});

test('organizar: reordenar arrastrando y con Alt+flechas', async ({ page }) => {
  await openTool(page, 'reorder');
  await upload(page, 'sample-3.pdf');
  const thumbs = page.locator('#pageGrid .page-thumb');
  await expect(thumbs).toHaveCount(3);
  await expect(thumbs.nth(2)).toHaveClass(/is-rendered/);
  // Teclado: foco en la 1ª y Alt+Derecha → pasa a 2ª posición
  await thumbs.nth(0).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(thumbs.nth(1)).toContainText('Pág. 1');
  // Ratón: arrastrar la 3ª antes de la 1ª
  const a = await thumbs.nth(2).boundingBox();
  const b = await thumbs.nth(0).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 - 20, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(thumbs.nth(0)).toContainText('Pág. 3');
  await page.locator('#undoBtn').click();
  await expect(thumbs.nth(0)).toContainText('Pág. 2');
});

test('rotar: impares 90° y guardar', async ({ page }) => {
  const errors = await openTool(page, 'rotate');
  await upload(page, 'sample-3.pdf');
  await expect(page.locator('#pageGrid .page-thumb')).toHaveCount(3);
  await page.locator('#selOdd').click();
  await page.locator('#rotRight').click();
  await page.getByTestId('run').click();
  const { bytes } = await downloadResult(page);
  const doc = await loadPdf(bytes);
  expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 180]); // la 3ª ya tenía 90°
  expect(errors).toEqual([]);
});
