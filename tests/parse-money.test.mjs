import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney } from '../src/utils/parseMoney.mjs';

test('parseMoney strips currency formatting from sheet strings', () => {
  assert.equal(parseMoney('$1,234.50'), 1234.5);
});

test('parseMoney strips thousands separators', () => {
  assert.equal(parseMoney('1,000'), 1000);
});

test('parseMoney parses plain numeric strings', () => {
  assert.equal(parseMoney('1234.5'), 1234.5);
});

test('parseMoney passes through finite numbers', () => {
  assert.equal(parseMoney(1234.5), 1234.5);
  assert.equal(parseMoney(0), 0);
});

test('parseMoney returns 0 for empty or missing values', () => {
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney(null), 0);
  assert.equal(parseMoney(undefined), 0);
});

test('parseMoney returns 0 for non-numeric strings', () => {
  assert.equal(parseMoney('abc'), 0);
});

test('parseMoney handles negative currency amounts', () => {
  assert.equal(parseMoney('$-500.25'), -500.25);
});

test('parseMoney tolerates leading whitespace', () => {
  assert.equal(parseMoney(' $1,000 '), 1000);
});
