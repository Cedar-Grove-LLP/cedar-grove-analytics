import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SENIORITY_ORDER,
  getSeniorityRank,
  compareBySeniority,
  sortBySeniority,
} from '../src/utils/seniority.mjs';

test('SENIORITY_ORDER is the documented most→least tenured roster', () => {
  assert.deepEqual(SENIORITY_ORDER, [
    'Sam McClure',
    'Colin Van Loon',
    'Michael Ohta',
    'Molly Manning',
    'Michael Levin',
    'Valery Uscanga',
    'David Popkin',
    'Nick Agate',
    'Paige Wilson',
    'Martyna Skrodzka',
  ]);
});

test('getSeniorityRank: exact names map to their index', () => {
  SENIORITY_ORDER.forEach((name, i) => {
    assert.equal(getSeniorityRank(name), i);
  });
});

test('getSeniorityRank: tolerant of capitalisation and whitespace', () => {
  assert.equal(getSeniorityRank('colin van loon'), 1); // lowercase variant
  assert.equal(getSeniorityRank('Colin van Loon'), 1); // mixed case (demo/data form)
  assert.equal(getSeniorityRank('  Sam   McClure '), 0); // padded / doubled spaces
});

test('getSeniorityRank: nickname / middle-name variants via unique surname', () => {
  assert.equal(getSeniorityRank('Nicholas Agate'), 7); // Nick → Nicholas
  assert.equal(getSeniorityRank('Mike Ohta'), 2);
  assert.equal(getSeniorityRank('Samuel J. McClure'), 0); // middle initial
});

test('getSeniorityRank: unknown / empty names return null', () => {
  assert.equal(getSeniorityRank('Jane Doe'), null);
  assert.equal(getSeniorityRank(''), null);
  assert.equal(getSeniorityRank(null), null);
  assert.equal(getSeniorityRank(undefined), null);
});

test('compareBySeniority: known names order by tenure', () => {
  assert.ok(compareBySeniority('Sam McClure', 'Colin Van Loon') < 0);
  assert.ok(compareBySeniority('Martyna Skrodzka', 'Sam McClure') > 0);
  assert.equal(compareBySeniority('Michael Ohta', 'Michael Ohta'), 0);
});

test('compareBySeniority: unknown names sort after known, then alphabetically', () => {
  assert.ok(compareBySeniority('Zelda Unknown', 'Martyna Skrodzka') > 0);
  assert.ok(compareBySeniority('Aaron Newhire', 'Beth Newhire') < 0);
});

test('sortBySeniority: array of name strings, non-mutating', () => {
  const input = [
    'Paige Wilson',
    'Sam McClure',
    'Nicholas Agate',
    'Michael Ohta',
  ];
  const sorted = sortBySeniority(input);
  assert.deepEqual(sorted, [
    'Sam McClure',
    'Michael Ohta',
    'Nicholas Agate',
    'Paige Wilson',
  ]);
  // original untouched
  assert.deepEqual(input, [
    'Paige Wilson',
    'Sam McClure',
    'Nicholas Agate',
    'Michael Ohta',
  ]);
});

test('sortBySeniority: objects via getName, with unknown trailing alphabetically', () => {
  const users = [
    { name: 'Valery Uscanga' },
    { name: 'Zoe External' },
    { name: 'Sam McClure' },
    { name: 'Adam External' },
    { name: 'Colin Van Loon' },
  ];
  assert.deepEqual(
    sortBySeniority(users, (u) => u.name).map((u) => u.name),
    ['Sam McClure', 'Colin Van Loon', 'Valery Uscanga', 'Adam External', 'Zoe External'],
  );
});

test('sortBySeniority: tolerates null/undefined input', () => {
  assert.deepEqual(sortBySeniority(null), []);
  assert.deepEqual(sortBySeniority(undefined), []);
});
