import test from 'node:test';
import assert from 'node:assert/strict';
import { ALPHABET, decode, encode, randomCode } from '../src/lib/base62.js';

test('encode/decode round-trips', () => {
  for (const n of [0n, 1n, 61n, 62n, 3843n, 123456789n, 3521614606207n]) {
    assert.equal(decode(encode(n)), n);
  }
});

test('encode uses the base62 alphabet only', () => {
  const encoded = encode(9876543210n);
  for (const ch of encoded) assert.ok(ALPHABET.includes(ch), `unexpected char ${ch}`);
});

test('encode rejects negative input', () => {
  assert.throws(() => encode(-1), RangeError);
});

test('decode rejects out-of-alphabet characters', () => {
  assert.throws(() => decode('abc$'), RangeError);
});

test('randomCode returns the requested length from the alphabet', () => {
  for (const len of [1, 7, 22]) {
    const code = randomCode(len);
    assert.equal(code.length, len);
    for (const ch of code) assert.ok(ALPHABET.includes(ch));
  }
});

test('randomCode is not obviously biased or repeating', () => {
  const codes = new Set(Array.from({ length: 2000 }, () => randomCode(7)));
  assert.equal(codes.size, 2000, 'expected 2000 distinct codes from a 3.5e12 space');
});

test('randomCode rejects invalid lengths', () => {
  assert.throws(() => randomCode(0), RangeError);
  assert.throws(() => randomCode(1.5), RangeError);
});
