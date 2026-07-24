import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnvFile } from '../scripts/lib/env.mjs';

// loadEnvFile writes into process.env (existing values win), so every test
// uses uniquely-prefixed keys and cleans them up afterwards.

function withEnvFile(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'env-load-test-'));
  const path = join(dir, '.env.test');
  writeFileSync(path, content);
  try {
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function cleanup(...keys) {
  for (const key of keys) delete process.env[key];
}

test('loadEnvFile: parses plain KEY=value lines and returns true', () => {
  withEnvFile('ENVTEST_A=hello\nENVTEST_B=world\n', (path) => {
    try {
      assert.equal(loadEnvFile(path), true);
      assert.equal(process.env.ENVTEST_A, 'hello');
      assert.equal(process.env.ENVTEST_B, 'world');
    } finally {
      cleanup('ENVTEST_A', 'ENVTEST_B');
    }
  });
});

test('loadEnvFile: strips surrounding double and single quotes', () => {
  withEnvFile('ENVTEST_DQ="double quoted"\nENVTEST_SQ=\'single quoted\'\n', (path) => {
    try {
      loadEnvFile(path);
      assert.equal(process.env.ENVTEST_DQ, 'double quoted');
      assert.equal(process.env.ENVTEST_SQ, 'single quoted');
    } finally {
      cleanup('ENVTEST_DQ', 'ENVTEST_SQ');
    }
  });
});

test('loadEnvFile: mismatched quotes are left as-is', () => {
  withEnvFile('ENVTEST_MIX="mismatched\'\n', (path) => {
    try {
      loadEnvFile(path);
      assert.equal(process.env.ENVTEST_MIX, '"mismatched\'');
    } finally {
      cleanup('ENVTEST_MIX');
    }
  });
});

test('loadEnvFile: skips comments, blank lines, and malformed lines', () => {
  const content = [
    '# a full-line comment',
    '',
    '   ',
    'ENVTEST_OK=yes',
    '=no-key',       // eq at index 0 → skipped
    'NOEQUALSSIGN',  // no = → skipped
    '  # indented comment',
    '',
  ].join('\n');
  withEnvFile(content, (path) => {
    try {
      assert.equal(loadEnvFile(path), true);
      assert.equal(process.env.ENVTEST_OK, 'yes');
      assert.ok(!('NOEQUALSSIGN' in process.env));
      assert.ok(!('' in process.env));
    } finally {
      cleanup('ENVTEST_OK');
    }
  });
});

test('loadEnvFile: trims whitespace around key and value, keeps = in value', () => {
  withEnvFile('  ENVTEST_TRIM  =  spaced out  \nENVTEST_EQ=a=b=c\n', (path) => {
    try {
      loadEnvFile(path);
      assert.equal(process.env.ENVTEST_TRIM, 'spaced out');
      // only the FIRST = splits key from value
      assert.equal(process.env.ENVTEST_EQ, 'a=b=c');
    } finally {
      cleanup('ENVTEST_TRIM', 'ENVTEST_EQ');
    }
  });
});

test('loadEnvFile: existing process.env values are not overwritten', () => {
  process.env.ENVTEST_EXISTING = 'original';
  withEnvFile('ENVTEST_EXISTING=from-file\n', (path) => {
    try {
      loadEnvFile(path);
      assert.equal(process.env.ENVTEST_EXISTING, 'original');
    } finally {
      cleanup('ENVTEST_EXISTING');
    }
  });
});

test('loadEnvFile: empty value is set to empty string', () => {
  withEnvFile('ENVTEST_EMPTY=\n', (path) => {
    try {
      loadEnvFile(path);
      assert.equal(process.env.ENVTEST_EMPTY, '');
    } finally {
      cleanup('ENVTEST_EMPTY');
    }
  });
});

test('loadEnvFile: handles CRLF line endings', () => {
  withEnvFile('ENVTEST_CRLF_A=one\r\nENVTEST_CRLF_B=two\r\n', (path) => {
    try {
      loadEnvFile(path);
      assert.equal(process.env.ENVTEST_CRLF_A, 'one');
      assert.equal(process.env.ENVTEST_CRLF_B, 'two');
    } finally {
      cleanup('ENVTEST_CRLF_A', 'ENVTEST_CRLF_B');
    }
  });
});

test('loadEnvFile: missing file is a silent no-op returning false', () => {
  const missing = join(tmpdir(), 'env-load-test-definitely-missing', '.env.nope');
  assert.equal(loadEnvFile(missing), false);
});
