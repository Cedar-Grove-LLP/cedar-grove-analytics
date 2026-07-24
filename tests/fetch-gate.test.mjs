import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasFullDataAccess } from '../src/utils/fetchGate.mjs';

const plainUser = {
  isAdmin: false,
  isPartialAdmin: false,
  hasDownloadsAccess: false,
  hasTransactionsOpsAccess: false,
};

test('admin gets the full firm-wide fetch', () => {
  assert.equal(hasFullDataAccess({ ...plainUser, isAdmin: true }), true);
});

test('plain user is restricted to own-data only', () => {
  assert.equal(hasFullDataAccess(plainUser), false);
});

test('partial admin gets the full fetch (can reach admin-only routes directly)', () => {
  assert.equal(hasFullDataAccess({ ...plainUser, isPartialAdmin: true }), true);
});

test('downloads-only restricted dashboard access gets the full fetch', () => {
  assert.equal(hasFullDataAccess({ ...plainUser, hasDownloadsAccess: true }), true);
});

test('transactions+ops restricted dashboard access gets the full fetch', () => {
  assert.equal(hasFullDataAccess({ ...plainUser, hasTransactionsOpsAccess: true }), true);
});

test('undefined flags (auth still resolving) mean own-data only', () => {
  assert.equal(hasFullDataAccess({}), false);
  assert.equal(hasFullDataAccess(), false);
});

test('always returns a real boolean, never a truthy passthrough', () => {
  assert.equal(hasFullDataAccess({ isAdmin: true }), true);
  assert.equal(typeof hasFullDataAccess({ isAdmin: true }), 'boolean');
  assert.equal(typeof hasFullDataAccess(plainUser), 'boolean');
});
