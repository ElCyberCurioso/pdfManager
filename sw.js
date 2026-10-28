/* ============================================================
   SERVICE WORKER — Uso sin conexión.
   ARCHIVO GENERADO por scripts/build-sw.mjs: no editar a mano.
   Estrategia: caché primero (versionada por contenido). Lo que no
   está precacheado (CMaps, fuentes, WASM de PDF.js) se guarda la
   primera vez que se usa.
   ============================================================ */
const VERSION = '867c849e647b';
const CACHE = `pdfmanager-${VERSION}`;
const PRECACHE = [
  './',
  './404.html',
  './assets/css/base.css',
  './assets/css/components.css',
  './assets/css/layout.css',
  './assets/img/icon.svg',
  './assets/js/core/app.js',
  './assets/js/core/dom.js',
  './assets/js/core/download.js',
  './assets/js/core/file-handler.js',
  './assets/js/core/geometry.js',
  './assets/js/core/handoff.js',
  './assets/js/core/icons.js',
  './assets/js/core/images.js',
  './assets/js/core/libs.js',
  './assets/js/core/live-preview.js',
  './assets/js/core/optimize.js',
  './assets/js/core/page-grid.js',
  './assets/js/core/password.js',
  './assets/js/core/pdf-analyzer.js',
  './assets/js/core/pdf-engine.js',
  './assets/js/core/pdf-objects.js',
  './assets/js/core/ranges.js',
  './assets/js/core/registry.js',
  './assets/js/core/render.js',
  './assets/js/core/sortable.js',
  './assets/js/core/stamp.js',
  './assets/js/core/tool.js',
  './assets/js/core/ui.js',
  './assets/js/core/zip.js',
  './assets/js/home.js',
  './assets/js/theme-boot.js',
  './assets/js/tools/compress.js',
  './assets/js/tools/extract-text.js',
  './assets/js/tools/image-to-pdf.js',
  './assets/js/tools/inspect.js',
  './assets/js/tools/merge.js',
  './assets/js/tools/metadata.js',
  './assets/js/tools/page-numbers.js',
  './assets/js/tools/pdf-to-image.js',
  './assets/js/tools/protect.js',
  './assets/js/tools/reorder.js',
  './assets/js/tools/rotate.js',
  './assets/js/tools/sign.js',
  './assets/js/tools/split.js',
  './assets/js/tools/unlock.js',
  './assets/js/tools/watermark.js',
  './assets/vendor/pdf-lib/pdf-lib.esm.min.js',
  './assets/vendor/pdfjs/pdf.min.js',
  './assets/vendor/pdfjs/pdf.worker.min.js',
  './assets/vendor/versions.json',
  './index.html',
  './manifest.webmanifest',
  './tools/compress.html',
  './tools/extract-text.html',
  './tools/image-to-pdf.html',
  './tools/inspect.html',
  './tools/merge.html',
  './tools/metadata.html',
  './tools/page-numbers.html',
  './tools/pdf-to-image.html',
  './tools/protect.html',
  './tools/reorder.html',
  './tools/rotate.html',
  './tools/sign.html',
  './tools/split.html',
  './tools/unlock.html',
  './tools/watermark.html',
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
