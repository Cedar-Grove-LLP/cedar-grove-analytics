// Guards the registry ↔ call-site contract: a typo'd calcKey would otherwise
// only surface as a runtime "Unknown metric: X" inside a production tooltip.
// Scans src/ for every literal key reference and asserts it exists in
// CALC_DEFINITIONS. (OverviewView's one dynamic key is assigned from string
// literals named billablesCalcKey — matched by the last pattern.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CALC_DEFINITIONS } from '../src/utils/calcDefinitions.mjs';

const SRC_ROOT = new URL('../src', import.meta.url).pathname;

const sourceFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(jsx?|mjs)$/.test(name)) sourceFiles.push(path);
  }
};
walk(SRC_ROOT);

const KEY_PATTERNS = [
  /calcKey="([^"]+)"/g,            // <CalcTooltip calcKey="...">
  /calcKey:\s*'([^']+)'/g,         // info={{ calcKey: '...' }}
  /getSourceNote\('([^']+)'\)/g,   // chart source notes
  /billablesCalcKey = '([^']+)'/g, // OverviewView's dynamic key assignments
];

const referencedKeys = new Map(); // key -> first file referencing it
for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf8');
  for (const pattern of KEY_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      if (!referencedKeys.has(match[1])) referencedKeys.set(match[1], file);
    }
  }
}

test('every calcKey/getSourceNote literal in src/ exists in CALC_DEFINITIONS', () => {
  const unknown = [...referencedKeys.entries()]
    .filter(([key]) => !(key in CALC_DEFINITIONS))
    .map(([key, file]) => `${key} (${file})`);
  assert.deepEqual(unknown, []);
});

test('the scan actually finds the integration (guards against pattern rot)', () => {
  // If a refactor changes how keys are passed, this fails loudly instead of
  // letting the membership test pass vacuously on zero matches.
  assert.ok(referencedKeys.size >= 20, `only ${referencedKeys.size} key references found`);
});

test('no registry key is completely unreferenced by the app', () => {
  const orphans = Object.keys(CALC_DEFINITIONS).filter((key) => !referencedKeys.has(key));
  assert.deepEqual(orphans, []);
});
