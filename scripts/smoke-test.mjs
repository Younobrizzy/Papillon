import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../functions/lib/crypto.js';
import { readFirebaseSession } from '../functions/lib/admin-session.js';

const env = { SMTP_ENCRYPTION_KEY: 'local-test-key-do-not-use-in-production-2026' };
const secret = 'smtp-password-for-test-only';
const encrypted = await encryptSecret(secret, env);
assert.ok(encrypted.ciphertext && encrypted.iv, 'encryption returns ciphertext and IV');
assert.notEqual(encrypted.ciphertext, secret, 'ciphertext must not be plaintext');
assert.equal(await decryptSecret(encrypted.ciphertext, encrypted.iv, env), secret, 'AES-GCM round-trip succeeds');
await assert.rejects(
  () => decryptSecret(encrypted.ciphertext, encrypted.iv, { SMTP_ENCRYPTION_KEY: 'a-different-test-key-for-failure-case' }),
  /Unable to decrypt the saved SMTP password/,
  'changing the key must make old ciphertext unreadable'
);
await assert.rejects(
  () => encryptSecret(secret, { SMTP_ENCRYPTION_KEY: 'short' }),
  /at least 16 characters/,
  'short encryption keys must be rejected'
);
// Firebase Authentication alone gates dashboard access. A verified account is
// accepted without making an extra Firestore/admin-document request.
const originalFetch = globalThis.fetch;
let authFetchCalls = 0;
let lastAuthUrl = '';
let mockFirebaseUser = { localId: 'firebase-user-123', email: 'member@example.com' };
globalThis.fetch = async (input) => {
  authFetchCalls += 1;
  lastAuthUrl = String(input);
  return new Response(JSON.stringify({ users: mockFirebaseUser ? [mockFirebaseUser] : [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
try {
  const noToken = await readFirebaseSession(new Request('https://example.test/api/admin-session'), { FIREBASE_API_KEY: 'test-api-key' });
  assert.equal(noToken, null, 'a missing ID token must not authenticate');
  assert.equal(authFetchCalls, 0, 'no-token requests must not call Firebase');

  const session = await readFirebaseSession(new Request('https://example.test/api/admin-session', {
    headers: { Authorization: 'Bearer valid-test-id-token' }
  }), { FIREBASE_API_KEY: 'test-api-key' });
  assert.deepEqual(session, { uid: 'firebase-user-123', email: 'member@example.com' }, 'any valid Firebase user can access the dashboard');
  assert.equal(authFetchCalls, 1, 'authentication should make one Firebase token/user lookup');
  assert.match(lastAuthUrl, /identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/, 'ID token is checked with Firebase Authentication');
  assert.doesNotMatch(lastAuthUrl, /firestore\.googleapis\.com|admins/, 'no Firestore admins allowlist is queried');

  mockFirebaseUser = { localId: 'disabled-user', email: 'disabled@example.com', disabled: true };
  const disabledSession = await readFirebaseSession(new Request('https://example.test/api/admin-session', {
    headers: { Authorization: 'Bearer disabled-user-token' }
  }), { FIREBASE_API_KEY: 'test-api-key' });
  assert.equal(disabledSession, null, 'disabled Firebase Authentication users must be rejected');
  assert.equal(authFetchCalls, 2, 'disabled-user validation only checks Firebase Authentication');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Smoke tests passed: SMTP encryption/decryption, key validation, and Firebase-authenticated dashboard access without an admins document.');
