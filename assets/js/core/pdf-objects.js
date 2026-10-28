/* ============================================================
   PDF OBJECTS — Operaciones de bajo nivel sobre el grafo de
   objetos de pdf-lib:
   - recorrido de objetos alcanzables y borrado de huérfanos
     (pdf-lib escribe TODO lo que hay en el contexto, aunque nada
     lo referencie: sin esto, el contenido "eliminado" seguiría
     dentro del archivo),
   - deduplicación de streams idénticos,
   - marcadores (outline) y utilidades de lectura.
   ============================================================ */
import { PDFLib } from './libs.js';

const {
  PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFRawStream,
  PDFString, PDFHexString, PDFNumber,
} = PDFLib;

export const N = (s) => PDFName.of(s);

/** Valor "de texto" de un PDFString/PDFHexString/PDFName. */
export function textOf(obj) {
  if (!obj) return '';
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  if (obj instanceof PDFName) return obj.decodeText();
  if (obj instanceof PDFNumber) return String(obj.asNumber());
  return String(obj);
}

/** Recorre recursivamente un objeto llamando a visit(ref) por cada referencia. */
function walk(obj, visit) {
  if (obj instanceof PDFRef) { visit(obj); return; }
  if (obj instanceof PDFDict) { for (const [, v] of obj.entries()) walk(v, visit); return; }
  if (obj instanceof PDFArray) { for (let i = 0; i < obj.size(); i++) walk(obj.get(i), visit); return; }
  if (obj instanceof PDFStream) walk(obj.dict, visit);
}

/** Conjunto de refs alcanzables desde el trailer (Root, Info). */
export function reachableRefs(doc) {
  const ctx = doc.context;
  const seen = new Set();
  const stack = [];
  const push = (ref) => {
    const key = ref.tag;
    if (seen.has(key)) return;
    seen.add(key);
    stack.push(ref);
  };
  const { Root, Info } = ctx.trailerInfo;
  if (Root instanceof PDFRef) push(Root);
  if (Info instanceof PDFRef) push(Info);
  while (stack.length) {
    const ref = stack.pop();
    const obj = ctx.lookup(ref);
    if (obj) walk(obj, push);
  }
  return seen;
}

/**
 * Elimina los objetos que no son alcanzables desde el catálogo.
 * @returns {number} objetos eliminados
 */
export function removeUnreachable(doc) {
  const keep = reachableRefs(doc);
  let removed = 0;
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!keep.has(ref.tag)) { doc.context.delete(ref); removed++; }
  }
  return removed;
}

/** Sustituye en todo el documento las refs indicadas (map tag → PDFRef). */
function remapRefs(doc, map) {
  const fix = (obj) => {
    if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) {
        if (v instanceof PDFRef && map.has(v.tag)) obj.set(k, map.get(v.tag));
        else fix(v);
      }
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const v = obj.get(i);
        if (v instanceof PDFRef && map.has(v.tag)) obj.set(i, map.get(v.tag));
        else fix(v);
      }
    } else if (obj instanceof PDFStream) {
      fix(obj.dict);
    }
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) fix(obj);
  const t = doc.context.trailerInfo;
  for (const k of ['Root', 'Info']) if (t[k] instanceof PDFRef && map.has(t[k].tag)) t[k] = map.get(t[k].tag);
}

/** Hash rápido (FNV-1a de 32 bits) para agrupar candidatos. */
function fnv1a(bytes, seed = 0x811c9dc5) {
  let h = seed;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Fusiona streams idénticos (mismo diccionario y mismos bytes), algo
 * habitual tras unir documentos que repiten logos o fuentes.
 * @returns {number} streams eliminados
 */
export function dedupeStreams(doc) {
  const buckets = new Map();
  const map = new Map();
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const contents = obj.contents;
    if (contents.length < 64) continue; // no merece la pena
    const dictStr = obj.dict.toString();
    const key = `${fnv1a(contents)}:${contents.length}:${fnv1a(new TextEncoder().encode(dictStr))}`;
    const list = buckets.get(key);
    if (!list) { buckets.set(key, [{ ref, obj, dictStr }]); continue; }
    const match = list.find((c) => c.dictStr === dictStr && sameBytes(c.obj.contents, contents));
    if (match) map.set(ref.tag, match.ref);
    else list.push({ ref, obj, dictStr });
  }
  if (!map.size) return 0;
  remapRefs(doc, map);
  for (const [tag] of map) {
    const [num, gen] = tag.split(' ').map(Number);
    doc.context.delete(PDFRef.of(num, gen));
  }
  return map.size;
}

/**
 * Crea marcadores de primer nivel.
 * @param {PDFLib.PDFDocument} doc
 * @param {{title: string, pageIndex: number}[]} items
 */
export function setOutline(doc, items) {
  if (!items.length) return;
  const ctx = doc.context;
  const pages = doc.getPages();
  const outlinesRef = ctx.nextRef();
  const refs = items.map(() => ctx.nextRef());
  items.forEach((it, i) => {
    const page = pages[Math.min(Math.max(0, it.pageIndex), pages.length - 1)];
    const entry = {
      Title: PDFHexString.fromText(it.title),
      Parent: outlinesRef,
      Dest: ctx.obj([page.ref, N('Fit')]),
    };
    if (i > 0) entry.Prev = refs[i - 1];
    if (i < refs.length - 1) entry.Next = refs[i + 1];
    ctx.assign(refs[i], ctx.obj(entry));
  });
  ctx.assign(outlinesRef, ctx.obj({
    Type: 'Outlines',
    First: refs[0],
    Last: refs[refs.length - 1],
    Count: refs.length,
  }));
  doc.catalog.set(N('Outlines'), outlinesRef);
  doc.catalog.set(N('PageMode'), N('UseOutlines'));
}

/** Busca un valor heredable de una página (Resources, Rotate, MediaBox…). */
export function inheritedValue(pageNode, key) {
  let node = pageNode;
  for (let guard = 0; node && guard < 64; guard++) {
    const v = node.get(N(key));
    if (v !== undefined) return v;
    node = node.lookup(N('Parent'));
  }
  return undefined;
}

/**
 * Lee los marcadores (outline) del documento.
 * @param {PDFLib.PDFDocument} doc
 * @param {number} [maxDepth] profundidad máxima (0 = solo primer nivel)
 * @returns {{title: string, pageIndex: number, depth: number}[]}
 *   pageIndex es -1 si el destino no se puede resolver.
 */
export function readOutline(doc, maxDepth = 0) {
  const ctx = doc.context;
  const pageIndexByTag = new Map(doc.getPages().map((p, i) => [p.ref.tag, i]));
  const outlines = doc.catalog.lookup(N('Outlines'));
  if (!(outlines instanceof PDFDict)) return [];

  const resolveDest = (dest) => {
    let d = dest instanceof PDFRef ? ctx.lookup(dest) : dest;
    if (d instanceof PDFString || d instanceof PDFHexString || d instanceof PDFName) d = lookupNamedDest(doc, textOf(d));
    if (d instanceof PDFDict) d = d.lookup(N('D')); // {D: [...]}
    if (d instanceof PDFRef) d = ctx.lookup(d);
    if (d instanceof PDFArray && d.size() > 0) {
      const first = d.get(0);
      if (first instanceof PDFRef) return pageIndexByTag.get(first.tag) ?? -1;
      if (first instanceof PDFNumber) return first.asNumber(); // destino remoto o por índice
    }
    return -1;
  };

  const out = [];
  const seen = new Set();
  const visit = (itemRef, depth) => {
    let ref = itemRef;
    for (let guard = 0; ref instanceof PDFRef && !seen.has(ref.tag) && guard < 10000; guard++) {
      seen.add(ref.tag);
      const item = ctx.lookup(ref);
      if (!(item instanceof PDFDict)) break;
      let pageIndex = -1;
      const dest = item.get(N('Dest'));
      if (dest) pageIndex = resolveDest(dest);
      else {
        const action = item.lookup(N('A'));
        if (action instanceof PDFDict && action.get(N('S')) === N('GoTo')) pageIndex = resolveDest(action.get(N('D')));
      }
      out.push({ title: textOf(item.lookup(N('Title'))).trim() || 'Sin título', pageIndex, depth });
      if (depth < maxDepth) visit(item.get(N('First')), depth + 1);
      ref = item.get(N('Next'));
    }
  };
  visit(outlines.get(N('First')), 0);
  return out;
}

/** Busca un destino con nombre (árbol /Names /Dests o diccionario /Dests). */
function lookupNamedDest(doc, name) {
  const ctx = doc.context;
  const names = doc.catalog.lookup(N('Names'));
  if (names instanceof PDFDict) {
    const tree = names.lookup(N('Dests'));
    if (tree instanceof PDFDict) {
      const found = searchNameTree(ctx, tree, name, 0);
      if (found) return found;
    }
  }
  const dests = doc.catalog.lookup(N('Dests'));
  if (dests instanceof PDFDict) return dests.lookup(N(name));
  return undefined;
}

function searchNameTree(ctx, node, name, depth) {
  if (depth > 32) return undefined;
  const names = node.lookup(N('Names'));
  if (names instanceof PDFArray) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      if (textOf(names.lookup(i)) === name) return names.lookup(i + 1);
    }
  }
  const kids = node.lookup(N('Kids'));
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict) {
        const r = searchNameTree(ctx, kid, name, depth + 1);
        if (r) return r;
      }
    }
  }
  return undefined;
}

/** Recorre un árbol de nombres devolviendo [nombre, valor] (valor sin resolver). */
export function nameTreeEntries(ctx, node, out = [], depth = 0) {
  if (!(node instanceof PDFDict) || depth > 32) return out;
  const names = node.lookup(N('Names'));
  if (names instanceof PDFArray) {
    for (let i = 0; i + 1 < names.size(); i += 2) out.push([textOf(names.lookup(i)), names.get(i + 1)]);
  }
  const kids = node.lookup(N('Kids'));
  if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) nameTreeEntries(ctx, kids.lookup(i), out, depth + 1);
  return out;
}
