/* ============================================================
   FIXTURES — Genera los PDFs e imágenes de prueba en
   tests/fixtures/out/. Usa la MISMA pdf-lib que el sitio y
   Chromium (Playwright) para codificar imágenes JPEG/PNG/WebP.

   Uso: npm run fixtures
   ============================================================ */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import * as PDFLib from '../../assets/vendor/pdf-lib/pdf-lib.esm.min.js';

const { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFString, PDFHexString } = PDFLib;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const save = (name, bytes) => writeFileSync(join(OUT, name), bytes);
const FIXED_DATE = new Date('2024-01-02T03:04:05Z');

// ---- Imágenes generadas con canvas en Chromium -----------------
async function makeImages() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const images = await page.evaluate(async () => {
    const enc = async (canvas, type, q) => {
      const blob = await new Promise((r) => canvas.toBlob(r, type, q));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    };
    const draw = (w, h, label, alpha = false) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!alpha) {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#1e3a8a'); g.addColorStop(0.5, '#e8334a'); g.addColorStop(1, '#f59e0b');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        // ruido para que el JPEG pese (simula una foto)
        const img = ctx.getImageData(0, 0, w, h);
        let seed = 7;
        for (let i = 0; i < img.data.length; i += 4) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          const n = (seed % 40) - 20;
          img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
        }
        ctx.putImageData(img, 0, 0);
      } else {
        ctx.fillStyle = 'rgba(232,51,74,0.85)';
        ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(h / 6)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, w / 2, h / 2);
      // marca "ARRIBA" para comprobar la orientación
      ctx.font = `bold ${Math.round(h / 12)}px sans-serif`;
      ctx.fillText('ARRIBA', w / 2, h / 10);
      return c;
    };
    return {
      bigJpeg: await enc(draw(2400, 1800, 'FOTO'), 'image/jpeg', 0.95),
      photoJpeg: await enc(draw(800, 600, 'JPG'), 'image/jpeg', 0.9),
      logoPng: await enc(draw(400, 400, 'PNG', true), 'image/png'),
      webp: await enc(draw(640, 480, 'WEBP'), 'image/webp', 0.9),
    };
  });
  await browser.close();
  return Object.fromEntries(Object.entries(images).map(([k, v]) => [k, new Uint8Array(v)]));
}

/** Inserta un segmento EXIF mínimo con la orientación indicada en un JPEG. */
function withExifOrientation(jpeg, orientation) {
  const tiff = new Uint8Array([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II*\0", IFD en 8
    0x01, 0x00,                                     // 1 entrada
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, // 0x0112 SHORT x1
    orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,                         // siguiente IFD: ninguno
  ]);
  const exif = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]); // "Exif\0\0"
  const len = exif.length + 2;
  const seg = new Uint8Array([0xff, 0xe1, len >> 8, len & 255, ...exif]);
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(seg, 2);
  out.set(jpeg.subarray(2), 2 + seg.length);
  return out;
}

// ---- PDFs ------------------------------------------------------
async function textPdf(pages, { size = [595.28, 841.89], rotateLast = false, title = 'Documento de prueba' } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage(size);
    const { width, height } = p.getSize();
    const hue = (i * 47) % 360;
    const c = hslToRgb(hue / 360, 0.6, 0.5);
    p.drawRectangle({ x: 0, y: height - 60, width, height: 60, color: rgb(...c) });
    p.drawText(`Página ${i}`, { x: 50, y: height / 2, size: 64, font, color: rgb(0.1, 0.1, 0.15) });
    p.drawText(`Texto de ejemplo para extraer en la página ${i}. Ñandú, acción, €.`, { x: 50, y: height / 2 - 60, size: 14, font: body });
    p.drawText('ESQUINA SUPERIOR', { x: 20, y: height - 40, size: 14, font, color: rgb(1, 1, 1) });
    if (rotateLast && i === pages) p.setRotation(degrees(90));
  }
  return doc;
}

function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

async function main() {
  const img = await makeImages();
  save('photo.jpg', img.photoJpeg);
  save('photo-rotated.jpg', withExifOrientation(img.photoJpeg, 6)); // girar 90° a la derecha al mostrar
  save('logo.png', img.logoPng);
  save('image.webp', img.webp);

  // 3 páginas A4, la última con /Rotate 90
  save('sample-3.pdf', await (await textPdf(3, { rotateLast: true })).save());
  // 10 páginas Carta
  save('sample-10.pdf', await (await textPdf(10, { size: [612, 792], title: 'Diez páginas' })).save());

  // Con marcadores (para dividir por marcadores)
  {
    const doc = await textPdf(6, { title: 'Con capítulos' });
    const ctx = doc.context;
    const pages = doc.getPages();
    const outlines = ctx.nextRef();
    const chapters = [['Capítulo 1', 0], ['Capítulo 2', 2], ['Anexo', 5]];
    const refs = chapters.map(() => ctx.nextRef());
    chapters.forEach(([title, idx], i) => {
      const d = { Title: PDFHexString.fromText(title), Parent: outlines, Dest: ctx.obj([pages[idx].ref, PDFName.of('XYZ'), null, null, null]) };
      if (i > 0) d.Prev = refs[i - 1];
      if (i < refs.length - 1) d.Next = refs[i + 1];
      ctx.assign(refs[i], ctx.obj(d));
    });
    ctx.assign(outlines, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: refs.length }));
    doc.catalog.set(PDFName.of('Outlines'), outlines);
    save('outline.pdf', await doc.save());
  }

  // Cifrados (AES-256): con contraseña de apertura y solo con restricciones
  {
    const doc = await textPdf(2, { title: 'Secreto' });
    doc.encrypt({ userPassword: 'abrir', ownerPassword: 'propietario', permissions: { printing: 'highResolution', copying: false, modifying: false } });
    save('encrypted-aes256.pdf', await doc.save());
    const doc2 = await textPdf(2, { title: 'Restringido' });
    doc2.encrypt({ userPassword: '', ownerPassword: 'propietario', permissions: { printing: false, copying: false, modifying: false } });
    save('owner-only.pdf', await doc2.save());
  }

  // Con imágenes grandes (para comprimir)
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const jpg = await doc.embedJpg(img.bigJpeg);
    const png = await doc.embedPng(img.logoPng);
    for (let i = 0; i < 3; i++) {
      const p = doc.addPage([595.28, 841.89]);
      p.drawImage(jpg, { x: 40, y: 300, width: 515, height: 386 });
      p.drawImage(png, { x: 40, y: 80, width: 150, height: 150 });
      p.drawText(`Texto vectorial que debe seguir siendo seleccionable (${i + 1})`, { x: 40, y: 260, size: 14, font });
    }
    save('images.pdf', await doc.save());
  }

  // Metadatos completos + XMP
  {
    const doc = await textPdf(1, { title: 'Informe confidencial' });
    doc.setAuthor('Ana Pérez');
    doc.setSubject('Pruebas de metadatos');
    doc.setKeywords(['pdf', 'metadatos', 'prueba']);
    doc.setCreator('Editor Interno 3.1');
    doc.setProducer('Generador de Pruebas');
    const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Ana Pérez</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
    const stream = doc.context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
    save('metadata.pdf', await doc.save({ updateFieldAppearances: false }));
  }

  // PDF "sospechoso" de laboratorio: JavaScript, acciones, enlace y adjunto.
  // (Inofensivo: el JS solo muestra una alerta; el adjunto es texto.)
  {
    const doc = await textPdf(2, { title: 'Muestra sospechosa' });
    const ctx = doc.context;
    const js = ctx.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of("app.alert('Hola desde JavaScript');") });
    doc.catalog.set(PDFName.of('OpenAction'), ctx.register(js));
    // Árbol de nombres JavaScript
    const js2 = ctx.register(ctx.obj({ S: 'JavaScript', JS: PDFString.of('var x = 1;') }));
    doc.catalog.set(PDFName.of('Names'), ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of('init'), js2] }) }));
    // Acción adicional de página y acción Launch
    const page = doc.getPage(0);
    page.node.set(PDFName.of('AA'), ctx.obj({ O: ctx.obj({ S: 'Launch', F: PDFString.of('cmd.exe') }) }));
    // Enlace URI
    const link = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [50, 50, 250, 80], Border: [0, 0, 0],
      A: ctx.obj({ S: 'URI', URI: PDFString.of('http://login-banco.example.com/verificar') }),
    }));
    page.node.set(PDFName.of('Annots'), ctx.obj([link]));
    // Adjunto
    await doc.attach(new TextEncoder().encode('echo "esto es una prueba"'), 'factura.pdf.exe', { mimeType: 'application/octet-stream', description: 'Adjunto de prueba' });
    save('suspicious.pdf', await doc.save());
  }

  console.log('Fixtures generados en', OUT);
}

main().catch((err) => { console.error(err); process.exit(1); });
