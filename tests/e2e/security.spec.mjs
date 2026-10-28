import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openTool, upload, downloadResult, answerPassword, loadPdf, PDFLib } from './helpers.mjs';

function qpdf(args, bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'pdfm-'));
  const f = join(dir, 'x.pdf');
  writeFileSync(f, bytes);
  try { return execFileSync('qpdf', [...args, f], { encoding: 'utf8' }); }
  catch (err) { if (err.code === 'ENOENT') return null; return String(err.stdout || '') + String(err.stderr || ''); }
}

test('protege con AES-256 y permisos; el resultado está cifrado de verdad', async ({ page }) => {
  const errors = await openTool(page, 'protect');
  await upload(page, 'sample-3.pdf');
  await page.locator('#userPwd').fill('Mi-Clave-2024!');
  await page.locator('#userPwd2').fill('Mi-Clave-2024!');
  await expect(page.locator('#strength')).toHaveAttribute('data-level', /[34]/);
  await page.selectOption('#permPrint', 'low');
  await page.locator('#permCopy').uncheck();
  await page.getByTestId('run').click();
  const owner = await page.getByTestId('owner-password').textContent();
  expect(owner).toHaveLength(24);
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('sample-3_protegido.pdf');

  // Sin contraseña no se puede abrir; con ella, sí
  await expect(loadPdf(bytes)).rejects.toThrow(/encrypted/i);
  const ok = await PDFLib.PDFDocument.load(bytes, { password: 'Mi-Clave-2024!' });
  expect(ok.getPageCount()).toBe(3);
  await expect(PDFLib.PDFDocument.load(bytes, { password: 'mala' })).rejects.toThrow();

  const info = qpdf(['--show-encryption', '--password=Mi-Clave-2024!'], bytes);
  if (info !== null) {
    expect(info).toContain('R = 6');
    expect(info).toMatch(/stream encryption method: AESv3/);
    expect(info).toMatch(/print high resolution: not allowed/);
    expect(info).toMatch(/extract for any purpose: not allowed/);
  }
  expect(errors).toEqual([]);
});

test('no deja proteger con contraseñas distintas', async ({ page }) => {
  await openTool(page, 'protect');
  await upload(page, 'sample-3.pdf');
  await page.locator('#userPwd').fill('uno');
  await page.locator('#userPwd2').fill('dos');
  await expect(page.locator('#matchError')).toBeVisible();
  await page.getByTestId('run').click();
  await expect(page.locator('.toast-error')).toContainText('no coinciden');
});

test('desbloquea un PDF con contraseña de apertura', async ({ page }) => {
  const errors = await openTool(page, 'unlock');
  await upload(page, 'encrypted-aes256.pdf');
  await answerPassword(page, 'mala');
  await expect(page.locator('dialog[open] .dialog__error')).toContainText('incorrecta');
  await answerPassword(page, 'abrir');
  await expect(page.locator('#info')).toContainText('AES-256');
  await expect(page.locator('#info')).toContainText('restringido');
  await page.getByTestId('run').click();
  const { name, bytes } = await downloadResult(page);
  expect(name).toBe('encrypted-aes256_desbloqueado.pdf');
  const doc = await loadPdf(bytes);
  expect(doc.isEncrypted).toBe(false);
  expect(doc.getPageCount()).toBe(2);
  const info = qpdf(['--show-encryption'], bytes);
  if (info !== null) expect(info).toContain('File is not encrypted');
  expect(errors).toEqual([]);
});

test('quita restricciones sin contraseña y detecta PDFs sin proteger', async ({ page }) => {
  await openTool(page, 'unlock');
  await upload(page, 'owner-only.pdf');
  await expect(page.locator('#info')).toContainText('solo tenía restricciones');
  await page.getByTestId('run').click();
  const { bytes } = await downloadResult(page);
  expect((await loadPdf(bytes)).isEncrypted).toBe(false);

  await page.getByRole('button', { name: 'Empezar de nuevo' }).click();
  await upload(page, 'sample-3.pdf');
  await expect(page.locator('#info')).toContainText('no está protegido');
  await expect(page.getByTestId('run')).toBeHidden();
});
