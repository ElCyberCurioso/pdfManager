/* ============================================================
   BUILD-SW — Genera sw.js con la lista de archivos a precachear
   y una versión derivada de su contenido (si cambia cualquier
   archivo, cambia la versión y el navegador actualiza la caché).

   Uso: npm run sw        (los tests fallan si sw.js está desfasado)
   ============================================================ */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, filter) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

/** Archivos que se descargan al instalar (lo imprescindible para trabajar sin red). */
export function precacheList() {
  const rel = (f) => relative(ROOT, f).split(sep).join('/');
  const files = [
    'index.html', '404.html', 'manifest.webmanifest', 'assets/img/icon.svg',
    ...walk(join(ROOT, 'tools'), (f) => f.endsWith('.html')).map(rel),
    ...walk(join(ROOT, 'assets/css'), (f) => f.endsWith('.css')).map(rel),
    ...walk(join(ROOT, 'assets/js'), (f) => f.endsWith('.js')).map(rel),
    'assets/vendor/versions.json',
    'assets/vendor/pdf-lib/pdf-lib.esm.min.js',
    'assets/vendor/pdfjs/pdf.min.js',
    'assets/vendor/pdfjs/pdf.worker.min.js',
  ];
  return [...new Set(files)].sort();
}

export function buildServiceWorker() {
  const list = precacheList();
  const hash = createHash('sha256');
  for (const f of list) hash.update(f).update(readFileSync(join(ROOT, f)));
  const version = hash.digest('hex').slice(0, 12);
  return `/* ============================================================
   SERVICE WORKER — Uso sin conexión.
   ARCHIVO GENERADO por scripts/build-sw.mjs: no editar a mano.
   Estrategia: caché primero (versionada por contenido). Lo que no
   está precacheado (CMaps, fuentes, WASM de PDF.js) se guarda la
   primera vez que se usa.
   ============================================================ */
const VERSION = '${version}';
const CACHE = \`pdfmanager-\${VERSION}\`;
const PRECACHE = [
  './',
${list.map((f) => `  './${f}',`).join('\n')}
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pdfmanager-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        return (await cache.match(new URL('./index.html', self.registration.scope).href)) || Response.error();
      }
      throw err;
    }
  })());
});
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(ROOT, 'sw.js'), buildServiceWorker());
  console.log(`sw.js actualizado (${precacheList().length + 1} recursos precacheados).`);
}
