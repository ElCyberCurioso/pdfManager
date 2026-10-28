import { test, expect } from '@playwright/test';
import { fixture, downloadResult, loadPdf } from './helpers.mjs';

test.use({ serviceWorkers: 'allow' });

test('funciona sin conexión tras la primera visita', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Esperar a que el SW controle la página
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.goto('tools/merge.html');
  await expect(page.locator('.tool-header__title')).toHaveText('Unir PDFs');
  await page.setInputFiles('#dropZone input[type=file]', [fixture('sample-3.pdf'), fixture('sample-10.pdf')]);
  await expect(page.getByTestId('file-item')).toHaveCount(2);
  await page.getByTestId('run').click();
  const { bytes } = await downloadResult(page);
  expect((await loadPdf(bytes)).getPageCount()).toBe(13);
  await context.setOffline(false);
});

test('la portada filtra herramientas con el buscador', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.tool-card')).toHaveCount(15);
  await page.locator('#search').fill('contrasena');
  await expect(page.locator('.tool-card:visible')).toHaveCount(2);
  await page.locator('#search').fill('xyz123');
  await expect(page.locator('#empty')).toBeVisible();
  await page.locator('#search').fill('firmar');
  await page.locator('#search').press('Enter');
  await expect(page).toHaveURL(/tools\/sign\.html$/);
});

test('«Continuar con…» pasa el resultado a otra herramienta', async ({ page }) => {
  await page.goto('tools/merge.html');
  await page.setInputFiles('#dropZone input[type=file]', [fixture('sample-3.pdf'), fixture('sample-10.pdf')]);
  await expect(page.getByTestId('file-item')).toHaveCount(2);
  await page.getByTestId('run').click();
  await page.locator('.continue-select').selectOption('page-numbers');
  await expect(page).toHaveURL(/tools\/page-numbers\.html/);
  await expect(page.getByTestId('file-summary')).toContainText('unido.pdf');
  await expect(page.getByTestId('file-summary')).toContainText('13 páginas');
});

test('la 404 es autónoma', async ({ page }) => {
  const res = await page.goto('no-existe/de-verdad.html');
  expect(res.status()).toBe(404);
  await expect(page.locator('h1')).toHaveText('404');
});
