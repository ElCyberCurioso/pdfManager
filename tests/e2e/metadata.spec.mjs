import { test, expect } from '@playwright/test';
import { openTool, upload, downloadResult, loadPdf } from './helpers.mjs';

const latin1 = (b) => new TextDecoder('latin1').decode(b);
const utf16hex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();

test('edita metadatos y elimina el XMP sin dejar restos', async ({ page }) => {
  const errors = await openTool(page, 'metadata');
  await upload(page, 'metadata.pdf');
  await expect(page.locator('#fAuthor')).toHaveValue('Ana Pérez');
  await expect(page.locator('#fTitle')).toHaveValue('Informe confidencial');
  await expect(page.locator('#facts')).toContainText('Metadatos XMP');
  await expect(page.locator('#dropXmp')).toBeChecked();
  await page.locator('#fAuthor').fill('Departamento Legal');
  await page.locator('#fLang').fill('es-ES');
  await page.getByTestId('run').click();
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('metadata_metadatos.pdf');
  const doc = await loadPdf(bytes);
  expect(doc.getAuthor()).toBe('Departamento Legal');
  expect(doc.getTitle()).toBe('Informe confidencial');
  // El autor anterior no debe quedar en ninguna parte del archivo (ni en el XMP huérfano)
  const raw = latin1(bytes);
  expect(raw).not.toContain('Ana P');
  expect(raw.toUpperCase()).not.toContain(utf16hex('Ana Pérez'));
  expect(errors).toEqual([]);
});

test('elimina todos los metadatos y renueva el /ID', async ({ page }) => {
  await openTool(page, 'metadata');
  await upload(page, 'metadata.pdf');
  const oldId = (await page.locator('#facts td.mono').textContent()).trim();
  await page.getByTestId('strip').click();
  const { bytes } = await downloadResult(page);
  const doc = await loadPdf(bytes);
  expect(doc.getTitle()).toBeUndefined();
  expect(doc.getAuthor()).toBeUndefined();
  const raw = latin1(bytes);
  expect(raw).not.toContain('xmpmeta');
  expect(raw.toUpperCase()).not.toContain(utf16hex('Informe'));
  if (oldId !== '—') expect(raw.toLowerCase()).not.toContain(oldId.toLowerCase());
  expect(raw).toMatch(/\/ID \[ <[0-9a-f]{32}>/i);
});
