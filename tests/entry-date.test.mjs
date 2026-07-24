import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEntryDate } from '../src/utils/dateHelpers.js';

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Regression: a bare "YYYY-MM-DD" string must resolve to that literal calendar
// day, not UTC-midnight-shifted-to-PST (which turned a June-1 entry into May 31
// and mis-flagged it as "outside the month"). Timezone-stable by construction.
test('date-only string resolves to its literal calendar day (no UTC off-by-one)', () => {
  assert.equal(ymd(getEntryDate({ date: '2026-06-01' })), '2026-06-01');
  assert.equal(ymd(getEntryDate({ date: '2026-03-03' })), '2026-03-03');
  assert.equal(ymd(getEntryDate({ date: '2026-12-31' })), '2026-12-31');
});

test('date-only entry on the 1st stays in its own month', () => {
  const d = getEntryDate({ date: '2026-06-01' });
  assert.equal(d.getMonth() + 1, 6); // June, not May
  assert.equal(d.getFullYear(), 2026);
});

test('whitespace around a date-only string is tolerated', () => {
  assert.equal(ymd(getEntryDate({ date: ' 2026-06-01 ' })), '2026-06-01');
});

test('no date falls back to the entry month/year', () => {
  const d = getEntryDate({ month: 'June', year: 2026 });
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth() + 1, 6);
});
