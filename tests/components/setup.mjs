// Shared setup for the vitest component suite (see vitest.config.mjs).
//
// The single blocker to rendering any component in jsdom is that
// src/firebase/config.js initializes the Firebase client SDK at module load
// (initializeApp/getFirestore/getAuth with env-derived config). Mock it here,
// once, so every component test can import components that transitively pull
// in `@/firebase/config` without touching the real SDK.
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('@/firebase/config', () => {
  const auth = { currentUser: null };
  const db = { __fake: 'firestore' };
  return {
    auth,
    db,
    waitForAuth: vi.fn(() => Promise.resolve(null)),
  };
});

afterEach(() => {
  cleanup();
});
