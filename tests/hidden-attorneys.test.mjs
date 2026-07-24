// Asserts against the REAL HIDDEN_ATTORNEYS config in hiddenAttorneys.mjs
// (currently one entry: Martyna Skrodzka, hideBefore 2026-01-01T00:00:00).
// If that list changes, update these tests alongside it — they pin specific
// boundary semantics for isAttorneyHidden and shouldIncludeAttorneyData.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAttorneyHidden,
  shouldIncludeAttorneyData,
  filterHiddenAttorneys,
  filterHiddenAttorneyData,
} from '../src/utils/hiddenAttorneys.mjs';

const at = (str) => new Date(str);

// ----------------------------------------------------------- isAttorneyHidden

test('isAttorneyHidden: Martyna Skrodzka is hidden before hideBefore', () => {
  assert.equal(isAttorneyHidden('Martyna Skrodzka', at('2025-12-31')), true);
});

test('isAttorneyHidden: exactly at hideBefore boundary is NOT hidden (strict "<")', () => {
  // asOfDate < hideBefore is false when equal, so the attorney is visible at the instant.
  assert.equal(isAttorneyHidden('Martyna Skrodzka', at('2026-01-01T00:00:00')), false);
});

test('isAttorneyHidden: Martyna Skrodzka is visible well after hideBefore', () => {
  assert.equal(isAttorneyHidden('Martyna Skrodzka', at('2026-01-02')), false);
});

test('isAttorneyHidden: unknown attorney is never hidden', () => {
  assert.equal(isAttorneyHidden('Some Unknown Name', at('2025-01-01')), false);
});

// ------------------------------------------------ shouldIncludeAttorneyData

test('shouldIncludeAttorneyData: range entirely before hideBefore is excluded', () => {
  assert.equal(
    shouldIncludeAttorneyData('Martyna Skrodzka', at('2025-11-01'), at('2025-12-31')),
    false,
  );
});

test('shouldIncludeAttorneyData: range straddling hideBefore is included', () => {
  assert.equal(
    shouldIncludeAttorneyData('Martyna Skrodzka', at('2025-12-15'), at('2026-01-15')),
    true,
  );
});

test('shouldIncludeAttorneyData: range entirely after hideBefore is included', () => {
  assert.equal(
    shouldIncludeAttorneyData('Martyna Skrodzka', at('2026-02-01'), at('2026-03-01')),
    true,
  );
});

test('shouldIncludeAttorneyData: unknown attorney is always included', () => {
  assert.equal(
    shouldIncludeAttorneyData('Some Unknown Name', at('2000-01-01'), at('2000-01-02')),
    true,
  );
});

// --------------------------------------------------------- filter helpers

test('filterHiddenAttorneys: removes hidden names, keeps visible ones', () => {
  const names = ['Sam McClure', 'Martyna Skrodzka', 'Colin Van Loon'];
  const result = filterHiddenAttorneys(names, at('2025-12-31'));
  assert.deepEqual(result, ['Sam McClure', 'Colin Van Loon']);
});

test('filterHiddenAttorneyData: removes hidden objects, keeps visible ones', () => {
  const attorneys = [
    { name: 'Sam McClure' },
    { name: 'Martyna Skrodzka' },
    { name: 'Colin Van Loon' },
  ];
  const result = filterHiddenAttorneyData(attorneys, at('2025-12-31'));
  assert.deepEqual(result, [{ name: 'Sam McClure' }, { name: 'Colin Van Loon' }]);
});
