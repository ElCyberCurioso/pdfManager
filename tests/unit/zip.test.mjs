import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createZip, crc32, uniqueName } from '../../assets/js/core/zip.js';

test('crc32 conocido', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('uniqueName evita duplicados', () => {
  const used = new Set();
  assert.equal(uniqueName('a.pdf', used), 'a.pdf');
  assert.equal(uniqueName('a.pdf', used), 'a (2).pdf');
  assert.equal(uniqueName('a.pdf', used), 'a (3).pdf');
});

test('el ZIP generado lo lee una herramienta estándar (python zipfile)', (t) => {
  const zip = createZip([
    { name: 'uno.txt', data: new TextEncoder().encode('hola') },
    { name: 'carpeta/ñandú €.txt', data: new TextEncoder().encode('adiós') },
    { name: 'uno.txt', data: new Uint8Array([1, 2, 3]) },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const file = join(dir, 'x.zip');
  writeFileSync(file, zip);
  let out;
  try {
    out = execFileSync('python3', ['-c', `import zipfile,json,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(json.dumps({n: z.read(n).hex() for n in z.namelist()}))`, file], { encoding: 'utf8' });
  } catch (err) {
    if (err.code === 'ENOENT') return t.skip('python3 no disponible');
    throw err;
  }
  const entries = JSON.parse(out);
  assert.deepEqual(Object.keys(entries), ['uno.txt', 'carpeta/ñandú €.txt', 'uno (2).txt']);
  assert.equal(Buffer.from(entries['uno.txt'], 'hex').toString(), 'hola');
  assert.equal(Buffer.from(entries['carpeta/ñandú €.txt'], 'hex').toString(), 'adiós');
});
