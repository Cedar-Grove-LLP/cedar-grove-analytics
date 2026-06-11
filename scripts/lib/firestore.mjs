import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Initialize firebase-admin for scripts, mirroring the credential convention
 * of src/firebase/admin.js (FIREBASE_SERVICE_ACCOUNT_KEY = service-account
 * JSON as a string) and additionally supporting GOOGLE_APPLICATION_CREDENTIALS
 * (path to a key file) via application-default credentials.
 *
 * The Admin SDK bypasses Firestore security rules — these scripts must only
 * be run by trusted operators against credentials they are authorized to use.
 */
export function getDb() {
  if (getApps().length > 0) {
    return getFirestore();
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch {
      // Never echo the raw value — it is a credential.
      throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON');
    }
    initializeApp({ credential: cert(serviceAccount) });
    return getFirestore();
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || undefined,
    });
    return getFirestore();
  }

  throw new Error(
    'No Firebase credentials found. Either:\n' +
    '  1. Put FIREBASE_SERVICE_ACCOUNT_KEY=\'{"type":"service_account",...}\' in .env.local\n' +
    '     (the scripts load .env.local automatically; the file is gitignored), or\n' +
    '  2. Export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json\n' +
    '     (optionally with NEXT_PUBLIC_FIREBASE_PROJECT_ID for the project ID).'
  );
}
