// Coherencia del sitio estático: páginas, registro, CSP, librerías y service worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { TOOLS, CATEGORIES } from '../../assets/js/core/registry.js';
import { ROOT, buildServiceWorker } from '../../scripts/build-sw.mjs';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('cada herramienta del registro tiene su página y su script', () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const t of TOOLS) {
    assert.ok(cats.has(t.category), `${t.id}: categoría desconocida`);
    const html = read(`tools/${t.file}`);
    assert.match(html, new RegExp(`<body data-tool="${t.id}">`), `${t.id}: data-tool`);
    assert.match(html, new RegExp(`src="../assets/js/tools/${t.id}.js"`), `${t.id}: script`);
    assert.ok(existsSync(join(ROOT, `assets/js/tools/${t.id}.js`)), `${t.id}: falta el JS`);
  }
});

test('todas las páginas declaran una CSP estricta y no cargan nada externo', () => {
  for (const p of ['index.html', ...TOOLS.map((t) => `tools/${t.file}`)]) {
    const html = read(p);
    assert.match(html, /http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval';/, p);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${p}: script en línea`);
    assert.doesNotMatch(html, /(src|href)="https?:\/\//, `${p}: recurso externo`);
  }
  assert.match(read('404.html'), /default-src 'none'/);
});

test('ningún JS usa innerHTML con datos (solo iconos constantes)', () => {
  for (const t of TOOLS) {
    assert.doesNotMatch(read(`assets/js/tools/${t.id}.js`), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, t.id);
  }
});

test('las librerías vendorizadas coinciden con los hashes de versions.json', () => {
  const manifest = JSON.parse(read('assets/vendor/versions.json'));
  for (const lib of Object.values(manifest)) {
    for (const [file, sri] of Object.entries(lib.files)) {
      const digest = 'sha384-' + createHash('sha384').update(readFileSync(join(ROOT, 'assets/vendor', file))).digest('base64');
      assert.equal(digest, sri, file);
    }
  }
});

test('sw.js está actualizado (ejecuta «npm run sw» si falla)', () => {
  assert.equal(read('sw.js'), buildServiceWorker());
});
