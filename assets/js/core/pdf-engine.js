/* ============================================================
   PDF ENGINE — Carga/guardado con pdf-lib (@cantoo/pdf-lib).
   Gestiona de forma centralizada los PDFs cifrados: si el
   archivo tiene contraseña de apertura se la pide al usuario,
   y si solo tiene restricciones de propietario las retira.
   ============================================================ */
import { PDFLib } from './libs.js';
import { promptDialog } from './ui.js';
import { removeUnreachable } from './pdf-objects.js';

const { PDFDocument, PDFName, PDFNumber, PDFDict, PDFRawStream } = PDFLib;

export const APP_NAME = 'PDF Manager';

/** Lee un File/Blob como Uint8Array. */
export async function readFile(file) {
  return new Uint8Array(await file.arrayBuffer());
}

/** ¿Los bytes parecen un PDF? (cabecera %PDF- en el primer KB, como hacen los lectores) */
export function looksLikePdf(bytes) {
  const n = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= n; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 &&
        bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
  }
  return false;
}

export class PasswordCancelledError extends Error {
  constructor() { super('Se canceló la introducción de la contraseña.'); this.name = 'PasswordCancelledError'; }
}

const isEncryptedError = (err) =>
  err instanceof PDFLib.EncryptedPDFError || /encrypted/i.test(err?.message || '');
const isWrongPasswordError = (err) => /password/i.test(err?.message || '');

/**
 * Describe el cifrado de un documento cargado con ignoreEncryption.
 * @returns {null | {algorithm: string, revision: number, keyBits: number, permissions: Object}}
 */
export function describeEncryption(doc) {
  const ref = doc.context.trailerInfo.Encrypt;
  if (!ref) return null;
  const dict = doc.context.lookup(ref);
  if (!(dict instanceof PDFDict)) return null;
  const num = (k) => {
    const v = dict.get(PDFName.of(k));
    return v instanceof PDFNumber ? v.asNumber() : undefined;
  };
  const V = num('V') ?? 0;
  const R = num('R') ?? 0;
  const P = num('P') ?? -1;
  let cfm = '';
  const cf = dict.lookup(PDFName.of('CF'));
  if (cf instanceof PDFDict) {
    const std = cf.lookup(PDFName.of('StdCF'));
    if (std instanceof PDFDict) cfm = String(std.get(PDFName.of('CFM')) || '');
  }
  let algorithm = 'Desconocido';
  let keyBits = num('Length') ?? 40;
  if (R >= 6 || cfm === '/AESV3') { algorithm = 'AES-256'; keyBits = 256; }
  else if (cfm === '/AESV2')      { algorithm = 'AES-128'; keyBits = 128; }
  else if (V === 1)               { algorithm = 'RC4-40';  keyBits = 40; }
  else if (V === 2 || V === 4)    { algorithm = `RC4-${keyBits}`; }

  // Bits de permisos (ISO 32000-1, tabla 22). Se interpretan como uint32.
  const p = P >>> 0;
  const bit = (n) => (p & (1 << (n - 1))) !== 0;
  const permissions = {
    printing:      bit(3) ? (R >= 3 && !bit(12) ? 'baja resolución' : 'sí') : 'no',
    modifying:     bit(4),
    copying:       bit(5),
    annotating:    bit(6),
    fillingForms:  R >= 3 ? bit(9) : bit(6),
    accessibility: R >= 3 ? bit(10) : bit(5),
    assembly:      R >= 3 ? bit(11) : bit(4),
  };
  return { algorithm, revision: R, keyBits, weak: algorithm.startsWith('RC4'), permissions };
}

/**
 * Abre un PDF con pdf-lib. Si está cifrado pide la contraseña.
 *
 * @param {Uint8Array} bytes
 * @param {{fileName?: string, askPassword?: boolean, password?: string}} [opts]
 * @returns {Promise<{doc: PDFDocument, bytes: Uint8Array, encryption: null|Object,
 *                    needsUserPassword: boolean, password: string|null}>}
 *   `bytes` son los bytes YA DESCIFRADOS cuando el original estaba cifrado,
 *   para poder pasarlos a PDF.js o volver a cargarlos sin contraseña.
 */
export async function openPdf(bytes, { fileName = 'el documento', askPassword = true, password } = {}) {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    purgeStructuralStreams(doc);
    return { doc, bytes, encryption: null, needsUserPassword: false, password: null };
  } catch (err) {
    if (!isEncryptedError(err)) throw friendlyLoadError(err);
  }

  // Está cifrado: averiguamos el algoritmo para informar al usuario.
  let encryption = null;
  try {
    encryption = describeEncryption(await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }));
  } catch { /* informativo */ }

  // 1) Contraseña vacía: PDFs con solo restricciones de propietario.
  // 2) Contraseña proporcionada por el llamador (si la hay).
  // 3) Pedirla al usuario en bucle hasta acertar o cancelar.
  const candidates = [''];
  if (password) candidates.push(password);
  for (const pw of candidates) {
    try {
      const doc = await PDFDocument.load(bytes, { password: pw, updateMetadata: false });
      return { doc, bytes: await saveDecrypted(doc), encryption, needsUserPassword: pw !== '', password: pw };
    } catch (err) {
      if (!isWrongPasswordError(err) && !isEncryptedError(err)) throw friendlyLoadError(err);
    }
  }
  if (!askPassword) throw new Error('El PDF está protegido con contraseña.');

  let error = '';
  for (;;) {
    const pw = await promptDialog({
      title: 'PDF protegido',
      message: `«${fileName}» está protegido${encryption ? ` (${encryption.algorithm})` : ''}. Introduce la contraseña para abrirlo. Se descifra solo en tu navegador.`,
      label: 'Contraseña',
      type: 'password',
      confirmText: 'Abrir',
      autocomplete: 'current-password',
      error,
    });
    if (pw === null) throw new PasswordCancelledError();
    try {
      const doc = await PDFDocument.load(bytes, { password: pw, updateMetadata: false });
      return { doc, bytes: await saveDecrypted(doc), encryption, needsUserPassword: true, password: pw };
    } catch (err) {
      if (!isWrongPasswordError(err) && !isEncryptedError(err)) throw friendlyLoadError(err);
      error = 'Contraseña incorrecta. Inténtalo de nuevo.';
    }
  }
}

function friendlyLoadError(err) {
  const msg = err?.message || String(err);
  if (/No PDF header|Failed to parse PDF/i.test(msg)) return new Error('El archivo no es un PDF válido o está dañado.');
  if (/Invalid object ref|corrupt/i.test(msg))     return new Error('El PDF está dañado y no se puede procesar.');
  return err instanceof Error ? err : new Error(msg);
}

/**
 * La pdf-lib conserva en el contexto los streams estructurales del archivo
 * original (XRef y ObjStm) aunque ya haya extraído su contenido. Si se
 * reescriben, el PDF de salida arrastra datos obsoletos: en un PDF
 * descifrado, el antiguo stream XRef conserva /Encrypt y el resultado se
 * vuelve a detectar como cifrado (y corrupto). Los eliminamos al cargar.
 */
export function purgeStructuralStreams(doc) {
  let removed = 0;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const type = obj.dict.get(PDFName.of('Type'));
    if (type === PDFName.of('XRef') || type === PDFName.of('ObjStm')) {
      doc.context.delete(ref);
      removed++;
    }
  }
  return removed;
}

/** Guarda un documento recién descifrado sin restos del cifrado original. */
async function saveDecrypted(doc) {
  purgeStructuralStreams(doc);
  removeUnreachable(doc); // el diccionario /Encrypt queda huérfano
  return doc.save({ useObjectStreams: true });
}

/** Recarga unos bytes (ya descifrados) en un nuevo PDFDocument. */
export async function loadPlain(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  purgeStructuralStreams(doc);
  return doc;
}

/** Crea un documento vacío marcado como generado por esta app. */
export async function createPdf() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer(APP_NAME);
  doc.setCreator(APP_NAME);
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());
  return doc;
}

/** Guarda con opciones por defecto razonables. */
export async function savePdf(doc, options = {}) {
  return doc.save({ useObjectStreams: true, ...options });
}
