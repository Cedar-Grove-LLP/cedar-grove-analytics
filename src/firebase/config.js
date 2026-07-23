import { initializeApp, getApps } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import {
  getAuth,
  onAuthStateChanged,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";

// E2E emulator builds (`npm run build:e2e`) use a fixed demo project config
// so the client talks to the same `demo-cedar-grove` namespace the seed
// script and firebase emulators:exec use — NOT whatever production project
// happens to be in .env.local. NEXT_PUBLIC_USE_FIREBASE_EMULATORS is inlined
// at build time and never set in production builds, so the demo branch is
// dead code (and tree-shaken) in prod.
const firebaseConfig = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === '1'
  ? {
      apiKey: 'demo-api-key',
      authDomain: 'demo-cedar-grove.firebaseapp.com',
      projectId: 'demo-cedar-grove',
    }
  : {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
    };

// Initialize Firebase only once (important for Next.js hot reloading)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);
const auth = getAuth(app);

// --- E2E TEST-ONLY EMULATOR WIRING ---------------------------------------
// NEXT_PUBLIC_USE_FIREBASE_EMULATORS is inlined at BUILD time by Next.js and
// is only ever set by the `build:e2e` script — it is never set in production
// builds, so this entire block is dead code (and tree-shaken) in prod.
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);

  if (typeof window !== 'undefined') {
    // Test-only hook so Playwright can sign in with email/password against
    // the Auth emulator instead of driving the Google OAuth popup.
    window.__testAuth = {
      auth,
      signInWithEmailAndPassword,
      createUserWithEmailAndPassword,
    };
  }
}
// -------------------------------------------------------------------------

// Auth state promise
let authReadyPromise = null;
let authReadyResolve = null;

if (typeof window !== 'undefined') {
  authReadyPromise = new Promise((resolve) => {
    authReadyResolve = resolve;
  });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      authReadyResolve(user);
    } else {
      // No anonymous sign-in - site requires proper authentication
      console.log("No user signed in");
      authReadyResolve(null);
    }
  });
}

export const waitForAuth = () => {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }
  return authReadyPromise;
};

export { db, auth };