// Guards the Recharts metadata-stripping fix in
// src/components/charts/BillableVsOpsChart.jsx. Recharts spreads each data
// row's props onto rendered SVG elements, so attorney aggregation rows —
// which carry a `role` field ('Attorney'/'Partner', used by cohort logic in
// utils/cohortFilter.mjs) — used to render role="Attorney" on bar <path>s, an
// invalid ARIA role axe-core flags as critical (was baselined in
// tests/e2e/smoke.spec.mjs A11Y_BASELINE.overview, now strict again).
// toPlottedRows is the pure mapping that strips rows to plotted fields only.
import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import BillableVsOpsChart, { toPlottedRows } from '@/components/charts/BillableVsOpsChart';

const AGGREGATION_ROWS = [
  {
    name: 'Sam McClure',
    billable: 100,
    ops: 20,
    earnings: 50000,
    role: 'Partner',
    employmentType: 'FTE',
    target: 120,
    transactions: { Financing: 40 },
    topTransactions: ['Financing'],
  },
  {
    name: 'Alice Attorney',
    billable: 80,
    ops: 10,
    earnings: 32000,
    role: 'Attorney',
    employmentType: 'FTE',
    target: 100,
    transactions: {},
    topTransactions: [],
  },
];

describe('toPlottedRows', () => {
  test('strips non-plotted metadata (role, employmentType, targets, ...) and keeps plotted fields', () => {
    const rows = toPlottedRows(AGGREGATION_ROWS);
    expect(rows).toEqual([
      { name: 'Sam McClure', billable: 100, ops: 20 },
      { name: 'Alice Attorney', billable: 80, ops: 10 },
    ]);
    // The invalid-ARIA culprit specifically must never survive the mapping.
    rows.forEach((row) => expect(row).not.toHaveProperty('role'));
  });

  test('tolerates null/undefined data', () => {
    expect(toPlottedRows(null)).toEqual([]);
    expect(toPlottedRows(undefined)).toEqual([]);
  });
});

describe('BillableVsOpsChart rendering', () => {
  test('no rendered element carries an attorney role attribute', () => {
    const { container } = render(<BillableVsOpsChart data={AGGREGATION_ROWS} />);
    // The figure wrapper legitimately uses role="figure"; what must never
    // appear is a data-derived role value like "Attorney" or "Partner".
    const bad = container.querySelectorAll('[role="Attorney"], [role="Partner"]');
    expect(bad.length).toBe(0);
  });
});
