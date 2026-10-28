import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRanges, parsePageList, formatPageList, chunkPages, PageRangeError } from '../../assets/js/core/ranges.js';

test('parseRanges: rangos abiertos, cerrados y sueltos', () => {
  assert.deepEqual(parseRanges('1-3, 5, 8-', 10), [[0, 1, 2], [4], [7, 8, 9]]);
  assert.deepEqual(parseRanges('-2; 4–5', 6), [[0, 1], [3, 4]]);
  assert.deepEqual(parseRanges(' 2 - 3 ', 3), [[1, 2]]);
});

test('parseRanges: errores claros', () => {
  assert.throws(() => parseRanges('', 5), PageRangeError);
  assert.throws(() => parseRanges('0', 5), /empiezan en 1/);
  assert.throws(() => parseRanges('4-2', 5), /mayor que el final/);
  assert.throws(() => parseRanges('7', 5), /se sale del documento/);
  assert.throws(() => parseRanges('a-b', 5), /no es un rango válido/);
  assert.throws(() => parseRanges('1', 0), PageRangeError);
});

test('parsePageList: palabras clave, orden y duplicados', () => {
  assert.deepEqual(parsePageList('pares', 5), [1, 3]);
  assert.deepEqual(parsePageList('impares', 5), [0, 2, 4]);
  assert.deepEqual(parsePageList('todas', 3), [0, 1, 2]);
  assert.deepEqual(parsePageList('5, 1-2, 2', 5), [0, 1, 4]);
});

test('formatPageList compacta tramos', () => {
  assert.equal(formatPageList([0, 1, 2, 4, 7, 8]), '1-3, 5, 8-9');
  assert.equal(formatPageList([3, 1, 1]), '2, 4');
  assert.equal(formatPageList([]), '');
});

test('chunkPages', () => {
  assert.deepEqual(chunkPages(7, 3), [[0, 1, 2], [3, 4, 5], [6]]);
  assert.throws(() => chunkPages(5, 0), PageRangeError);
});
