import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordStrength, randomPassword } from '../../assets/js/core/password.js';

test('fortaleza: comunes y cortas son débiles; largas y variadas, fuertes', () => {
  assert.equal(passwordStrength('').level, 0);
  assert.equal(passwordStrength('123456').level, 0);
  assert.equal(passwordStrength('password').level, 0);
  assert.equal(passwordStrength('aaaaaaaaaaaaaaaa').level, 0);
  assert.ok(passwordStrength('Mi-Clave-2024!').level >= 3);
  assert.equal(passwordStrength('t7#Kq9!vLm2@xR4$wZ8p').level, 4);
});

test('randomPassword: longitud, alfabeto y sin repetirse', () => {
  const a = randomPassword(24);
  const b = randomPassword(24);
  assert.equal(a.length, 24);
  assert.notEqual(a, b);
  assert.match(randomPassword(40, 'ab'), /^[ab]{40}$/);
});
