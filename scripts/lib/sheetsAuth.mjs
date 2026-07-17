/**
 * Google Sheets JWT auth + read helpers shared by every live verify
 * collector. Lifted from scripts/verify-invoices-live.mjs:29-83 (auth flow)
 * and :60-83/:110-115 (fetch + cap-guard), generalized to any spreadsheet
 * and range set instead of the one Invoices workbook.
 *
 * Read-only (spreadsheets.readonly). A per-book failure (403, unshared
 * workbook, unrecognized id) MUST surface as a returned `{blindSpot}`, never
 * a thrown error — that is the only way `ruleCoverage` can turn it into a
 * NOT_CHECKED leg instead of crashing the whole run. A token/network failure
 * that isn't a per-book response (bad key, DNS, oauth2.googleapis.com down)
 * is not recoverable per-book and is allowed to throw.
 */

import { createSign } from 'node:crypto';

const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** Parse the service-account key JSON from either supported env var. */
export function loadKey() {
  for (const name of ['GOOGLE_SERVICE_ACCOUNT_KEY', 'FIREBASE_SERVICE_ACCOUNT_KEY']) {
    if (process.env[name]) return JSON.parse(process.env[name]);
  }
  throw new Error('no service-account key (GOOGLE_SERVICE_ACCOUNT_KEY or FIREBASE_SERVICE_ACCOUNT_KEY)');
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Exchange a service-account key for a bearer token. Throws on failure — not per-book. */
export async function getAccessToken(key, scope = DEFAULT_SCOPE) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(key.private_key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

function blindSpotFrom(res, data) {
  return {
    blindSpot: {
      status: data?.error?.status ?? String(res.status),
      reason: data?.error?.message ?? `HTTP ${res.status}`,
      httpStatus: res.status,
    },
  };
}

/**
 * List a spreadsheet's tab titles. Returns {tabs:Set<string>} on success or
 * {blindSpot} on any non-OK response (403 unshared, 404 unknown id, ...).
 */
export async function listTabs(token, spreadsheetId) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!res.ok) return blindSpotFrom(res, data);
  return { tabs: new Set(data.sheets.map((s) => s.properties.title)) };
}

/**
 * Batch-read one or more A1 ranges from a spreadsheet. Returns
 * {grids: {range -> row[][]}} keyed by the exact range strings passed in
 * (in request order — Sheets echoes ranges back but may re-normalize the
 * string, so we key by what the caller asked for, not the echo), or
 * {blindSpot} on any non-OK response.
 */
export async function batchGet(token, spreadsheetId, ranges, { valueRenderOption = 'UNFORMATTED_VALUE' } = {}) {
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')
    + `&valueRenderOption=${valueRenderOption}`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${qs}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!res.ok) return blindSpotFrom(res, data);
  const grids = {};
  ranges.forEach((range, i) => { grids[range] = data.valueRanges[i]?.values || []; });
  return { grids };
}

/**
 * No-silent-caps guard (generalizes verify-invoices-live.mjs:110-115): a
 * range like "'July'!A1:AF400" has a trailing row bound of 400. If the grid
 * came back with >= that many rows, the tab's data likely continues past
 * the requested window and the range needs widening — hit:true means "we
 * may have silently truncated real data", not "this is fine because it's
 * full".
 */
export function capGuard(range, gotRows) {
  const bound = Number((range.match(/(\d+)$/) || [])[1]) || 0;
  return { hit: bound > 0 && gotRows >= bound, bound };
}
