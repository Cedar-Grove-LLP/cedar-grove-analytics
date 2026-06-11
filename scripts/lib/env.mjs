import { readFileSync, existsSync } from 'node:fs';

/**
 * Minimal .env loader so scripts run as plain `node scripts/...` without a
 * dotenv dependency. Lines are KEY=VALUE; blank lines and #-comments are
 * skipped; surrounding single/double quotes are stripped. Existing
 * process.env values always win. Missing file is a silent no-op (.env* is
 * gitignored and absent in CI/cloud sessions by design).
 */
export function loadEnvFile(path = '.env.local') {
  if (!existsSync(path)) return false;

  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  return true;
}
