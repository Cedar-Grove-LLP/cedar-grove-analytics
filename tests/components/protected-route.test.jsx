// Component tests for src/components/ProtectedRoute.js — the render-vs-redirect
// behavior that the pure decideRoute tests (tests/authz-logic.test.mjs) cannot
// cover: that the component actually renders children on 'allow', renders
// nothing AND pushes the right URL on 'redirect', and shows the auth spinner
// while loading. AuthContext/FirestoreDataContext/next-navigation are mocked;
// the decision logic itself is the real decideRoute from utils/authzLogic.mjs.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProtectedRoute from '@/components/ProtectedRoute';

const h = vi.hoisted(() => ({
  push: null, // assigned per-test in renderGuard
  authValue: {},
  cacheUsers: [],
  cacheLoading: false,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push }),
  redirect: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => h.authValue,
}));

vi.mock('@/context/FirestoreDataContext', () => ({
  useFirestoreCache: () => ({ users: h.cacheUsers, loading: h.cacheLoading }),
}));

const baseAuth = {
  user: null,
  isAdmin: false,
  isPartialAdmin: false,
  isAuthorized: false,
  loading: false,
  userEmail: null,
};

// Personas (userEmail is pre-lowercased, matching AuthContext's contract)
const signedOut = {};
const anonymous = { user: { isAnonymous: true }, isAuthorized: true };
const unauthorizedDomain = {
  user: { isAnonymous: false, email: 'jane@gmail.com' },
  isAuthorized: false,
  userEmail: 'jane@gmail.com',
};
const plainUser = {
  user: { isAnonymous: false, email: 'Jane@cedargrovellp.com' },
  isAuthorized: true,
  userEmail: 'jane@cedargrovellp.com',
};
const partialAdmin = { ...plainUser, isPartialAdmin: true };
const fullAdmin = { ...plainUser, isAdmin: true };

const janeDoc = { id: 'Jane Doe', name: 'Jane Doe', email: 'Jane@cedargrovellp.com' };

function renderGuard(persona, props = {}, users = [], usersLoading = false) {
  h.authValue = { ...baseAuth, ...persona };
  h.cacheUsers = users;
  h.cacheLoading = usersLoading;
  h.push = vi.fn();
  render(
    <ProtectedRoute {...props}>
      <div data-testid="protected-content">secret</div>
    </ProtectedRoute>
  );
  return h.push;
}

function expectAllowed(push) {
  expect(screen.getByTestId('protected-content')).toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
}

function expectRedirect(push, url) {
  expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  expect(push).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenCalledWith(url);
}

const FLAG_COMBOS = [
  {},
  { requireAdmin: true },
  { denyPartialAdmin: true },
  { requireAdmin: true, denyPartialAdmin: true },
  { allowedAttorneyName: 'Jane Doe' },
];

beforeEach(() => {
  h.authValue = { ...baseAuth };
  h.cacheUsers = [];
  h.cacheLoading = false;
});

describe('loading state', () => {
  test.each(FLAG_COMBOS)('shows the auth spinner and neither renders nor redirects (flags %j)', (flags) => {
    const push = renderGuard({ loading: true }, flags);
    expect(screen.getByText('Checking authentication...')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('signed-out / anonymous / unauthorized personas redirect to /login for every flag combo', () => {
  for (const [label, persona] of [
    ['signed out', signedOut],
    ['anonymous', anonymous],
    ['unauthorized domain', unauthorizedDomain],
  ]) {
    test.each(FLAG_COMBOS)(`${label} (flags %j)`, (flags) => {
      const push = renderGuard(persona, flags, [janeDoc]);
      expectRedirect(push, '/login');
    });
  }
});

describe('plain authorized user', () => {
  test('no flags: renders children', () => {
    expectAllowed(renderGuard(plainUser));
  });

  test('requireAdmin: redirects to /login?error=admin_required', () => {
    expectRedirect(renderGuard(plainUser, { requireAdmin: true }), '/login?error=admin_required');
  });

  test('requireAdmin + denyPartialAdmin: still admin_required', () => {
    expectRedirect(
      renderGuard(plainUser, { requireAdmin: true, denyPartialAdmin: true }),
      '/login?error=admin_required'
    );
  });

  test('denyPartialAdmin alone: allowed (not a partial admin)', () => {
    expectAllowed(renderGuard(plainUser, { denyPartialAdmin: true }));
  });

  test('own attorney page (email matches user doc): allowed', () => {
    expectAllowed(renderGuard(plainUser, { allowedAttorneyName: 'Jane Doe' }, [janeDoc]));
  });

  test("someone else's attorney page: redirects to access_denied", () => {
    const users = [janeDoc, { id: 'John Roe', name: 'John Roe', email: 'john@cedargrovellp.com' }];
    expectRedirect(
      renderGuard(plainUser, { allowedAttorneyName: 'John Roe' }, users),
      '/login?error=access_denied'
    );
  });

  test('attorney page with no matching user doc: access_denied', () => {
    expectRedirect(
      renderGuard(plainUser, { allowedAttorneyName: 'Ghost Attorney' }, [janeDoc]),
      '/login?error=access_denied'
    );
  });

  test('attorney doc exists but has no email: access_denied', () => {
    expectRedirect(
      renderGuard(plainUser, { allowedAttorneyName: 'Jane Doe' }, [{ id: 'Jane Doe', name: 'Jane Doe' }]),
      '/login?error=access_denied'
    );
  });

  test('attorney matched by doc id when name is absent', () => {
    expectAllowed(
      renderGuard(plainUser, { allowedAttorneyName: 'Jane Doe' }, [
        { id: 'Jane Doe', email: 'JANE@cedargrovellp.com' },
      ])
    );
  });
});

describe('partial admin', () => {
  test('no flags: allowed', () => {
    expectAllowed(renderGuard(partialAdmin));
  });

  test('requireAdmin: allowed (partial admins pass the admin gate)', () => {
    expectAllowed(renderGuard(partialAdmin, { requireAdmin: true }));
  });

  test('requireAdmin + denyPartialAdmin: redirects to /admin', () => {
    expectRedirect(
      renderGuard(partialAdmin, { requireAdmin: true, denyPartialAdmin: true }),
      '/admin'
    );
  });

  test('denyPartialAdmin alone: redirects to /admin', () => {
    expectRedirect(renderGuard(partialAdmin, { denyPartialAdmin: true }), '/admin');
  });

  test("someone else's attorney page: access_denied (partial admin is not full admin)", () => {
    expectRedirect(
      renderGuard(partialAdmin, { allowedAttorneyName: 'John Roe' }, [
        { id: 'John Roe', name: 'John Roe', email: 'john@cedargrovellp.com' },
      ]),
      '/login?error=access_denied'
    );
  });
});

describe('full admin', () => {
  test.each(FLAG_COMBOS)('allowed for every flag combo (flags %j)', (flags) => {
    // No users passed: admins bypass the attorney-page email match entirely.
    expectAllowed(renderGuard(fullAdmin, flags));
  });
});

describe('users-cache race on attorney pages (fixed: wait, do not bounce)', () => {
  // Direct-loading one's own /users page used to redirect to
  // /login?error=access_denied because the email match ran against the
  // still-empty users cache. The guard now waits for the cache before
  // treating a failed match as a deny.

  test('cache still loading: shows the auth spinner, neither renders nor redirects', () => {
    const push = renderGuard(plainUser, { allowedAttorneyName: 'Jane Doe' }, [], true);
    expect(screen.getByText('Checking authentication...')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  test('partial admin, own page, cache still loading: spinner, no redirect', () => {
    const push = renderGuard(partialAdmin, { allowedAttorneyName: 'Jane Doe' }, [], true);
    expect(screen.getByText('Checking authentication...')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  test('partial admin, own page, cache loaded with their doc: renders', () => {
    expectAllowed(renderGuard(partialAdmin, { allowedAttorneyName: 'Jane Doe' }, [janeDoc]));
  });

  test('own doc already in a still-loading cache: renders (positive match is definitive)', () => {
    expectAllowed(renderGuard(plainUser, { allowedAttorneyName: 'Jane Doe' }, [janeDoc], true));
  });

  test("definitive deny after the cache loads: someone else's page still bounces", () => {
    const users = [janeDoc, { id: 'John Roe', name: 'John Roe', email: 'john@cedargrovellp.com' }];
    expectRedirect(
      renderGuard(plainUser, { allowedAttorneyName: 'John Roe' }, users, false),
      '/login?error=access_denied'
    );
  });

  test('unauthenticated user redirects immediately even while the cache loads', () => {
    expectRedirect(renderGuard(signedOut, { allowedAttorneyName: 'Jane Doe' }, [], true), '/login');
  });

  test('admin gate is not delayed by the cache loading', () => {
    expectRedirect(
      renderGuard(plainUser, { requireAdmin: true }, [], true),
      '/login?error=admin_required'
    );
  });
});
