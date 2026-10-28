import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFLib } from '../../assets/js/core/libs.js';
import { rawScan, analyze, sanitize } from '../../assets/js/core/pdf-analyzer.js';

const { PDFDocument, PDFName, PDFString } = PDFLib;

async function suspicious() {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const ctx = doc.context;
  doc.catalog.set(PDFName.of('OpenAction'), ctx.register(ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') })));
  page.node.set(PDFName.of('AA'), ctx.obj({ O: ctx.obj({ S: 'Launch', F: PDFString.of('calc.exe') }) }));
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: ctx.obj({ S: 'URI', URI: PDFString.of('http://192.168.1.10/login') }) }));
  page.node.set(PDFName.of('Annots'), ctx.obj([link]));
  await doc.attach(new Uint8Array([1, 2, 3]), 'nomina.pdf.scr', { mimeType: 'application/octet-stream' });
  return doc;
}

test('analyze detecta JavaScript, Launch, adjunto ejecutable y enlace sospechoso', async () => {
  const doc = await suspicious();
  const bytes = await doc.save({ useObjectStreams: false });
  const r = analyze(await PDFDocument.load(bytes), rawScan(bytes));
  const ids = r.findings.map((f) => f.id);
  assert.equal(r.level, 'high');
  for (const id of ['javascript', 'launch', 'attachments', 'links', 'auto-actions']) assert.ok(ids.includes(id), id);
  const links = r.findings.find((f) => f.id === 'links');
  assert.match(links.items[0], /IP en lugar de dominio/);
  assert.match(links.items[0], /sin cifrar/);
  assert.equal(r.findings.find((f) => f.id === 'attachments').severity, 'high');
});

test('sanitize deja el documento sin elementos activos', async () => {
  // pdf-lib incrusta los adjuntos al guardar: se recarga para tenerlos en el árbol.
  const doc = await PDFDocument.load(await (await suspicious()).save());
  const removed = sanitize(doc, { links: true });
  assert.ok(removed.acciones >= 2);
  assert.equal(removed.adjuntos, 1);
  assert.equal(removed.enlaces, 1);
  const bytes = await doc.save();
  const r = analyze(await PDFDocument.load(bytes), rawScan(bytes));
  assert.ok(['ok', 'low'].includes(r.level), r.level);
  assert.doesNotMatch(new TextDecoder('latin1').decode(bytes), /JavaScript|Launch|calc\.exe/);
});

test('rawScan: nombres ofuscados, políglotas y actualizaciones incrementales', () => {
  const src = 'GIF89a%PDF-1.7\n1 0 obj << /Type /Catalog /OpenAction 2 0 R >> endobj\n2 0 obj << /S /J#61vaScript /J#53 (x) >> endobj\ntrailer\n%%EOF\n3 0 obj << >> endobj\n%%EOF\nBASURA';
  const r = rawScan(new TextEncoder().encode(src));
  assert.equal(r.counts['/JavaScript'], 1);
  assert.equal(r.obfuscated['/JavaScript'], 1);
  assert.equal(r.obfuscated['/JS'], 1);
  assert.equal(r.headerOffset, 6);
  assert.equal(r.eofCount, 2);
  assert.ok(r.trailingBytes > 0);
  assert.equal(r.header, '%PDF-1.7');
});
