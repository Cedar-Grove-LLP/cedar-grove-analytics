const ALLOWED_EMAIL_DOMAIN = "cedargrovellp.com";

const defaultFormatDbError = (err) =>
  err && err.code ? err.code : "unknown";

export async function authenticateRequest(
  request,
  {
    auth,
    db,
    requireAdminDoc = true,
    logPrefix,
    buildError,
    formatDbError = defaultFormatDbError,
  } = {}
) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, response: buildError(401) };
  }

  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    return { ok: false, response: buildError(401) };
  }

  let decoded;
  try {
    // firebase-admin@13 takes checkRevoked as a positional boolean.
    decoded = await auth.verifyIdToken(idToken, true);
  } catch (err) {
    console.warn(
      `${logPrefix}: token verification failed:`,
      err && err.code ? err.code : "unknown"
    );
    return { ok: false, response: buildError(401) };
  }

  const email =
    typeof decoded.email === "string" ? decoded.email.toLowerCase() : null;
  if (!email || decoded.email_verified !== true) {
    return { ok: false, response: buildError(403) };
  }
  if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    return { ok: false, response: buildError(403) };
  }

  if (requireAdminDoc) {
    try {
      const adminDoc = await db.collection("admins").doc(email).get();
      if (!adminDoc.exists) {
        return { ok: false, response: buildError(403) };
      }
    } catch (err) {
      console.error(`${logPrefix}: admin lookup failed:`, formatDbError(err));
      return { ok: false, response: buildError(500) };
    }
  }

  return { ok: true, email, decoded };
}
