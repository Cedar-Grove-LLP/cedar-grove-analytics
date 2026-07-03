#!/usr/bin/env node
// Confirm the service account can READ the Invoices (2026) workbook via the
// Google Sheets API. Read-only scope; fetches two tiny ranges and prints them.
// Usage: node scripts/check-sheets-access.mjs
// Requires GOOGLE_SERVICE_ACCOUNT_KEY in .env.local (single-line JSON) or env.

import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKBOOK_ID = '1Qkqc4zsqMzP9lN4qTYiDpdJEbQAWQq88j3p23SVxNq8';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

function loadKey() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) return process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const envPath = join(ROOT, '.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      if (line.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY=')) {
        return line.slice('GOOGLE_SERVICE_ACCOUNT_KEY='.length).trim();
      }
    }
  }
  throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not found in env or .env.local');
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

async function getAccessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(key.private_key))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

const key = JSON.parse(loadKey());
console.log(`service account: ${key.client_email}`);
const token = await getAccessToken(key);
console.log('access token: OK (spreadsheets.readonly scope)');

const ranges = ["'Rate Sheet'!A1:C2", "'Payment Status'!A1:B1"];
const url = `https://sheets.googleapis.com/v4/spreadsheets/${WORKBOOK_ID}/values:batchGet?` +
  ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
const data = await res.json();
if (!res.ok) {
  console.error(`Sheets API error ${res.status}:`, JSON.stringify(data.error, null, 2));
  if (data.error?.status === 'PERMISSION_DENIED' && /has not been used|is disabled/.test(data.error?.message || '')) {
    console.error('\n→ The Sheets API is not enabled on the GCP project. Enable it at:');
    console.error('  https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=cedar-grove-analytics');
  } else if (data.error?.status === 'PERMISSION_DENIED') {
    console.error('\n→ The workbook is not shared with the service account (Viewer needed).');
  }
  process.exit(1);
}
for (const vr of data.valueRanges) {
  console.log(`\n${vr.range}`);
  for (const row of vr.values || []) console.log(' ', row.join(' | '));
}
console.log('\nCONFIRMED: service account can read the workbook.');
