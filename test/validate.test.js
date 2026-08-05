import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidCodeShape, normalizeUrl, parseExpiresAt, validateCustomCode } from '../src/lib/validate.js';
import { classifyUserAgent, normalizeReferrer } from '../src/lib/userAgent.js';

test('normalizeUrl accepts http(s) URLs', () => {
  assert.equal(normalizeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(normalizeUrl('  http://example.com  '), 'http://example.com/');
});

test('normalizeUrl rejects dangerous or relative URLs', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'ftp://example.com', '/relative', 'not a url', '', 'http://localhost']) {
    assert.throws(() => normalizeUrl(bad), /url/i, `expected rejection for ${bad}`);
  }
});

test('normalizeUrl rejects overly long input', () => {
  assert.throws(() => normalizeUrl(`https://example.com/${'x'.repeat(2100)}`), /2048/);
});

test('validateCustomCode enforces shape and reserved words', () => {
  assert.equal(validateCustomCode('my-link_1'), 'my-link_1');
  assert.throws(() => validateCustomCode('ab'), /3-32/);
  assert.throws(() => validateCustomCode('has space'), /3-32/);
  assert.throws(() => validateCustomCode('api'), /reserved/);
});

test('parseExpiresAt requires a future ISO timestamp', () => {
  assert.equal(parseExpiresAt(null), null);
  assert.throws(() => parseExpiresAt('2001-01-01T00:00:00Z'), /future/);
  assert.throws(() => parseExpiresAt('tomorrow-ish'), /ISO-8601/);
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(parseExpiresAt(future).toISOString(), future);
});

test('isValidCodeShape screens junk before a DB lookup', () => {
  assert.ok(isValidCodeShape('aB3xY9z'));
  assert.ok(!isValidCodeShape('../etc/passwd'));
  assert.ok(!isValidCodeShape('x'.repeat(40)));
});

test('classifyUserAgent buckets the common cases', () => {
  assert.deepEqual(
    classifyUserAgent('Mozilla/5.0 (iPhone) AppleWebKit Version/17.0 Mobile/15E Safari/604.1'),
    { device: 'mobile', browser: 'safari' },
  );
  assert.equal(classifyUserAgent('curl/8.4.0').device, 'bot');
  assert.equal(classifyUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537').browser, 'chrome');
  assert.equal(classifyUserAgent('').device, 'desktop');
});

test('normalizeReferrer keeps only the origin', () => {
  assert.equal(normalizeReferrer('https://news.site/a/b?utm=1'), 'https://news.site');
  assert.equal(normalizeReferrer('garbage'), null);
  assert.equal(normalizeReferrer(undefined), null);
});
