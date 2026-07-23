import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// Cache the initialized admin app at module scope so we don't re-parse the
// service-account JSON on every cold-start invocation of a route handler.
let cachedApp = null;

function getAdminApp() {
  if (cachedApp) return cachedApp;

  // Reuse an existing app if one was initialized elsewhere in this process
  // (e.g., by a different module on the same cold start).
  if (getApps().length > 0) {
    cachedApp = getApps()[0];
    return cachedApp;
  }

  // --- E2E TEST-ONLY EMULATOR WIRING ---------------------------------------
  // Under `firebase emulators:exec` (npm run test:e2e) the emulator host env
  // vars are set and GCLOUD_PROJECT is the demo project. Initialize without
  // service-account credentials so verifyIdToken audiences and Firestore
  // reads match the emulator's `demo-cedar-grove` namespace. These env vars
  // are never set in production deployments, so this branch is unreachable
  // there.
  if (
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  ) {
    cachedApp = initializeApp({
      projectId: process.env.GCLOUD_PROJECT || "demo-cedar-grove",
    });
    return cachedApp;
  }
  // -------------------------------------------------------------------------

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not configured");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    // Do NOT include the raw env-var contents in the thrown error — the
    // service-account JSON contains a private key.
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON");
  }

  cachedApp = initializeApp({
    credential: cert(serviceAccount),
  });
  return cachedApp;
}

function getAdminDb() {
  return getFirestore(getAdminApp());
}

function getAdminAuth() {
  return getAuth(getAdminApp());
}

export { getAdminDb, getAdminAuth };
