import { getAdminDb, getAdminAuth } from "@/firebase/admin";

const MERCURY_BASE_URL = "https://api.mercury.com/api/v1";
const PAGE_LIMIT = 500;
const ALLOWED_EMAIL_DOMAIN = "cedargrovellp.com";

const unauthorized = () =>
  Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
const forbidden = () =>
  Response.json({ success: false, error: "Forbidden" }, { status: 403 });

export async function POST(request) {
  // ---------------------------------------------------------------------------
  // 1. Authentication: require Authorization: Bearer <Firebase ID token>.
  //    The React-side `isAllowedDomain` / `isAdmin` checks are cosmetic; this
  //    server-side verification is the authoritative gate.
  // ---------------------------------------------------------------------------
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return unauthorized();
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    return unauthorized();
  }

  let decoded;
  try {
    // firebase-admin@13 Auth.verifyIdToken signature is
    //   verifyIdToken(idToken: string, checkRevoked?: boolean): Promise<DecodedIdToken>
    // (verified in node_modules/firebase-admin/lib/auth/base-auth.d.ts:129).
    // The second arg is a positional boolean — NOT an options object.
    // Pass `true` so disabled / revoked accounts cannot trigger a sync.
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch (err) {
    // Log error code only; do not echo the token or full error chain to logs.
    console.warn(
      "sync-transactions: token verification failed:",
      err && err.code ? err.code : "unknown"
    );
    return unauthorized();
  }

  // ---------------------------------------------------------------------------
  // 2. Authorization: verified email, allowed domain, admin record exists.
  //    DecodedIdToken.email / email_verified are both optional per the
  //    firebase-admin type definition, so guard explicitly.
  // ---------------------------------------------------------------------------
  const email =
    typeof decoded.email === "string" ? decoded.email.toLowerCase() : null;
  if (!email || decoded.email_verified !== true) {
    return forbidden();
  }
  if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    return forbidden();
  }

  let adminDb;
  try {
    adminDb = getAdminDb();
    const adminDoc = await adminDb.collection("admins").doc(email).get();
    if (!adminDoc.exists) {
      return forbidden();
    }
  } catch (err) {
    console.error(
      "sync-transactions: admin lookup failed:",
      err && err.code ? err.code : err && err.message ? err.message : "unknown"
    );
    return Response.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Mercury sync proper. Caller is a verified, domain-restricted admin.
  // ---------------------------------------------------------------------------
  const mercuryToken = process.env.MERCURY_API_TOKEN;
  if (!mercuryToken) {
    return Response.json(
      { success: false, error: "MERCURY_API_TOKEN is not configured" },
      { status: 500 }
    );
  }
  const accountId = process.env.MERCURY_ACCOUNT_ID;
  if (!accountId) {
    return Response.json(
      { success: false, error: "MERCURY_ACCOUNT_ID is not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch all transactions with pagination
    let allTransactions = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const url = `${MERCURY_BASE_URL}/account/${accountId}/transactions?limit=${PAGE_LIMIT}&offset=${offset}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${mercuryToken}` },
      });

      if (!res.ok) {
        // Log full status + truncated body server-side (Vercel logs only); do
        // NOT echo Mercury's response body back to the caller in case it
        // contains counterparty PII.
        const body = await res.text().catch(() => "");
        console.error(
          `sync-transactions: Mercury API ${res.status}`,
          body.slice(0, 500)
        );
        return Response.json(
          { success: false, error: `Mercury API error: ${res.status}` },
          { status: 502 }
        );
      }

      const data = await res.json();
      const transactions = data.transactions || [];
      allTransactions = allTransactions.concat(transactions);

      if (transactions.length < PAGE_LIMIT) {
        hasMore = false;
      } else {
        offset += PAGE_LIMIT;
      }
    }

    // Upsert each transaction into Firestore in batches of 500.
    //
    // NOTE: this still uses `batch.set(docRef, txn)` which clobbers any
    // per-doc fields not present in the Mercury payload (e.g., manually-set
    // `matchedTransactionId` from AdminInvoices.jsx). Switching to a
    // field-allowlist merge is tracked as plan item S2; that's intentionally
    // out of scope for this SEC-001-only session.
    const BATCH_SIZE = 500;
    for (let i = 0; i < allTransactions.length; i += BATCH_SIZE) {
      const chunk = allTransactions.slice(i, i + BATCH_SIZE);
      const batch = adminDb.batch();
      for (const txn of chunk) {
        const docRef = adminDb.collection("transactions").doc(txn.id);
        batch.set(docRef, txn);
      }
      await batch.commit();
    }

    return Response.json({ success: true, synced: allTransactions.length });
  } catch (err) {
    // Log only the error message; do not return it to the caller. Any
    // upstream API response bodies / stack traces stay server-side.
    console.error(
      "sync-transactions: unexpected error:",
      err && err.message ? err.message : "unknown"
    );
    return Response.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
