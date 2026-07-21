import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODELLED_SOURCES,
  matchModelledSource,
  modelledDataStats,
} from '../src/utils/verify/modelledSources.mjs';
import {
  FORMULA_LANDMINES,
  checkFormulaText,
} from '../src/utils/verify/formulaLandmines.mjs';

// ------------------------------------------------------------- modelledSources

test('MODELLED_SOURCES encodes the exact ground-truth periods', () => {
  const byId = Object.fromEntries(MODELLED_SOURCES.map((s) => [s.id, s]));
  assert.equal(byId['2024-lumped-import-mcclure'].monthStart, '2024-01');
  assert.equal(byId['2024-lumped-import-mcclure'].monthEnd, '2024-12');
  assert.equal(byId['2024-lumped-import-vanloon'].monthStart, '2024-02');
  assert.equal(byId['2024-lumped-import-vanloon'].monthEnd, '2024-12');
  assert.equal(byId['2024-lumped-import-weekes'].monthStart, '2024-04');
  assert.equal(byId['2024-lumped-import-weekes'].monthEnd, '2024-12');
  assert.equal(byId['mcclure-2025-h1-matrix'].monthStart, '2025-01');
  assert.equal(byId['mcclure-2025-h1-matrix'].monthEnd, '2025-06');
  assert.equal(byId['2024-lumped-import-mcclure'].kind, 'LUMPED_IMPORT');
  assert.equal(byId['mcclure-2025-h1-matrix'].kind, 'MATRIX_ESTIMATE');
});

test('matchModelledSource hits 2024 lumped-import windows per attorney', () => {
  assert.deepEqual(matchModelledSource({ attorney: 'Sam McClure', monthKey: '2024-01', domain: 'billables' }), {
    id: '2024-lumped-import-mcclure',
    kind: 'LUMPED_IMPORT',
    reason: byId('2024-lumped-import-mcclure').reason,
  });
  // van Loon's 2024 workbook starts February — January must NOT match.
  assert.equal(matchModelledSource({ attorney: 'Colin van Loon', monthKey: '2024-01', domain: 'billables' }), null);
  assert.ok(matchModelledSource({ attorney: 'Colin van Loon', monthKey: '2024-02', domain: 'ops' }));
  // Weekes starts April.
  assert.equal(matchModelledSource({ attorney: 'Miika Weekes', monthKey: '2024-03', domain: 'billables' }), null);
  assert.ok(matchModelledSource({ attorney: 'Miika Weekes', monthKey: '2024-04', domain: 'billables' }));
});

test('matchModelledSource hits McClure 2025 H1 matrix, not other attorneys or months', () => {
  const hit = matchModelledSource({ attorney: 'Sam McClure', monthKey: '2025-03', domain: 'billables' });
  assert.equal(hit.id, 'mcclure-2025-h1-matrix');
  assert.equal(hit.kind, 'MATRIX_ESTIMATE');
  assert.equal(matchModelledSource({ attorney: 'Sam McClure', monthKey: '2025-07', domain: 'billables' }), null);
  assert.equal(matchModelledSource({ attorney: 'Michael Ohta', monthKey: '2025-03', domain: 'billables' }), null);
});

test('matchModelledSource returns null for a normal timekept period', () => {
  assert.equal(matchModelledSource({ attorney: 'Michael Ohta', monthKey: '2025-09', domain: 'billables' }), null);
  assert.equal(matchModelledSource({}), null);
});

test('modelledDataStats reproduces the all-time KPI: 27.2% billable / 38.2% ops', () => {
  // Synthetic fixture: one period inside a modelled window per domain (summed to the
  // proven modelled totals) and one period outside any window (summed to the remainder),
  // so the aggregate reproduces the exact all-time totals from the ground-truth audit.
  const periods = [
    { attorney: 'Sam McClure', monthKey: '2024-06', domain: 'billables', hours: 1651.59 },
    { attorney: 'Michael Ohta', monthKey: '2025-09', domain: 'billables', hours: 6082.13 - 1651.59 },
    { attorney: 'Sam McClure', monthKey: '2024-06', domain: 'ops', hours: 3514.21 },
    { attorney: 'Michael Ohta', monthKey: '2025-09', domain: 'ops', hours: 9195.24 - 3514.21 },
  ];
  const stats = modelledDataStats(periods);
  assert.equal(stats.billableHours, 6082.13);
  assert.equal(round2(stats.billableModelled), 1651.59);
  assert.equal(stats.billablePct, 27.2);
  assert.equal(stats.opsHours, 9195.24);
  assert.equal(round2(stats.opsModelled), 3514.21);
  assert.equal(stats.opsPct, 38.2);
});

test('modelledDataStats handles the empty case without dividing by zero', () => {
  assert.deepEqual(modelledDataStats([]), {
    billableHours: 0,
    billableModelled: 0,
    billablePct: 0,
    opsHours: 0,
    opsModelled: 0,
    opsPct: 0,
  });
});

function byId(id) {
  return MODELLED_SOURCES.find((s) => s.id === id);
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

// ------------------------------------------------------------- formulaLandmines

test('FORMULA_LANDMINES encodes the 83(b) *0.65 landmine on B4 / July + Template', () => {
  const landmine = FORMULA_LANDMINES.find((l) => l.id === 'elections-83b-times-0.65');
  assert.ok(landmine);
  assert.equal(landmine.cell, 'B4');
  assert.deepEqual(landmine.tabs, ['July', 'Template']);
  assert.ok(landmine.pattern instanceof RegExp);
  assert.equal(landmine.booksWithTypo.length, 9);
  assert.equal(landmine.correctBook.book, 'Levin');
});

test('checkFormulaText flags the *65 typo on both column-layout variants', () => {
  const landmine = FORMULA_LANDMINES.find((l) => l.id === 'elections-83b-times-0.65');
  assert.deepEqual(checkFormulaText('=SUM(Q:Q)*65', landmine), { pass: false, got: '=SUM(Q:Q)*65' });
  assert.equal(checkFormulaText('=SUM(L:L)*65', landmine).pass, false); // PTE-layout variant
});

test('checkFormulaText passes the one correct book (Levin)', () => {
  const landmine = FORMULA_LANDMINES.find((l) => l.id === 'elections-83b-times-0.65');
  assert.deepEqual(checkFormulaText('=SUM(Q:Q)*0.65', landmine), { pass: true, got: '=SUM(Q:Q)*0.65' });
});

test('the 83(b) typo is dormant: both the buggy and correct formula evaluate to $0 today, so a '
  + 'VALUE comparison cannot distinguish them — only formula-text inspection (checkFormulaText) can', () => {
  // No July elections exist yet, so SUM(...) over an empty range is 0 regardless of the
  // multiplier (0 * 65 === 0 * 0.65 === 0). Every value leg — SHEET, FS_TOTALS, FS_ENTRIES,
  // ORACLE — reads 0 and "agrees", which is exactly why this registry has to exist: it is
  // the one check in the whole system that is not a value comparison.
  const buggyValue = 0 * 65;
  const correctValue = 0 * 0.65;
  assert.equal(buggyValue, correctValue);
  assert.equal(buggyValue, 0);

  const landmine = FORMULA_LANDMINES.find((l) => l.id === 'elections-83b-times-0.65');
  assert.equal(checkFormulaText('=SUM(Q:Q)*65', landmine).pass, false);
  assert.equal(checkFormulaText('=SUM(Q:Q)*0.65', landmine).pass, true);
});
