import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unpredictPng } from '../../assets/js/core/optimize.js';

// Codifica filas con un filtro PNG dado (para probar la inversa).
function encode(rows, bpp, type) {
  const out = [];
  let prev = new Uint8Array(rows[0].length);
  for (const row of rows) {
    out.push(type);
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let pred = 0;
      if (type === 1) pred = a;
      else if (type === 2) pred = b;
      else if (type === 3) pred = (a + b) >> 1;
      else if (type === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out.push((row[i] - pred) & 0xff);
    }
    prev = row;
  }
  return new Uint8Array(out);
}

test('unpredictPng invierte los 5 filtros PNG', () => {
  const w = 5, comps = 3;
  const rows = Array.from({ length: 4 }, (_, r) => Uint8Array.from({ length: w * comps }, (_, i) => (r * 37 + i * 11) % 256));
  const flat = new Uint8Array(rows.flatMap((r) => [...r]));
  for (let type = 0; type <= 4; type++) {
    assert.deepEqual(unpredictPng(encode(rows, comps, type), comps, w), flat, `filtro ${type}`);
  }
});
