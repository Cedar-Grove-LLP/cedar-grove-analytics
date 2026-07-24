import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPhantomTemplateEntries } from '../src/utils/verify/phantoms.mjs';

test('detects the 24-entry McClure phantom sequence', () => {
  const entries = Array.from({ length: 24 }, (_, index) => ({ flatFee: index + 1 }));
  assert.deepEqual(detectPhantomTemplateEntries(entries), { isPhantom: true, affectedRows: 24 });
});

test('detects the 4-entry Ohta phantom sequence', () => {
  const entries = Array.from({ length: 4 }, (_, index) => ({ flatFee: index + 1 }));
  assert.deepEqual(detectPhantomTemplateEntries(entries), { isPhantom: true, affectedRows: 4 });
});

test('does not flag real flat fees', () => {
  const entries = [{ flatFee: 250 }, { flatFee: 250 }, { flatFee: 500 }];
  assert.deepEqual(detectPhantomTemplateEntries(entries), { isPhantom: false, affectedRows: 0 });
});

test('does not flag a single entry or an empty array', () => {
  assert.deepEqual(detectPhantomTemplateEntries([{ flatFee: 1 }]), {
    isPhantom: false, affectedRows: 0,
  });
  assert.deepEqual(detectPhantomTemplateEntries([]), { isPhantom: false, affectedRows: 0 });
});

test('detects string flat fees from Sheets', () => {
  const entries = [{ flatFee: '1' }, { flatFee: '2' }, { flatFee: '3' }];
  assert.deepEqual(detectPhantomTemplateEntries(entries), { isPhantom: true, affectedRows: 3 });
});

test('does not flag an out-of-order permutation', () => {
  const entries = [{ flatFee: 3 }, { flatFee: 1 }, { flatFee: 2 }];
  assert.deepEqual(detectPhantomTemplateEntries(entries), { isPhantom: false, affectedRows: 0 });
});
