import { createSign } from "node:crypto";
import { getAdminDb, getAdminAuth } from "@/firebase/admin";
import { authenticateRequest } from "@/app/api/_lib/authGate";
import { WORKBOOK_ID, RANGES, assembleWorkbook } from "@/utils/invoicesSheetRanges.mjs";
import { REAL_WORKBOOK } from "@/utils/invoicesRealData.mjs";

// Live READ-ONLY mirror of the "Invoices (2026)" Google Sheet for the
// Invoices (testing) tab. Authenticates as the read-only service account,
// batch-reads every tab, and reshapes the grids into the REAL_WORKBOOK shape
// the tab already consumes. Never writes to the sheet (scope is
// spreadsheets.readonly) and never persists anything.

export const dynamic = "force-dynamic";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const CACHE_TTL_MS = 5 * 60 * 1000;

// Server-side, module-scoped cache. Shared across requests on a warm instance;
// `?refresh=1` bypasses it. Holds only the assembled (non-sensitive-key) payload.
let cache = null; // { at: number, payload: object }

// Profits Paid cell fills can't come through the values API — restore them from
// the frozen snapshot, keyed by `${date}|${amount}` (a display nicety only).
const PROFIT_HIGHLIGHTS = new Map(
  (REAL_WORKBOOK.profitsPaid || [])
    .filter((r) => r.highlight)
    .map((r) => [`${r.date}|${r.amount}`, r.highlight])
);

const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });
const forbidden = () => Response.json({ error: "Forbidden" }, { status: 403 });

const b64url = (buf) => Buffer.from(buf).toString("base64url");

async function getAccessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SHEETS_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(key.private_key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    // data may include a description but never the private key.
    throw new Error(`token exchange failed (${data.error || res.status})`);
  }
  return data.access_token;
}

// The Sheets read uses the same service account as Firebase Admin (we reused
// that account and shared the workbook with it). We collect EVERY parseable
// candidate key — a dedicated GOOGLE_SERVICE_ACCOUNT_KEY first, then the
// FIREBASE_SERVICE_ACCOUNT_KEY that already exists in the deployment — and try
// them in order at fetch time (see fetchWorkbook). Falling back only on a
// *parse* error isn't enough: a valid-JSON key for the wrong service account
// (one not shared on the sheet) authenticates fine but gets 403 PERMISSION_DENIED
// on the read, so we must fall through on auth/permission failures too.
function loadServiceAccounts() {
  const candidates = [];
  const invalid = [];
  for (const name of ["GOOGLE_SERVICE_ACCOUNT_KEY", "FIREBASE_SERVICE_ACCOUNT_KEY"]) {
    const raw = process.env[name];
    if (!raw) continue;
    try {
      candidates.push({ name, key: JSON.parse(raw) });
    } catch {
      invalid.push(name); // malformed — skip, try the next candidate
    }
  }
  if (candidates.length) return candidates;
  if (invalid.length) throw new Error(`service-account key is not valid JSON (${invalid.join(", ")})`);
  throw new Error("no service-account key configured (GOOGLE_SERVICE_ACCOUNT_KEY or FIREBASE_SERVICE_ACCOUNT_KEY)");
}

// The tab name a range targets (ranges are always A1-quoted: 'Sheet Name'!A1:..).
const rangeSheetName = (range) => {
  const m = range.match(/^'(.+?)'!/);
  return m ? m[1] : range.split("!")[0];
};

async function getExistingTitles(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${WORKBOOK_ID}?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Sheets metadata error ${res.status}`);
  return new Set((data.sheets || []).map((s) => s.properties && s.properties.title));
}

// Read the workbook with one specific service-account key. Throws on any
// token/permission/API failure so the caller can try the next candidate.
async function fetchWorkbookWithKey(key) {
  const token = await getAccessToken(key);

  // Only request ranges whose tab still exists — batchGet fails the ENTIRE call
  // if any single range names a missing sheet (e.g. a backup tab the firm has
  // since deleted). Skipped tabs are simply absent from the assembled workbook.
  const titles = await getExistingTitles(token);
  const active = RANGES.filter((r) => titles.has(rangeSheetName(r.range)));

  const qs =
    active.map((r) => `ranges=${encodeURIComponent(r.range)}`).join("&") +
    "&valueRenderOption=UNFORMATTED_VALUE";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${WORKBOOK_ID}/values:batchGet?${qs}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Sheets API error ${res.status}`);
  }

  const gridsByKey = {};
  active.forEach((r, i) => {
    gridsByKey[r.key] = (data.valueRanges && data.valueRanges[i] && data.valueRanges[i].values) || [];
  });
  const fetchedAt = new Date().toISOString();
  const workbook = assembleWorkbook(gridsByKey, {
    fetchedAt,
    source: "Cedar Grove LLP - Invoices (2026) [live]",
    profitHighlights: PROFIT_HIGHLIGHTS,
  });
  return { workbook, fetchedAt };
}

async function fetchWorkbook() {
  const candidates = loadServiceAccounts();
  let lastErr = null;
  for (const { name, key } of candidates) {
    try {
      return await fetchWorkbookWithKey(key);
    } catch (err) {
      // A valid-JSON key for the wrong account authenticates but 403s on the
      // read — fall through to the next candidate instead of failing outright.
      lastErr = err;
      const msg = String((err && err.message) || err);
      console.warn(`invoices-workbook: read via ${name} failed, trying next candidate:`, msg);
    }
  }
  throw lastErr || new Error("no usable service-account key");
}

export async function GET(request) {
  const gate = await authenticateRequest(request, {
    auth: getAdminAuth(),
    db: getAdminDb(),
    logPrefix: "invoices-workbook",
    buildError: (status) =>
      status === 401
        ? unauthorized()
        : status === 403
          ? forbidden()
          : Response.json({ error: "Internal error" }, { status: 500 }),
  });
  if (!gate.ok) return gate.response;

  // --- Serve from cache unless ?refresh=1. ------------------------------------
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const now = Date.now();
  if (!refresh && cache && now - cache.at < CACHE_TTL_MS) {
    return Response.json({ ...cache.payload, cached: true });
  }

  try {
    const payload = await fetchWorkbook();
    cache = { at: now, payload };
    return Response.json({ ...payload, cached: false });
  } catch (err) {
    // Never echo key material; return a short message and let the client fall
    // back to the frozen snapshot.
    const message = String((err && err.message) || err).replace(/private_key|BEGIN [A-Z ]+KEY/gi, "[redacted]");
    console.error("invoices-workbook: fetch failed:", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
