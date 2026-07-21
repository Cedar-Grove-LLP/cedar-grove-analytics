import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePeriodMetric } from '../src/utils/periodMetrics.mjs';

const fullMonth = (year, monthIndex) => ({
  startDate: new Date(year, monthIndex, 1, 0, 0, 0, 0),
  endDate: new Date(year, monthIndex + 1, 0, 23, 59, 59, 999),
});

const now = new Date(2026, 6, 20, 12);

test('sums two whole consecutive months', () => {
  const monthlyMetrics = [
    { year: 2026, month: 'March', revenueAccrued: 100 },
    { year: 2026, month: 'April', revenueAccrued: 250 },
  ];
  const result = computePeriodMetric({
    monthlyMetrics,
    field: 'revenueAccrued',
    dateRange: 'custom',
    startDate: new Date(2026, 2, 1),
    endDate: new Date(2026, 4, 0, 23, 59, 59, 999),
    now,
  });
  assert.equal(result, 350);
});

test('returns null when a touched month is only partially covered', () => {
  const monthlyMetrics = [
    { year: 2026, month: 'March', revenueAccrued: 100 },
    { year: 2026, month: 'April', revenueAccrued: 250 },
  ];
  assert.equal(computePeriodMetric({
    monthlyMetrics,
    field: 'revenueAccrued',
    dateRange: 'custom',
    startDate: new Date(2026, 2, 1),
    endDate: new Date(2026, 3, 15),
    now,
  }), null);
});

test('allows current month-to-date', () => {
  assert.equal(computePeriodMetric({
    monthlyMetrics: [{ year: 2026, month: 'July', attorneyBillables: 500 }],
    field: 'attorneyBillables',
    dateRange: 'current-month',
    startDate: new Date(2026, 6, 1),
    endDate: now,
    now,
  }), 500);
});

test('does not allow a past partial month', () => {
  assert.equal(computePeriodMetric({
    monthlyMetrics: [{ year: 2026, month: 'June', attorneyBillables: 500 }],
    field: 'attorneyBillables',
    dateRange: 'custom',
    startDate: new Date(2026, 5, 1),
    endDate: new Date(2026, 5, 20),
    now,
  }), null);
});

test('returns null when an in-range month has no entry', () => {
  assert.equal(computePeriodMetric({
    monthlyMetrics: [{ year: 2026, month: 'March', revenueAccrued: 100 }],
    field: 'revenueAccrued',
    dateRange: 'custom',
    startDate: new Date(2026, 2, 1),
    endDate: new Date(2026, 4, 0, 23, 59, 59, 999),
    now,
  }), null);
});

test('returns null when an in-range field value is non-numeric', () => {
  assert.equal(computePeriodMetric({
    monthlyMetrics: [{ year: 2026, month: 'March', firmProfit: null }],
    field: 'firmProfit',
    dateRange: 'custom',
    ...fullMonth(2026, 2),
    now,
  }), null);
});

test('all-time sums every entry and returns null for a zero total', () => {
  const base = { field: 'revenueAccrued', dateRange: 'all-time', now };
  assert.equal(computePeriodMetric({
    ...base,
    monthlyMetrics: [
      { year: 2025, month: 'December', revenueAccrued: 100 },
      { year: 2026, month: 'January', revenueAccrued: 250 },
    ],
  }), 350);
  assert.equal(computePeriodMetric({
    ...base,
    monthlyMetrics: [
      { year: 2025, month: 'December', revenueAccrued: 100 },
      { year: 2026, month: 'January', revenueAccrued: -100 },
    ],
  }), null);
});

test('empty or undefined monthlyMetrics returns null for normal and all-time ranges', () => {
  assert.equal(computePeriodMetric({
    monthlyMetrics: [], field: 'revenueAccrued', dateRange: 'custom', ...fullMonth(2026, 2), now,
  }), null);
  assert.equal(computePeriodMetric({
    monthlyMetrics: undefined, field: 'revenueAccrued', dateRange: 'all-time', now,
  }), null);
});

test('sums full months across a year boundary', () => {
  assert.equal(computePeriodMetric({
    monthlyMetrics: [
      { year: 2025, month: 'December', revenueAccrued: 400 },
      { year: 2026, month: 'January', revenueAccrued: 600 },
    ],
    field: 'revenueAccrued',
    dateRange: 'custom',
    startDate: new Date(2025, 11, 1),
    endDate: new Date(2026, 1, 0, 23, 59, 59, 999),
    now,
  }), 1000);
});
