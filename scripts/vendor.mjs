/* ============================================================
   VENDOR — Copia las librerías de node_modules a assets/vendor
   con versión fijada. El sitio se despliega sin build: los
   ficheros resultantes se versionan en el repositorio.

   Uso: npm install && npm run vendor
   ============================================================ */
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root   = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm     = join(root, 'node_modules');
const vendor = join(root, 'assets', 'vendor');

const pkgVersion = (name) =>
  JSON.parse(readFileSync(join(nm, name, 'package.json'), 'utf8')).version;

rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });

// ---- pdf-lib (fork @cantoo: añade cifrado AES-256 y descifrado) ----
const pdfLibDir = join(vendor, 'pdf-lib');
mkdirSync(pdfLibDir);
copyFileSync(join(nm, '@cantoo/pdf-lib/dist/pdf-lib.esm.min.js'), join(pdfLibDir, 'pdf-lib.esm.min.js'));
copyFileSync(join(nm, '@cantoo/pdf-lib/LICENSE.md'), join(pdfLibDir, 'LICENSE.md'));

// ---- PDF.js (build "legacy" para mayor compatibilidad de navegadores) ----
// Se renombran .mjs → .js para que cualquier servidor estático los sirva
// con un MIME de JavaScript (requisito de los módulos ES).
const pdfjsDir = join(vendor, 'pdfjs');
mkdirSync(pdfjsDir);
copyFileSync(join(nm, 'pdfjs-dist/legacy/build/pdf.min.mjs'),        join(pdfjsDir, 'pdf.min.js'));
copyFileSync(join(nm, 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'), join(pdfjsDir, 'pdf.worker.min.js'));
copyFileSync(join(nm, 'pdfjs-dist/LICENSE'), join(pdfjsDir, 'LICENSE'));
cpSync(join(nm, 'pdfjs-dist/standard_fonts'), join(pdfjsDir, 'standard_fonts'), { recursive: true });
cpSync(join(nm, 'pdfjs-dist/cmaps'),          join(pdfjsDir, 'cmaps'),          { recursive: true });
cpSync(join(nm, 'pdfjs-dist/iccs'),           join(pdfjsDir, 'iccs'),           { recursive: true });
// Decodificadores WASM (JBIG2, JPEG 2000, color ICC). Se omite quickjs:
// solo sirve para ejecutar el JavaScript embebido en PDFs, que no queremos.
mkdirSync(join(pdfjsDir, 'wasm'));
for (const f of readdirSync(join(nm, 'pdfjs-dist/wasm'))) {
  if (f.startsWith('quickjs')) continue;
  copyFileSync(join(nm, 'pdfjs-dist/wasm', f), join(pdfjsDir, 'wasm', f));
}

// ---- Manifiesto de versiones + hashes SHA-384 (auditoría) ----
const sri = (p) => 'sha384-' + createHash('sha384').update(readFileSync(p)).digest('base64');
const manifest = {
  '@cantoo/pdf-lib': {
    version: pkgVersion('@cantoo/pdf-lib'),
    files: { 'pdf-lib/pdf-lib.esm.min.js': sri(join(pdfLibDir, 'pdf-lib.esm.min.js')) },
  },
  'pdfjs-dist': {
    version: pkgVersion('pdfjs-dist'),
    files: {
      'pdfjs/pdf.min.js':        sri(join(pdfjsDir, 'pdf.min.js')),
      'pdfjs/pdf.worker.min.js': sri(join(pdfjsDir, 'pdf.worker.min.js')),
    },
  },
};
writeFileSync(join(vendor, 'versions.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Vendor actualizado:', Object.entries(manifest).map(([k, v]) => `${k}@${v.version}`).join(', '));
