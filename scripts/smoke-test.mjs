import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../functions/lib/crypto.js';
import { readFirebaseSession } from '../functions/lib/admin-session.js';
import { generateKeyPairSync } from 'node:crypto';
import { getFirebaseSigningKey } from '../functions/lib/firebase-key.js';
import { assertFirestoreDocumentFits, estimateFirestoreDocumentSizeBytes, FIRESTORE_DOCUMENT_LIMIT_BYTES, FIRESTORE_DOCUMENT_MAX_SAFE_BYTES } from '../functions/lib/firestore-document-size.js';

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

// Firestore document-size accounting includes the document path, field names,
// UTF-8 string sizes, and document overhead. The server must reject oversize writes.
assert.equal(FIRESTORE_DOCUMENT_LIMIT_BYTES, 1024 * 1024, 'document limit must be 1 MiB');
assert.equal(FIRESTORE_DOCUMENT_MAX_SAFE_BYTES, (1024 * 1024) - 4, 'REST writes keep a 4-byte safety margin');
assert.equal(estimateFirestoreDocumentSizeBytes({ name: 'A' }, 'puppies/test'), 68, 'small document estimate includes path and overhead');
assert.ok(estimateFirestoreDocumentSizeBytes({ name: 'é🐶' }, 'puppies/test') > estimateFirestoreDocumentSizeBytes({ name: 'A' }, 'puppies/test'), 'size estimate counts UTF-8 bytes');
const maxAllowedCover = 'data:image/jpeg;base64,' + Buffer.alloc(240 * 1024).toString('base64');
assert.ok(estimateFirestoreDocumentSizeBytes({ slug: 'sample-puppy', name: 'Sample', image: maxAllowedCover, imageSizeBytes: 240 * 1024 }, 'puppies/sample-puppy') < FIRESTORE_DOCUMENT_MAX_SAFE_BYTES, 'the configured 240 KiB image cap leaves room for listing fields');
assert.throws(
  () => assertFirestoreDocumentFits({ image: 'x'.repeat(1024 * 1024) }, 'puppies/oversize'),
  /too large to save/,
  'documents above the 1 MiB cap must be rejected before writes'
);

// Regression guard: Cloudflare places remoteAddress on the SocketInfo returned by `opened`.
const smtpSource = await (await import('node:fs/promises')).readFile(new URL('../functions/lib/smtp.js', import.meta.url), 'utf8');
assert.match(smtpSource, /const socketInfo = await withTimeout\(socket\.opened/,'SMTP connection must capture SocketInfo from socket.opened');
assert.match(smtpSource, /const remoteAddress = socketInfo\?\.remoteAddress/,'SMTP peer validation must read the remote address from SocketInfo');
assert.doesNotMatch(smtpSource, /socket\.remoteAddress/,'SMTP code must not read remoteAddress directly from Socket');

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


// Individual puppy profiles intentionally omit the enquiry/contact-form section.
const puppyHtml = await (await import('node:fs/promises')).readFile(new URL('../puppy.html', import.meta.url), 'utf8');
const puppyDetailScript = await (await import('node:fs/promises')).readFile(new URL('../assets/js/puppy-detail.js', import.meta.url), 'utf8');
assert.doesNotMatch(puppyHtml, /id="puppy-enquiry-section"|id="puppy-enquiry-form"|Take the next little step|Ask us about|Send an enquiry|No pressure\. Just a conversation\./, 'opened puppy profiles must not render the removed enquiry section');

const { onRequest: socialMetadataMiddleware } = await import('../functions/_middleware.js');
let rewrittenContactRequestUrl = '';
const contactRouteResponse = await socialMetadataMiddleware({
  request: new Request('https://example.test/contact/sample-puppy'),
  next: async (request) => {
    rewrittenContactRequestUrl = request instanceof Request ? request.url : String(request);
    return new Response('template', { status: 200, headers: { 'content-type': 'text/plain' } });
  },
  env: {}
});
assert.equal(new URL(rewrittenContactRequestUrl).pathname, '/contact/index.html', 'contact route must rewrite to the shared HTML template in middleware');
assert.equal(contactRouteResponse.status, 200, 'contact route middleware should return the shared template response');
assert.match((await import('node:fs/promises')).readFile ? await (await import('node:fs/promises')).readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8') : '', /element\.setAttribute\('data-contact-slug', contactSlug\)/, 'middleware should stamp the original slug on the served contact template');
const puppyContactHtml = await (await import('node:fs/promises')).readFile(new URL('../contact/index.html', import.meta.url), 'utf8');
const puppyContactJs = await (await import('node:fs/promises')).readFile(new URL('../assets/js/puppy-contact.js', import.meta.url), 'utf8');
const contactApiSource = await (await import('node:fs/promises')).readFile(new URL('../functions/api/contact.js', import.meta.url), 'utf8');
const contactEmailSource = await (await import('node:fs/promises')).readFile(new URL('../functions/lib/contact-email.js', import.meta.url), 'utf8');
assert.match(puppyHtml, /id="puppy-enquiry-cta" href="\/contact\/"/, 'puppy contact CTA should point to the listing-specific contact route');
assert.match(puppyContactHtml, /name="shippingAddress"[\s\S]*class="form-field form-field-full"[\s\S]*name="postalCode"[\s\S]*name="preferredPaymentMethod"/, 'puppy contact page should collect shipping and payment preferences, with a full-width postal code field');
assert.doesNotMatch(puppyContactHtml, /id="shipping-country"|name="country"|>Country/, 'puppy contact page should not show a country field');
const puppyContactCss = await (await import('node:fs/promises')).readFile(new URL('../assets/css/puppy-contact.css', import.meta.url), 'utf8');
assert.match(puppyContactCss, /\.puppy-contact-intro h1 \{[^}]*max-width:none;[^}]*text-align:center;/, 'puppy contact heading should be centered without the site-wide h1 max-width offset');
assert.match(puppyContactCss, /\.puppy-contact-form \.form-field-full \{[^}]*width:100%;/, 'postal code form field should take full width');
assert.doesNotMatch(puppyContactJs, /form\.elements\.country|country:\s*form\.elements/, 'contact form client should no longer validate or submit a country field');
assert.doesNotMatch(contactApiSource, /city\.length < 2 \|\| country\.length < 2/, 'server should not require a country field for puppy enquiries');
assert.match(puppyContactHtml, /class="site-header"[\s\S]*class="site-footer"/, 'puppy contact page should share the site header and footer');
assert.match(puppyContactJs, /fetch\('\/api\/puppies\?slug='/, 'puppy contact page should load the selected listing');
assert.match(contactApiSource, /enquiryType === 'puppy-contact'[\s\S]*getPrivateDocument\(context\.env, `puppies\/\$\{puppySlug\}`\)/, 'server should validate puppy contact submissions against a real listing');
assert.match(contactEmailSource, /Preferred payment method[\s\S]*Shipping address/, 'contact notification should include structured shipping and payment details');

assert.doesNotMatch(puppyHtml, /<small>Coat<\/small>|id="puppy-coat"/, 'puppy detail facts must not show the removed Coat item');
assert.match(puppyHtml, /id="puppy-gender-icon"[^>]*>⚥<\/span>/, 'gender detail should have its own gender icon');
assert.match(puppyDetailScript, /normalizedGender[\s\S]*textContent = '♂'[\s\S]*textContent = '♀'/, 'gender icon should match male/female values');
assert.match((await (await import('node:fs/promises')).readFile(new URL('../assets/css/puppy-detail.css', import.meta.url), 'utf8')), /\.profile-facts \{ display: grid; grid-template-columns: repeat\(2, minmax\(0,1fr\)\)/, 'puppy detail facts should use a two-column layout after removing Coat');

assert.match(puppyHtml, /id="puppy-enquiry-cta" href="\/contact\/"/, 'the puppy contact CTA should route to the listing-specific contact page');
assert.doesNotMatch(puppyDetailScript, /puppy-enquiry-section|enquiry-puppy-name|profile-subject/, 'puppy profile JavaScript must not depend on the removed form');
assert.match(puppyHtml, /class="site-navigation-loader is-visible"/, 'puppy detail page must start with its full-screen loader visible');
assert.match(puppyDetailScript, /await waitForImageReady\(galleryMainImage, 12000\)/, 'puppy loader should wait for the primary listing image');
assert.match(puppyDetailScript, /finally\s*\{[\s\S]*papillon:puppy-detail-ready/, 'puppy page should always report ready after content or fallback state is rendered');
const navigationLoaderScript = await (await import('node:fs/promises')).readFile(new URL('../assets/js/navigation-loading.js', import.meta.url), 'utf8');
assert.match(navigationLoaderScript, /papillon:puppy-detail-ready/, 'navigation loader should only dismiss on the details readiness event');
assert.match(navigationLoaderScript, /if \(isPuppyDetailPage\)[\s\S]*papillon:puppy-detail-ready/, 'puppy details must bypass the ordinary navigation maximum timer');

const publicScript = await (await import('node:fs/promises')).readFile(new URL('../assets/js/script.js', import.meta.url), 'utf8');
const publicStyles = await (await import('node:fs/promises')).readFile(new URL('../assets/css/styles.css', import.meta.url), 'utf8');
assert.match(publicScript, /function renderEmptyPuppyState\(\)/, 'homepage should have a dedicated empty-listing state renderer');
assert.match(publicScript, /heading\.textContent = 'No puppy listings yet'/, 'empty listing state should use the requested heading');
assert.match(publicScript, /if \(!publicPuppies\.length\)\s*\{\s*renderEmptyPuppyState\(\);/, 'empty listing response should render the dedicated state');
assert.match(publicStyles, /\.puppy-empty-state\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s, 'empty state should span the full puppy grid width');

const puppyApi = await (await import('node:fs/promises')).readFile(new URL('../functions/api/puppies.js', import.meta.url), 'utf8');
assert.match(puppyApi, /assertFirestoreDocumentFits\(mainFields, `puppies\/\$\{slug\}`/, 'server validates the main listing document size');
assert.match(puppyApi, /assertFirestoreDocumentFits\(galleryFields, `puppies\/\$\{slug\}\/gallery\/\$\{photoId\}`/, 'server validates each gallery document size');
assert.ok(dashboardScript.includes("estimateDocumentSizeBytes(estimatedMainDocument, 'puppies/' + slug)"), 'dashboard preflights the main document size before submit');
console.log('Smoke tests passed: SMTP encryption/decryption, Firebase private-key parsing, Firebase-authenticated dashboard access, contact-route middleware rewrite, public no-listings state, removed profile enquiry section, and Firestore 1 MiB document-size guards.');
