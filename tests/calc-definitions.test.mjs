import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE,
  CALC_DEFINITIONS,
  REQUIRED_KEYS,
  formatSheetRef,
  getCalcTooltipLines,
  getSourceNote,
} from '../src/utils/calcDefinitions.mjs';

const validSources = new Set(Object.values(SOURCE));

test('every definition has label, formula, inputs, and a valid source', () => {
  for (const [key, def] of Object.entries(CALC_DEFINITIONS)) {
    assert.ok(def.label && typeof def.label === 'string', `${key}: label`);
    assert.ok(def.formula && typeof def.formula === 'string', `${key}: formula`);
    assert.ok(Array.isArray(def.inputs) && def.inputs.length > 0, `${key}: inputs`);
    assert.ok(def.inputs.every((i) => typeof i === 'string' && i.length > 0), `${key}: input strings`);
    assert.ok(validSources.has(def.source), `${key}: source ${def.source}`);
  }
});

test('every sheet-literal definition carries a sheetRef with both layout cells (or a cell-less line)', () => {
  for (const [key, def] of Object.entries(CALC_DEFINITIONS)) {
    if (def.source !== SOURCE.SHEET_LITERAL) continue;
    assert.ok(def.sheetRef, `${key}: sheetRef required for SHEET_LITERAL`);
    assert.ok(def.sheetRef.label && def.sheetRef.scope, `${key}: sheetRef label/scope`);
    if (def.sheetRef.scope !== 'line') {
      assert.ok(def.sheetRef.currentCell, `${key}: currentCell`);
      assert.ok(def.sheetRef.legacyCell, `${key}: legacyCell`);
    }
  }
});

test('REQUIRED_KEYS set-equals the registry keys (no missing, no orphans)', () => {
  assert.deepEqual([...REQUIRED_KEYS].sort(), Object.keys(CALC_DEFINITIONS).sort());
  assert.ok(REQUIRED_KEYS.length >= 25, 'registry covers the metric inventory');
});

test('formatSheetRef renders the dual-layout reference string', () => {
  assert.equal(
    formatSheetRef({ workbook: 'invoices', label: 'Billable Earnings', scope: 'summary cell', currentCell: 'B3', legacyCell: 'B2' }),
    "'{year} - Invoices ({lastName})' workbook → month tab → 'Billable Earnings' summary cell (B3 in current layout / B2 in legacy layout)"
  );
  assert.equal(
    formatSheetRef({ workbook: 'invoices', label: 'Total Billable Hours', scope: 'summary cell', currentCell: 'B1', legacyCell: 'B1' }),
    "'{year} - Invoices ({lastName})' workbook → month tab → 'Total Billable Hours' summary cell (B1 in both layouts)"
  );
  assert.equal(
    formatSheetRef({ workbook: 'rates', label: 'Attorney Billables', scope: 'line' }),
    "rates workbook → monthly tab → 'Attorney Billables' line"
  );
  assert.equal(formatSheetRef(null), '');
});

test('getCalcTooltipLines orders label, formula, inputs, source, notes, dynamic context', () => {
  const lines = getCalcTooltipLines('earnings');
  assert.equal(lines[0], 'Earnings (take-home)');
  assert.ok(lines[1].startsWith('= '));
  assert.ok(lines[2].startsWith('Inputs: '));
  assert.ok(lines[3].startsWith('Synced literal from '));
  assert.ok(lines[3].includes('not recomputed'));

  const withContext = getCalcTooltipLines('pacePct', { context: 'Pace targets reflect 3 days out of office' });
  assert.equal(withContext[withContext.length - 1], 'Pace targets reflect 3 days out of office');

  assert.deepEqual(getCalcTooltipLines('nope'), ['Unknown metric: nope']);
});

test('admin-entered values say explicitly they are not synced from sheets', () => {
  const rate = getCalcTooltipLines('billingRate');
  assert.ok(rate.some((l) => l.includes('not synced from Google Sheets')));
  assert.ok(rate.some((l) => l.includes('is NOT this billing rate')));
  // The cell coordinates must come from formatSheetRef, not hand-typed prose.
  assert.ok(rate.some((l) => l.includes('(B2 in current layout / B4 in legacy layout)')));
});

test('getSourceNote returns one compact newline-free line for every key', () => {
  for (const key of REQUIRED_KEYS) {
    const note = getSourceNote(key);
    assert.ok(note.length > 0, key);
    assert.ok(!note.includes('\n'), key);
  }
  assert.equal(getSourceNote('nope'), '');
});
