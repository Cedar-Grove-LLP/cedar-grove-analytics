import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticateRequest } from '../src/app/api/_lib/authGate.js';

const buildError = (status) => {
  const error =
    status === 401
      ? 'Unauthorized'
      : status === 403
        ? 'Forbidden'
        : 'Internal error';
  return Response.json({ success: false, error }, { status });
};

const requestWithAuthorization = (authorization) =>
  new Request('http://localhost/api/test', {
    headers: authorization === undefined ? {} : { authorization },
  });

const verifiedToken = (email = 'admin@cedargrovellp.com') => ({
  email,
  email_verified: true,
});

const authResolving = (decoded = verifiedToken()) => ({
  verifyIdToken: async () => decoded,
});

const dbWithAdmin = (exists = true) => ({
  collection: () => ({
    doc: () => ({
      get: async () => ({ exists }),
    }),
  }),
});

async function assertRejected(result, status) {
  assert.equal(result.ok, false);
  assert.equal(result.response.status, status);
  const error =
    status === 401
      ? 'Unauthorized'
      : status === 403
        ? 'Forbidden'
        : 'Internal error';
  assert.deepEqual(await result.response.json(), {
    success: false,
    error,
  });
}

const authenticate = (request, overrides = {}) =>
  authenticateRequest(request, {
    auth: authResolving(),
    db: dbWithAdmin(),
    logPrefix: 'auth-gate-test',
    buildError,
    ...overrides,
  });

test('missing Authorization header returns 401', async () => {
  const result = await authenticate(requestWithAuthorization());
  await assertRejected(result, 401);
});

test('non-Bearer Authorization scheme returns 401', async () => {
  const result = await authenticate(requestWithAuthorization('Basic xyz'));
  await assertRejected(result, 401);
});

test('Bearer header with an empty token returns 401', async () => {
  const result = await authenticate(requestWithAuthorization('Bearer    '));
  await assertRejected(result, 401);
});

test('token verification failure returns 401 rather than 500', async () => {
  const auth = {
    verifyIdToken: async () => {
      throw new Error('invalid token');
    },
  };
  const result = await authenticate(
    requestWithAuthorization('Bearer invalid'),
    { auth }
  );
  await assertRejected(result, 401);
});

test('verifyIdToken receives token and positional checkRevoked boolean', async () => {
  let capturedArgs;
  const auth = {
    verifyIdToken: async (...args) => {
      capturedArgs = args;
      return verifiedToken();
    },
  };

  const result = await authenticate(
    requestWithAuthorization('Bearer token-value'),
    { auth }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(capturedArgs, ['token-value', true]);
  assert.equal(typeof capturedArgs[1], 'boolean');
});

test('decoded token without an email returns 403', async () => {
  const result = await authenticate(
    requestWithAuthorization('Bearer token'),
    { auth: authResolving({ email_verified: true }) }
  );
  await assertRejected(result, 403);
});

test('decoded token without explicitly verified email returns 403', async () => {
  for (const emailVerified of [false, undefined]) {
    const result = await authenticate(
      requestWithAuthorization('Bearer token'),
      {
        auth: authResolving({
          email: 'admin@cedargrovellp.com',
          email_verified: emailVerified,
        }),
      }
    );
    await assertRejected(result, 403);
  }
});

test('verified email from a lookalike domain returns 403', async () => {
  // The leading @ in the suffix check prevents notcedargrovellp.com matching.
  const result = await authenticate(
    requestWithAuthorization('Bearer token'),
    { auth: authResolving(verifiedToken('evil@notcedargrovellp.com')) }
  );
  await assertRejected(result, 403);
});

test('domain user without an admins document returns 403', async () => {
  const result = await authenticate(
    requestWithAuthorization('Bearer token'),
    { db: dbWithAdmin(false) }
  );
  await assertRejected(result, 403);
});

test('admins document lookup failure returns 500 rather than 403', async () => {
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => {
          throw new Error('database unavailable');
        },
      }),
    }),
  };
  const result = await authenticate(
    requestWithAuthorization('Bearer token'),
    { db }
  );
  await assertRejected(result, 500);
});

test('email is lower-cased before the admins document lookup', async () => {
  let collectionName;
  let documentId;
  const db = {
    collection: (name) => {
      collectionName = name;
      return {
        doc: (id) => {
          documentId = id;
          return {
            get: async () => ({ exists: true }),
          };
        },
      };
    },
  };

  const result = await authenticate(
    requestWithAuthorization('Bearer token'),
    {
      auth: authResolving(verifiedToken('Foo@CedarGroveLLP.com')),
      db,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(collectionName, 'admins');
  assert.equal(documentId, 'foo@cedargrovellp.com');
});

test('requireAdminDoc false skips Firestore and permits a domain user', async () => {
  const result = await authenticateRequest(
    requestWithAuthorization('Bearer token'),
    {
      auth: authResolving(),
      requireAdminDoc: false,
      logPrefix: 'auth-gate-test',
      buildError,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.email, 'admin@cedargrovellp.com');
});

test('verified admin succeeds with lower-cased email and decoded token', async () => {
  const decoded = verifiedToken('Admin@CedarGroveLLP.com');
  const result = await authenticate(
    requestWithAuthorization('Bearer token'),
    { auth: authResolving(decoded) }
  );

  assert.equal(result.ok, true);
  assert.equal(result.email, 'admin@cedargrovellp.com');
  assert.equal(result.decoded, decoded);
});
