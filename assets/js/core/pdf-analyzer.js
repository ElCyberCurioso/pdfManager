/* ============================================================
   PDF ANALYZER — Triaje de seguridad de PDFs.
   1) rawScan: recuento de palabras clave sobre los bytes
      originales, al estilo de pdfid (detecta nombres ofuscados
      con #xx, actualizaciones incrementales, datos tras %%EOF…).
   2) analyze: análisis estructural con pdf-lib (ve también el
      interior de los object streams y PDFs cifrados): JavaScript,
      acciones automáticas, Launch, enlaces, adjuntos, XFA…
   3) sanitize: elimina lo anterior de forma selectiva.
   Módulo sin DOM: se prueba con node --test.
   ============================================================ */
import { PDFLib } from './libs.js';
import { N, textOf, nameTreeEntries, removeUnreachable } from './pdf-objects.js';

const { PDFDict, PDFArray, PDFRef, PDFStream, PDFRawStream, PDFName, PDFNumber, decodePDFRawStream } = PDFLib;

export const PDFID_KEYWORDS = [
  'obj', 'endobj', 'stream', 'endstream', 'xref', 'trailer', 'startxref',
  '/Page', '/Encrypt', '/ObjStm', '/JS', '/JavaScript', '/AA', '/OpenAction',
  '/AcroForm', '/JBIG2Decode', '/RichMedia', '/Launch', '/EmbeddedFile', '/XFA',
  '/URI', '/SubmitForm', '/ImportData', '/GoToR', '/GoToE',
];

const RISKY_EXT = /\.(exe|scr|com|pif|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|dll|cpl|lnk|jar|reg|sh|bin|iso|img|vhd|docm|xlsm|pptm|dotm|xlam|one|chm|apk|app)$/i;

// ---- 1) Recuento sobre bytes crudos ---------------------------------
/**
 * @param {Uint8Array} bytes  bytes ORIGINALES del archivo
 * @returns {{counts: Record<string,number>, obfuscated: Record<string,number>, header: string,
 *            headerOffset: number, eofCount: number, trailingBytes: number}}
 */
export function rawScan(bytes) {
  const text = new TextDecoder('latin1').decode(bytes);
  const counts = Object.fromEntries(PDFID_KEYWORDS.map((k) => [k, 0]));
  const obfuscated = {};
  // Nombres PDF: /Nombre con posibles escapes #xx
  const nameRe = /\/([^\s/<>[\]()%{}]+)/g;
  let m;
  while ((m = nameRe.exec(text))) {
    let raw = m[1];
    let name = raw;
    if (raw.includes('#')) {
      name = raw.replace(/#([0-9a-fA-F]{2})/g, (_, hx) => String.fromCharCode(parseInt(hx, 16)));
    }
    const key = `/${name}`;
    // pdfid cuenta /Page pero no /Pages
    if (key in counts) {
      counts[key]++;
      if (name !== raw) obfuscated[key] = (obfuscated[key] || 0) + 1;
    } else if (key.startsWith('/EmbeddedFile')) {
      counts['/EmbeddedFile']++;
    }
  }
  for (const kw of ['obj', 'endobj', 'stream', 'endstream', 'xref', 'trailer', 'startxref']) {
    counts[kw] = (text.match(new RegExp(`(?<![A-Za-z])${kw}(?![A-Za-z])`, 'g')) || []).length;
  }
  const headerOffset = text.indexOf('%PDF-');
  const header = headerOffset >= 0 ? text.slice(headerOffset, headerOffset + 8).trim() : '';
  const eofs = [...text.matchAll(/%%EOF/g)];
  const lastEof = eofs.length ? eofs[eofs.length - 1].index + 5 : text.length;
  const trailingBytes = text.slice(lastEof).replace(/[\r\n\s\0]/g, '').length;
  return { counts, obfuscated, header, headerOffset, eofCount: eofs.length, trailingBytes };
}

// ---- 2) Análisis estructural -------------------------------------
const ACTION_RISK = {
  JavaScript: 'high', Launch: 'high', ImportData: 'high', RichMediaExecute: 'high',
  SubmitForm: 'medium', GoToR: 'medium', GoToE: 'medium', Rendition: 'medium', Sound: 'low', Movie: 'low',
  URI: 'low', Hide: 'low', SetOCGState: 'low',
};

/** Recorre recursivamente los diccionarios DIRECTOS de un objeto. */
function walkDicts(obj, cb, path = []) {
  if (obj instanceof PDFStream) { walkDicts(obj.dict, cb, path); return; }
  if (obj instanceof PDFDict) {
    cb(obj, path);
    for (const [k, v] of obj.entries()) if (!(v instanceof PDFRef)) walkDicts(v, cb, [...path, k.decodeText()]);
  } else if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) { const v = obj.get(i); if (!(v instanceof PDFRef)) walkDicts(v, cb, path); }
  }
}

function streamText(ctx, v) {
  const o = v instanceof PDFRef ? ctx.lookup(v) : v;
  if (o instanceof PDFRawStream) {
    try { return new TextDecoder('latin1').decode(o.dict.get(N('Filter')) ? decodePDFRawStream(o).decode() : o.contents); }
    catch { return '(stream no decodificable)'; }
  }
  return textOf(o);
}

function describeHost(url) {
  const flags = [];
  let u;
  try { u = new URL(url); } catch { return ['URL mal formada']; }
  if (u.protocol === 'http:') flags.push('sin cifrar (http)');
  if (/^(javascript|data|file|vbscript):$/i.test(u.protocol)) flags.push(`esquema peligroso (${u.protocol})`);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) || u.hostname.startsWith('[')) flags.push('IP en lugar de dominio');
  if (u.hostname.split('.').some((p) => p.startsWith('xn--'))) flags.push('dominio punycode (posible homógrafo)');
  if (u.username || u.password) flags.push('credenciales/«@» en la URL');
  if (url.length > 300) flags.push('URL muy larga');
  return flags;
}

/**
 * @param {PDFLib.PDFDocument} doc  documento cargado (descifrado)
 * @param {ReturnType<typeof rawScan>} raw
 * @param {{encryption?: Object|null}} [extra]
 * @returns {{findings: Finding[], level: 'ok'|'low'|'medium'|'high', stats: Object}}
 *
 * @typedef {{id: string, severity: 'high'|'medium'|'low'|'info', title: string, detail: string, items: string[]}} Finding
 */
export function analyze(doc, raw, { encryption = null } = {}) {
  const ctx = doc.context;
  const scripts = [], launches = [], uris = [], others = [], autoActions = [], attachments = [], media = [];
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref.tag, i + 1]));

  const where = (ref, dict) => {
    const type = dict?.get(N('Type'));
    const sub = dict?.get(N('Subtype'));
    if (ref && pageIndex.has(ref.tag)) return `página ${pageIndex.get(ref.tag)}`;
    const t = [type, sub].filter(Boolean).map((x) => x.decodeText?.() ?? String(x)).join('/');
    return `obj ${ref ? ref.toString().replace(' R', '') : '?'}${t ? ` (${t})` : ''}`;
  };

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const top = obj instanceof PDFStream ? obj.dict : obj;
    walkDicts(obj, (d, path) => {
      const loc = where(ref, top) + (path.length ? ` → ${path.join('/')}` : '');
      const s = d.get(N('S'));
      const sName = s instanceof PDFName ? s.decodeText() : null;
      if (sName === 'JavaScript' || (d.has(N('JS')) && !sName)) {
        const code = streamText(ctx, d.get(N('JS'))).replace(/\s+/g, ' ').trim();
        scripts.push(`${loc}: ${code.slice(0, 160)}${code.length > 160 ? '…' : ''}`);
      } else if (sName === 'Launch') {
        const f = d.lookup(N('F')) ?? d.lookup(N('Win'))?.lookup?.(N('F'));
        launches.push(`${loc}: ${f ? (f instanceof PDFDict ? textOf(f.lookup(N('F')) ?? f.lookup(N('UF'))) : textOf(f)) : '(sin destino)'}`);
      } else if (sName === 'URI') {
        const url = textOf(d.lookup(N('URI')));
        uris.push({ url, flags: describeHost(url), loc });
      } else if (sName && ACTION_RISK[sName] && sName !== 'URI') {
        others.push({ type: sName, loc, severity: ACTION_RISK[sName] });
      }
      // Adjuntos
      if (d.get(N('Type')) === N('Filespec') || d.has(N('EF'))) {
        const ef = d.lookup(N('EF'));
        if (ef instanceof PDFDict) {
          const name = textOf(d.lookup(N('UF')) ?? d.lookup(N('F'))) || 'sin nombre';
          const stream = ef.lookup(N('F')) ?? ef.lookup(N('UF'));
          let size = 0;
          if (stream instanceof PDFRawStream) {
            const params = stream.dict.lookup(N('Params'));
            const sz = params instanceof PDFDict ? params.lookup(N('Size')) : null;
            size = sz instanceof PDFNumber ? sz.asNumber() : stream.contents.length;
          }
          const doubleExt = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|txt|zip)\.[a-z0-9]{2,5}$/i.test(name);
          attachments.push({ name, size, risky: RISKY_EXT.test(name) || doubleExt, loc });
        }
      }
      const sub = d.get(N('Subtype'));
      if (sub && ['RichMedia', '3D', 'Screen', 'Movie', 'Sound', 'Flash'].includes(sub.decodeText?.())) media.push(`${loc}: ${sub.decodeText()}`);
      if (d.has(N('AA'))) autoActions.push(`${loc}: acciones adicionales (/AA: ${keysOf(d.lookup(N('AA')))})`);
    });
  }

  const open = doc.catalog.get(N('OpenAction'));
  if (open) {
    const o = open instanceof PDFRef ? ctx.lookup(open) : open;
    const sName = o instanceof PDFDict ? o.get(N('S'))?.decodeText?.() : null;
    if (sName && sName !== 'GoTo') autoActions.unshift(`Al abrir el documento: acción ${sName}`);
  }
  const names = doc.catalog.lookup(N('Names'));
  const jsTree = names instanceof PDFDict ? nameTreeEntries(ctx, names.lookup(N('JavaScript'))) : [];
  const acro = doc.catalog.lookup(N('AcroForm'));
  const xfa = acro instanceof PDFDict && acro.has(N('XFA'));
  const fields = acro instanceof PDFDict ? acro.lookup(N('Fields')) : null;

  // ---- Hallazgos ----
  const F = [];
  const add = (id, severity, title, detail, items = []) => F.push({ id, severity, title, detail, items });
  if (scripts.length || jsTree.length) {
    add('javascript', 'high', `JavaScript (${scripts.length || jsTree.length})`,
      'El documento contiene código JavaScript. Es la vía habitual de los PDFs maliciosos para explotar el visor, redirigir o recopilar datos. Un PDF corriente casi nunca lo necesita.',
      [...jsTree.map(([n]) => `Script a nivel de documento: «${n}»`), ...scripts]);
  }
  if (launches.length) add('launch', 'high', `Acción «Launch» (${launches.length})`, 'Intenta abrir programas o archivos del sistema. Muy sospechoso.', launches);
  const byType = new Map();
  for (const o of others) (byType.get(o.type) || byType.set(o.type, []).get(o.type)).push(o);
  const ACTION_DESC = {
    ImportData: 'Importa datos de un archivo externo.', SubmitForm: 'Envía datos del formulario a un servidor.',
    GoToR: 'Abre otro documento (posible fuga de información o de credenciales NTLM en Windows).', GoToE: 'Abre un documento incrustado.',
    Rendition: 'Reproduce contenido multimedia (puede llevar JavaScript).', RichMediaExecute: 'Ejecuta contenido RichMedia (Flash).',
  };
  for (const [type, list] of byType) {
    if (list[0].severity === 'low') continue;
    add(`action-${type}`, list[0].severity, `Acción ${type} (${list.length})`, ACTION_DESC[type] || '', list.map((o) => o.loc));
  }
  if (attachments.length) {
    const risky = attachments.filter((a) => a.risky);
    add('attachments', risky.length ? 'high' : 'medium', `Archivos adjuntos (${attachments.length})`,
      risky.length ? 'Hay adjuntos con extensiones ejecutables o de doble extensión: no los abras.' : 'El PDF lleva archivos incrustados. Revísalos antes de abrirlos.',
      attachments.map((a) => `${a.risky ? '⚠ ' : ''}${a.name} · ${a.size} bytes`));
  }
  if (autoActions.length) add('auto-actions', 'medium', `Acciones automáticas (${autoActions.length})`, 'Se ejecutan solas al abrir el documento, cambiar de página o interactuar con campos.', autoActions);
  if (media.length) add('media', 'medium', `Contenido multimedia/3D (${media.length})`, 'Flash, 3D o multimedia: históricamente fuente de vulnerabilidades.', media);
  if (xfa) add('xfa', 'medium', 'Formulario XFA', 'Formularios XML dinámicos (obsoletos en PDF 2.0) que pueden incluir scripts.', []);
  const obf = Object.entries(raw.obfuscated);
  if (obf.length) add('obfuscation', 'medium', 'Nombres ofuscados', 'Palabras clave escritas con escapes #xx para evadir antivirus. Indicio claro de manipulación.', obf.map(([k, n]) => `${k}: ${n}`));
  if (raw.headerOffset > 0 || raw.trailingBytes > 0) {
    add('polyglot', 'medium', 'Datos fuera de la estructura PDF',
      'Hay bytes antes de la cabecera %PDF o después del último %%EOF: técnica usada en archivos políglotas o para ocultar contenido.',
      [raw.headerOffset > 0 ? `${raw.headerOffset} bytes antes de la cabecera` : '', raw.trailingBytes > 0 ? `${raw.trailingBytes} bytes tras el último %%EOF` : ''].filter(Boolean));
  }
  const riskyUris = uris.filter((u) => u.flags.length);
  if (uris.length) {
    add('links', riskyUris.length ? 'medium' : 'low', `Enlaces externos (${uris.length})`,
      riskyUris.length ? 'Algunos enlaces tienen rasgos de phishing. Comprueba el dominio antes de pulsar.' : 'Enlaces a sitios web. Comprueba el dominio antes de pulsarlos.',
      uris.map((u) => `${u.url}${u.flags.length ? `  [${u.flags.join(', ')}]` : ''}`));
  }
  for (const [type, list] of byType) if (list[0].severity === 'low') add(`action-${type}`, 'low', `Acción ${type} (${list.length})`, '', list.map((o) => o.loc));
  if (raw.counts['/JBIG2Decode']) add('jbig2', 'low', 'Imágenes JBIG2', 'Formato de compresión implicado en exploits históricos (p. ej. FORCEDENTRY). Normal en escaneos.', []);
  if (raw.eofCount > 1) add('incremental', 'low', `Actualizaciones incrementales (${raw.eofCount - 1})`, 'El archivo se ha modificado después de crearse; las versiones anteriores siguen dentro y pueden contener información borrada.', []);
  if (fields instanceof PDFArray && fields.size()) add('form', 'info', `Formulario (${fields.size()} campos)`, '', []);
  if (encryption) add('encryption', encryption.weak ? 'low' : 'info', `Cifrado ${encryption.algorithm}`, encryption.weak ? 'Algoritmo obsoleto (RC4): no ofrece protección real.' : '', []);
  const infoDict = ctx.trailerInfo.Info ? ctx.lookup(ctx.trailerInfo.Info) : null;
  const info = [['Title', 'Título'], ['Author', 'Autor'], ['Creator', 'Aplicación'], ['Producer', 'Productor']]
    .map(([k, label]) => { const v = infoDict instanceof PDFDict ? infoDict.lookup(N(k)) : null; return v ? `${label}: ${textOf(v)}` : null; }).filter(Boolean);
  if (info.length || doc.catalog.has(N('Metadata'))) add('metadata', 'info', 'Metadatos', 'Pueden revelar autor, software y fechas.', [...info, ...(doc.catalog.has(N('Metadata')) ? ['Bloque XMP presente'] : [])]);

  const order = { high: 0, medium: 1, low: 2, info: 3 };
  F.sort((a, b) => order[a.severity] - order[b.severity]);
  const level = F.some((f) => f.severity === 'high') ? 'high' : F.some((f) => f.severity === 'medium') ? 'medium' : F.some((f) => f.severity === 'low') ? 'low' : 'ok';
  return {
    findings: F,
    level,
    stats: { scripts: scripts.length + jsTree.length, launches: launches.length, uris: uris.length, attachments: attachments.length, autoActions: autoActions.length },
  };
}

function keysOf(d) {
  return d instanceof PDFDict ? d.keys().map((k) => k.decodeText()).join(', ') : '?';
}

// ---- 3) Saneado ----------------------------------------------------
const ACTIVE_ACTIONS = new Set(['JavaScript', 'Launch', 'ImportData', 'SubmitForm', 'GoToR', 'GoToE', 'Rendition', 'RichMediaExecute', 'Sound', 'Movie']);

/**
 * @param {PDFLib.PDFDocument} doc
 * @param {{scripts?: boolean, attachments?: boolean, links?: boolean, xfa?: boolean, media?: boolean}} opts
 * @returns {Record<string, number>} recuento de elementos eliminados
 */
export function sanitize(doc, { scripts = true, attachments = true, links = false, xfa = true, media = true } = {}) {
  const ctx = doc.context;
  const removed = { acciones: 0, adjuntos: 0, enlaces: 0, xfa: 0, multimedia: 0 };
  const isActive = (v) => {
    const a = v instanceof PDFRef ? ctx.lookup(v) : v;
    if (!(a instanceof PDFDict)) return false;
    const s = a.get(N('S'))?.decodeText?.();
    return ACTIVE_ACTIONS.has(s) || (!s && a.has(N('JS')));
  };
  const isUri = (v) => {
    const a = v instanceof PDFRef ? ctx.lookup(v) : v;
    return a instanceof PDFDict && a.get(N('S')) === N('URI');
  };

  if (scripts) {
    const names = doc.catalog.lookup(N('Names'));
    if (names instanceof PDFDict && names.has(N('JavaScript'))) { names.delete(N('JavaScript')); removed.acciones++; }
    const open = doc.catalog.get(N('OpenAction'));
    if (open && (isActive(open) || isUri(open))) { doc.catalog.delete(N('OpenAction')); removed.acciones++; }
  }
  if (attachments) {
    const names = doc.catalog.lookup(N('Names'));
    if (names instanceof PDFDict && names.has(N('EmbeddedFiles'))) { names.delete(N('EmbeddedFiles')); removed.adjuntos++; }
    doc.catalog.delete(N('AF'));
  }
  if (xfa) {
    const acro = doc.catalog.lookup(N('AcroForm'));
    if (acro instanceof PDFDict && acro.has(N('XFA'))) { acro.delete(N('XFA')); removed.xfa++; }
    doc.catalog.delete(N('NeedsRendering'));
  }

  const dropSubtypes = new Set([
    ...(attachments ? ['FileAttachment'] : []),
    ...(media ? ['RichMedia', '3D', 'Screen', 'Movie', 'Sound'] : []),
  ]);

  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    walkDicts(obj, (d) => {
      if (scripts) {
        if (d.has(N('AA'))) { d.delete(N('AA')); removed.acciones++; }
        for (const key of ['A', 'Next', 'OpenAction']) {
          const v = d.get(N(key));
          if (v && isActive(v)) { d.delete(N(key)); removed.acciones++; }
        }
        // Acciones encadenadas en arrays (/Next [ … ])
        const next = d.get(N('Next'));
        if (next instanceof PDFArray) {
          for (let i = next.size() - 1; i >= 0; i--) if (isActive(next.get(i))) { next.remove(i); removed.acciones++; }
        }
      }
      if (links) {
        const a = d.get(N('A'));
        if (a && isUri(a)) { d.delete(N('A')); removed.enlaces++; }
      }
      // Anotaciones a eliminar de las páginas
      const annots = d.get(N('Annots')) instanceof PDFArray ? d.get(N('Annots')) : d.lookup(N('Annots'));
      if (annots instanceof PDFArray && dropSubtypes.size) {
        for (let i = annots.size() - 1; i >= 0; i--) {
          const an = annots.lookup(i);
          const sub = an instanceof PDFDict ? an.get(N('Subtype'))?.decodeText?.() : null;
          if (sub && dropSubtypes.has(sub)) {
            annots.remove(i);
            if (sub === 'FileAttachment') removed.adjuntos++; else removed.multimedia++;
          }
        }
      }
    });
  }
  removeUnreachable(doc);
  return removed;
}
