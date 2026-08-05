import { randomBytes } from 'node:crypto';

export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = BigInt(ALPHABET.length);

/** Encode a non-negative integer (Number or BigInt) as base62. */
export function encode(num) {
  let n = BigInt(num);
  if (n < 0n) throw new RangeError('base62.encode expects a non-negative integer');
  if (n === 0n) return ALPHABET[0];
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % BASE)] + out;
    n /= BASE;
  }
  return out;
}

/** Decode a base62 string back to a BigInt. */
export function decode(str) {
  let n = 0n;
  for (const ch of str) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new RangeError(`Invalid base62 character: ${ch}`);
    n = n * BASE + BigInt(idx);
  }
  return n;
}

/**
 * Cryptographically random base62 string of the given length.
 *
 * Random-then-check beats hashing the URL (hash collisions still need a probe,
 * and identical URLs from different users would share a code and therefore
 * share analytics) and beats a global counter (a counter is guessable and
 * makes every write contend on one sequence).
 */
export function randomCode(length) {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError('randomCode expects a positive integer length');
  }
  // Rejection sampling: 256 % 62 !== 0, so bytes >= 248 would bias the low
  // characters of the alphabet. Draw extra bytes and discard the biased tail.
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}
