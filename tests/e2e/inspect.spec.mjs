import { test, expect } from '@playwright/test';
import { openTool, upload, downloadResult, loadPdf } from './helpers.mjs';

test('detecta elementos peligrosos, exporta informe y sanea', async ({ page }) => {
  const errors = await openTool(page, 'inspect');
  await upload(page, 'suspicious.pdf');
  await expect(page.getByTestId('risk-level')).toHaveText('Riesgo alto');
  await expect(page.getByTestId('finding-javascript')).toContainText("app.alert('Hola desde JavaScript')");
  await expect(page.getByTestId('finding-launch')).toContainText('cmd.exe');
  await expect(page.getByTestId('finding-attachments')).toContainText('factura.pdf.exe');
  await expect(page.getByTestId('finding-links')).toContainText('login-banco.example.com');
  await expect(page.locator('#sAttach')).toBeChecked();

  // Informe Markdown con hash
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#mdBtn').click()]);
  expect(dl.suggestedFilename()).toBe('suspicious_informe.md');
  const md = await (await import('node:fs')).promises.readFile(await dl.path(), 'utf8');
  expect(md).toMatch(/SHA-256:\*\* `[0-9a-f]{64}`/);
  expect(md).toContain('[Alto] JavaScript');

  await page.locator('#sLinks').check();
  await page.getByTestId('run').click();
  await expect(page.locator('#result')).toContainText('Tras sanear: no se han detectado riesgos');
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('suspicious_saneado.pdf');
  const raw = new TextDecoder('latin1').decode(bytes);
  expect(raw).not.toMatch(/JavaScript|OpenAction|Launch|EmbeddedFile/);
  expect((await loadPdf(bytes)).getPageCount()).toBe(2);
  expect(errors).toEqual([]);
});

test('un PDF normal no tiene riesgos', async ({ page }) => {
  await openTool(page, 'inspect');
  await upload(page, 'sample-3.pdf');
  await expect(page.getByTestId('risk-level')).toHaveText('No se han detectado riesgos');
});
