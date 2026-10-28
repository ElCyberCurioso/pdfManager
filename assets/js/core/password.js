/* ============================================================
   PASSWORD — Estimación de fortaleza y generación de claves.
   Módulo puro (sin DOM), probado con node --test.
   ============================================================ */

const COMMON = [
  '123456', '12345678', '123456789', 'password', 'contraseña', 'contrasena', 'qwerty', 'abc123',
  '111111', '000000', 'iloveyou', 'admin', 'letmein', 'welcome', 'monkey', 'dragon', 'football',
  'secreto', 'hola', 'holahola', 'teamo', 'barcelona', 'madrid', 'realmadrid', 'españa', 'espana',
  '1234', 'pass', 'test', 'prueba', 'usuario', 'root', 'toor', 'master', 'shadow', 'sunshine',
];

/**
 * Fortaleza aproximada de una contraseña.
 * @param {string} pw
 * @returns {{level: 0|1|2|3|4, label: string, bits: number}}
 */
export function passwordStrength(pw) {
  const s = String(pw || '');
  if (!s) return { level: 0, label: 'Vacía', bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(s)) pool += 26;
  if (/[A-Z]/.test(s)) pool += 26;
  if (/[0-9]/.test(s)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(s)) pool += 33;
  let bits = s.length * Math.log2(Math.max(pool, 2));

  // Penalizaciones: repeticiones, secuencias y palabras comunes
  const lower = s.toLowerCase();
  if (/^(.)\1+$/.test(s)) bits = Math.min(bits, 4);
  if (/(.)\1{2,}/.test(s)) bits *= 0.75;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf|zxcv)/.test(lower)) bits *= 0.7;
  if (COMMON.some((w) => lower.includes(w))) bits *= 0.5;
  if (COMMON.includes(lower)) bits = Math.min(bits, 8);

  const level = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  const label = ['Muy débil', 'Débil', 'Aceptable', 'Fuerte', 'Muy fuerte'][level];
  return { level, label, bits: Math.round(bits) };
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.!@#%+=';

/**
 * Contraseña aleatoria criptográficamente segura (sin sesgo de módulo).
 * @param {number} length
 */
export function randomPassword(length = 24, alphabet = ALPHABET) {
  const out = [];
  const limit = 256 - (256 % alphabet.length);
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit) out.push(alphabet[b % alphabet.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}
