/* ============================================================
   HANDOFF — Pasa el resultado de una herramienta a otra sin
   descargarlo y volverlo a subir. Se guarda temporalmente en
   IndexedDB (local, mismo origen) y se borra al leerlo.
   ============================================================ */

const DB_NAME = 'pdfmanager';
const STORE = 'handoff';
const KEY = 'pending';
const MAX_AGE_MS = 10 * 60 * 1000; // caduca a los 10 minutos

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

/** Guarda archivos para la siguiente herramienta. */
export async function putHandoff(files) {
  const payload = {
    ts: Date.now(),
    files: files.map(({ name, bytes, type }) => ({ name, type: type || 'application/pdf', bytes })),
  };
  await tx('readwrite', (s) => s.put(payload, KEY));
}

/** Recupera y elimina los archivos pendientes. Devuelve File[] (o []). */
export async function takeHandoff() {
  try {
    const payload = await tx('readonly', (s) => s.get(KEY));
    await tx('readwrite', (s) => s.delete(KEY));
    if (!payload || Date.now() - payload.ts > MAX_AGE_MS) return [];
    return payload.files.map((f) => new File([f.bytes], f.name, { type: f.type }));
  } catch {
    return [];
  }
}
