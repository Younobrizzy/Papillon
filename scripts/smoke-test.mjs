import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../functions/lib/crypto.js';
import { readFirebaseSession } from '../functions/lib/admin-session.js';
import { generateKeyPairSync } from 'node:crypto';
import { getFirebaseSigningKey } from '../functions/lib/firebase-key.js';

// Firebase service-account key parsing accepts common Cloudflare secret formats.
const { privateKey: generatedPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const validPem = generatedPrivateKey.export({ type: 'pkcs8', format: 'pem' });
const keyVariants = [
  validPem,
  validPem.replace(/\n/g, '\\n'),
  JSON.stringify(validPem),
  JSON.stringify({ type: 'service_account', client_email: 'smoke-test@example.iam.gserviceaccount.com', private_key: validPem })
];
for (const keyValue of keyVariants) {
  const signingKey = await getFirebaseSigningKey({
    FIREBASE_CLIENT_EMAIL: 'smoke-test@example.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: keyValue
  });
  assert.ok(signingKey, 'a valid service-account private key format should import');
}
await assert.rejects(
  () => getFirebaseSigningKey({ FIREBASE_CLIENT_EMAIL: 'smoke-test@example.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: 'not-a-private-key' }),
  /complete PKCS#8 private_key PEM/,
  'malformed private key values should return a clear configuration error'
);

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


// Dashboard-facing copy must not expose internal storage implementation details.
const dashboardHtml = await (await import('node:fs/promises')).readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8');
const dashboardScript = await (await import('node:fs/promises')).readFile(new URL('../assets/js/dashboard.js', import.meta.url), 'utf8');
const preferencesApi = await (await import('node:fs/promises')).readFile(new URL('../functions/api/preferences.js', import.meta.url), 'utf8');
assert.match(dashboardHtml, /role="tablist"[^>]*aria-label="Preference categories"/, 'preferences must have an accessible tab list');
assert.match(dashboardHtml, /data-preference-tab="site"/, 'site details tab should exist');
assert.match(dashboardHtml, /data-preference-tab="smtp"/, 'SMTP setup should have its own tab');
assert.match(dashboardHtml, /id="preferences-panel-smtp"[^>]*data-preference-panel="smtp" hidden/, 'SMTP fields must be grouped in a separate, initially hidden panel');
assert.match(dashboardHtml, /id="preference-smtp-host"/, 'SMTP host field should remain available in the SMTP tab');
assert.match(dashboardHtml, /id="preferences-save-button"/, 'preferences form must retain a save action for the selected tab');
assert.doesNotMatch(dashboardHtml, /firestore/i, 'dashboard HTML copy should not mention the storage backend');
assert.doesNotMatch(dashboardScript, /firestore/i, 'dashboard script should not expose the storage backend in UI copy or labels');
assert.doesNotMatch(preferencesApi, /message:\s*['"]Preferences saved to Firestore/i, 'preferences success feedback should not mention the storage backend');


const publicScript = await (await import('node:fs/promises')).readFile(new URL('../assets/js/script.js', import.meta.url), 'utf8');
const publicStyles = await (await import('node:fs/promises')).readFile(new URL('../assets/css/styles.css', import.meta.url), 'utf8');
assert.match(publicScript, /function renderEmptyPuppyState\(\)/, 'homepage should have a dedicated empty-listing state renderer');
assert.match(publicScript, /heading\.textContent = 'No puppy listings yet'/, 'empty listing state should use the requested heading');
assert.match(publicScript, /if \(!publicPuppies\.length\)\s*\{\s*renderEmptyPuppyState\(\);/, 'empty listing response should render the dedicated state');
assert.match(publicStyles, /\.puppy-empty-state\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s, 'empty state should span the full puppy grid width');

console.log('Smoke tests passed: SMTP encryption/decryption, Firebase private-key parsing, Firebase-authenticated dashboard access, and the public no-listings state.');
