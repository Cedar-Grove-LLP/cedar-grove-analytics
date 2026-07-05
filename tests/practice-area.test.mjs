import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPracticeArea, rollUpByPracticeArea, PRACTICE_AREAS } from '../src/utils/practiceArea.mjs';

test('classifies M&A categories', () => {
  assert.equal(classifyPracticeArea('M&A'), 'M&A');
  assert.equal(classifyPracticeArea('Mergers and Acquisitions Diligence'), 'M&A');
  assert.equal(classifyPracticeArea('m & a'), 'M&A');
});

test('classifies non-profit categories', () => {
  assert.equal(classifyPracticeArea('Non-Profit Formation'), 'Non-profit');
  assert.equal(classifyPracticeArea('Nonprofit Governance'), 'Non-profit');
});

test('classifies commercial categories: redline, new draft, IP', () => {
  assert.equal(classifyPracticeArea('Commercial (Redline Review)'), 'Commercial');
  assert.equal(classifyPracticeArea('Commercial (New Draft)'), 'Commercial');
  assert.equal(classifyPracticeArea('IP Assignment'), 'Commercial');
  assert.equal(classifyPracticeArea('Trademark Filing'), 'Commercial');
  assert.equal(classifyPracticeArea('Patent Prosecution'), 'Commercial');
});

test('everything else defaults to Corporate', () => {
  assert.equal(classifyPracticeArea('SAFE/CN Financing'), 'Corporate');
  assert.equal(classifyPracticeArea('General Diligence'), 'Corporate');
  assert.equal(classifyPracticeArea('Corporate Governance'), 'Corporate');
  assert.equal(classifyPracticeArea('Formation'), 'Corporate');
});

test('missing/empty billing category defaults to Corporate', () => {
  assert.equal(classifyPracticeArea(''), 'Corporate');
  assert.equal(classifyPracticeArea(undefined), 'Corporate');
  assert.equal(classifyPracticeArea(null), 'Corporate');
});

test('rollUpByPracticeArea aggregates and computes percentages', () => {
  const categoryStats = [
    { category: 'Commercial (Redline Review)', totalHours: 60, totalEarnings: 6000, matterCount: 3 },
    { category: 'M&A', totalHours: 20, totalEarnings: 2000, matterCount: 1 },
    { category: 'Formation', totalHours: 20, totalEarnings: 2000, matterCount: 2 },
  ];
  const result = rollUpByPracticeArea(categoryStats);
  assert.deepEqual(result.map((r) => r.area), PRACTICE_AREAS);

  const commercial = result.find((r) => r.area === 'Commercial');
  assert.equal(commercial.totalHours, 60);
  assert.equal(commercial.subAreaCount, 1);
  assert.equal(commercial.percentage, 60);

  const nonProfit = result.find((r) => r.area === 'Non-profit');
  assert.equal(nonProfit.totalHours, 0);
  assert.equal(nonProfit.percentage, 0);

  const totalPct = result.reduce((sum, r) => sum + r.percentage, 0);
  assert.equal(Math.round(totalPct), 100);
});

test('rollUpByPracticeArea tolerates empty/missing input', () => {
  const result = rollUpByPracticeArea([]);
  assert.equal(result.length, PRACTICE_AREAS.length);
  assert.ok(result.every((r) => r.totalHours === 0 && r.percentage === 0));

  const resultUndefined = rollUpByPracticeArea(undefined);
  assert.equal(resultUndefined.length, PRACTICE_AREAS.length);
});
