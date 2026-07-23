import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getStatusBadge,
  getMatchTypeBadge,
  getUtilizationColor,
  getUtilizationBgColor,
  getProgressBarColor,
} from '../src/utils/statusStyles.js';

// ---------------------------------------------------------------------------
// Utilization color bands (shared by all three utilization helpers):
//   success: util > 90 && util < 110   (strict — 90 and 110 are NOT success)
//   warning: 85 <= util <= 90  ||  110 <= util <= 115  (inclusive both ends)
//   danger:  everything else (< 85 or > 115)
// ---------------------------------------------------------------------------

const SUCCESS = 'text-status-success';
const WARNING = 'text-status-warning';
const DANGER = 'text-status-danger';

test('getUtilizationColor: lower danger/warning boundary at 85', () => {
  assert.equal(getUtilizationColor(84.99), DANGER); // just below
  assert.equal(getUtilizationColor(85), WARNING);   // at threshold (inclusive)
  assert.equal(getUtilizationColor(85.01), WARNING); // just above
});

test('getUtilizationColor: warning/success boundary at 90', () => {
  assert.equal(getUtilizationColor(89.99), WARNING); // just below
  assert.equal(getUtilizationColor(90), WARNING);    // at threshold (90 is warning, not success)
  assert.equal(getUtilizationColor(90.01), SUCCESS); // just above
});

test('getUtilizationColor: success/warning boundary at 110', () => {
  assert.equal(getUtilizationColor(109.99), SUCCESS); // just below
  assert.equal(getUtilizationColor(110), WARNING);    // at threshold (110 is warning, not success)
  assert.equal(getUtilizationColor(110.01), WARNING); // just above
});

test('getUtilizationColor: upper warning/danger boundary at 115', () => {
  assert.equal(getUtilizationColor(114.99), WARNING); // just below
  assert.equal(getUtilizationColor(115), WARNING);    // at threshold (inclusive)
  assert.equal(getUtilizationColor(115.01), DANGER);  // just above
});

test('getUtilizationColor: interior and extreme values', () => {
  assert.equal(getUtilizationColor(100), SUCCESS);
  assert.equal(getUtilizationColor(0), DANGER);
  assert.equal(getUtilizationColor(200), DANGER);
});

test('getUtilizationBgColor: same band edges, bg classes', () => {
  const BG_SUCCESS = 'bg-status-success-light text-status-success-text';
  const BG_WARNING = 'bg-status-warning-light text-status-warning-text';
  const BG_DANGER = 'bg-status-danger-light text-status-danger-text';

  assert.equal(getUtilizationBgColor(84.99), BG_DANGER);
  assert.equal(getUtilizationBgColor(85), BG_WARNING);
  assert.equal(getUtilizationBgColor(90), BG_WARNING);
  assert.equal(getUtilizationBgColor(90.01), BG_SUCCESS);
  assert.equal(getUtilizationBgColor(109.99), BG_SUCCESS);
  assert.equal(getUtilizationBgColor(110), BG_WARNING);
  assert.equal(getUtilizationBgColor(115), BG_WARNING);
  assert.equal(getUtilizationBgColor(115.01), BG_DANGER);
});

test('getProgressBarColor: same band edges, bar classes', () => {
  assert.equal(getProgressBarColor(84.99), 'bg-status-danger');
  assert.equal(getProgressBarColor(85), 'bg-status-warning');
  assert.equal(getProgressBarColor(90), 'bg-status-warning');
  assert.equal(getProgressBarColor(90.01), 'bg-status-success');
  assert.equal(getProgressBarColor(109.99), 'bg-status-success');
  assert.equal(getProgressBarColor(110), 'bg-status-warning');
  assert.equal(getProgressBarColor(115), 'bg-status-warning');
  assert.equal(getProgressBarColor(115.01), 'bg-status-danger');
});

// ---------------------------------------------------------------------------
// Status / match-type badge lookups
// ---------------------------------------------------------------------------

test('getStatusBadge: known statuses map case-insensitively', () => {
  assert.equal(getStatusBadge('Paid'), 'bg-status-success-light text-status-success-text');
  assert.equal(getStatusBadge('PAYMENT INITIATED'), 'bg-status-warning-light text-status-warning-text');
  assert.equal(getStatusBadge('failed'), 'bg-status-danger-light text-status-danger-text');
  assert.equal(getStatusBadge('Inactive'), 'bg-status-danger-light text-status-danger-text');
});

test('getStatusBadge: unknown, empty, and nullish fall back to default', () => {
  const DEFAULT = 'bg-gray-100 text-gray-700';
  assert.equal(getStatusBadge('not-a-status'), DEFAULT);
  assert.equal(getStatusBadge(''), DEFAULT);
  assert.equal(getStatusBadge(null), DEFAULT);
  assert.equal(getStatusBadge(undefined), DEFAULT);
});

test('getMatchTypeBadge: known types and default fallback', () => {
  assert.equal(getMatchTypeBadge('alias'), 'bg-meta-light text-meta-text');
  assert.equal(getMatchTypeBadge('Name'), 'bg-primary-light text-primary-text');
  assert.equal(getMatchTypeBadge('fuzzy'), 'bg-secondary-light text-secondary-text');
  assert.equal(getMatchTypeBadge(undefined), 'bg-secondary-light text-secondary-text');
});
