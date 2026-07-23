import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv } from '../src/utils/buildCsv.mjs';

test('header row comes first', () => {
  const csv = buildCsv(['Name', 'Hours'], [['Alice', 3]]);
  assert.equal(csv.split('\n')[0], '"Name","Hours"');
});

test('row count is headers + rows exactly', () => {
  const csv = buildCsv(['a', 'b'], [['1', '2'], ['3', '4'], ['5', '6']]);
  assert.equal(csv.split('\n').length, 4);
});

test('empty rows array yields only the header row', () => {
  assert.equal(buildCsv(['a', 'b'], []), '"a","b"');
});

test('a comma inside a value stays one column', () => {
  const csv = buildCsv(['client'], [['Acme, Inc.']]);
  assert.equal(csv, '"client"\n"Acme, Inc."');
});

test('embedded quotes are doubled', () => {
  const csv = buildCsv(['v'], [['a"b']]);
  assert.equal(csv.split('\n')[1], '"a""b"');
});

test('embedded newline stays inside one quoted field', () => {
  const csv = buildCsv(['note'], [['line1\nline2']]);
  assert.equal(csv, '"note"\n"line1\nline2"');
});

test('null and undefined become empty fields', () => {
  const csv = buildCsv(['a', 'b'], [[null, undefined]]);
  assert.equal(csv.split('\n')[1], '"",""');
});

test('numbers stringify', () => {
  const csv = buildCsv(['hours', 'earnings'], [[7.5, 1200]]);
  assert.equal(csv.split('\n')[1], '"7.5","1200"');
});
