import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeReturnUrl } from '../src/utils/sanitizeReturnUrl.mjs';

const ORIGIN = 'https://app.example.com';

test('sanitizeReturnUrl allows same-origin relative paths', () => {
  assert.equal(sanitizeReturnUrl('/admin', ORIGIN), '/admin');
});

test('sanitizeReturnUrl preserves encoded path segments, query, and hash', () => {
  assert.equal(
    sanitizeReturnUrl('/users/Sam%20McClure?x=1#y', ORIGIN),
    '/users/Sam%20McClure?x=1#y',
  );
});

test('sanitizeReturnUrl rejects protocol-relative URLs', () => {
  // //evil.com resolves to a different origin after URL parsing
  assert.equal(sanitizeReturnUrl('//evil.com', ORIGIN), '/');
});

test('sanitizeReturnUrl rejects backslash-trick paths', () => {
  assert.equal(sanitizeReturnUrl('/\\evil.com', ORIGIN), '/');
});

test('sanitizeReturnUrl rejects cross-origin absolute URLs', () => {
  assert.equal(sanitizeReturnUrl('https://evil.com/x', ORIGIN), '/');
});

test('sanitizeReturnUrl rejects non-http(s) schemes', () => {
  assert.equal(sanitizeReturnUrl('javascript:alert(1)', ORIGIN), '/');
});

test('sanitizeReturnUrl reduces same-origin absolute URLs to path', () => {
  assert.equal(sanitizeReturnUrl('https://app.example.com/admin', ORIGIN), '/admin');
});

test('sanitizeReturnUrl rejects leading-backslash paths', () => {
  assert.equal(sanitizeReturnUrl('\\/evil', ORIGIN), '/');
});

test('sanitizeReturnUrl defaults empty string to root', () => {
  assert.equal(sanitizeReturnUrl('', ORIGIN), '/');
});

test('sanitizeReturnUrl defaults whitespace-only input to root', () => {
  assert.equal(sanitizeReturnUrl('   ', ORIGIN), '/');
});

test('sanitizeReturnUrl catches malformed URLs that throw during parsing', () => {
  // Unclosed IPv6 bracket makes new URL throw
  assert.equal(sanitizeReturnUrl('http://[::1', ORIGIN), '/');
});
