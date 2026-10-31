import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, encryptSmtpPassword, decryptSmtpPassword, isValidSmtpEncryptionKey } from '../functions/lib/crypto.js';
import { readFirebaseSession } from '../functions/lib/admin-session.js';
import { generateKeyPairSync } from 'node:crypto';
import { getFirebaseSigningKey, getFirebaseServiceAccount } from '../functions/lib/firebase-key.js';
import { assertFirestoreDocumentFits, estimateFirestoreDocumentSizeBytes, FIRESTORE_DOCUMENT_LIMIT_BYTES, FIRESTORE_DOCUMENT_MAX_SAFE_BYTES } from '../functions/lib/firestore-document-size.js';

// Firebase service-account JSON is the only server credential binding.
const { privateKey: generatedPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const validPem = generatedPrivateKey.export({ type: 'pkcs8', format: 'pem' });
const serviceAccount = {
  type: 'service_account',
  project_id: 'papillonandco-98c22',
  client_email: 'smoke-test@example.iam.gserviceaccount.com',
  private_key: validPem
};
const serviceAccountVariants = [
  JSON.stringify(serviceAccount),
  JSON.stringify({ ...serviceAccount, private_key: validPem.replace(/\n/g, '\\n') })
];
for (const serviceAccountJson of serviceAccountVariants) {
  const env = { FIREBASE_PROJECT_ID: 'papillonandco-98c22', FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccountJson };
  const parsed = getFirebaseServiceAccount(env);
  assert.equal(parsed.projectId, 'papillonandco-98c22');
  assert.equal(parsed.clientEmail, serviceAccount.client_email);
  assert.ok(await getFirebaseSigningKey(env), 'valid complete service-account JSON imports');
}
await assert.rejects(
  () => getFirebaseSigningKey({ FIREBASE_PROJECT_ID: 'papillonandco-98c22', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...serviceAccount, private_key: 'not-a-private-key' }) }),
  /FIREBASE_SERVICE_ACCOUNT_JSON private_key is not a valid PKCS#8 RSA key/,
  'malformed service-account private keys return a clear configuration error'
);
assert.throws(
  () => getFirebaseServiceAccount({ FIREBASE_PROJECT_ID: 'other-project', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount) }),
  /project_id does not match FIREBASE_PROJECT_ID/,
  'the service account project must match the configured Firebase project'
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
// New SMTP credentials use the exact Movara AES-256-GCM bundle format.
const strictSmtpKey = Buffer.alloc(32, 23).toString('base64');
const strictSmtpEnv = { SMTP_ENCRYPTION_KEY: strictSmtpKey };
assert.equal(isValidSmtpEncryptionKey(strictSmtpKey), true, '32-byte base64 SMTP key must validate');
assert.equal(isValidSmtpEncryptionKey('not-a-key'), false, 'invalid SMTP key must fail validation');
const passwordBundle = await encryptSmtpPassword(strictSmtpEnv, 'Papillon-SMTP-test-password');
assert.deepEqual(Object.keys(passwordBundle).sort(), ['algorithm', 'ciphertext', 'iv', 'version']);
assert.equal(passwordBundle.algorithm, 'AES-256-GCM');
assert.equal(await decryptSmtpPassword(strictSmtpEnv, passwordBundle), 'Papillon-SMTP-test-password');
await assert.rejects(
  () => decryptSmtpPassword({ SMTP_ENCRYPTION_KEY: Buffer.alloc(32, 24).toString('base64') }, passwordBundle),
  /could not be decrypted/,
  'changing SMTP_ENCRYPTION_KEY must make old encrypted SMTP passwords unreadable'
);

// Firebase Authentication verifies identity; requireAdmin() separately checks the admin/{uid} grant.

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
  const noToken = await readFirebaseSession(new Request('https://example.test/api/admin-session'), { FIREBASE_WEB_API_KEY: 'test-api-key' });
  assert.equal(noToken, null, 'a missing ID token must not authenticate');
  assert.equal(authFetchCalls, 0, 'no-token requests must not call Firebase');

  const session = await readFirebaseSession(new Request('https://example.test/api/admin-session', {
    headers: { Authorization: 'Bearer valid-test-id-token' }
  }), { FIREBASE_WEB_API_KEY: 'test-api-key' });
  assert.deepEqual(session, { uid: 'firebase-user-123', email: 'member@example.com' }, 'Firebase ID-token verification should return the verified identity');
  assert.equal(authFetchCalls, 1, 'authentication should make one Firebase token/user lookup');
  assert.match(lastAuthUrl, /identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/, 'ID token is checked with Firebase Authentication');
  assert.doesNotMatch(lastAuthUrl, /firestore\.googleapis\.com|admins/, 'identity verification itself does not replace the separate requireAdmin Firestore check');

  mockFirebaseUser = { localId: 'disabled-user', email: 'disabled@example.com', disabled: true };
  const disabledSession = await readFirebaseSession(new Request('https://example.test/api/admin-session', {
    headers: { Authorization: 'Bearer disabled-user-token' }
  }), { FIREBASE_WEB_API_KEY: 'test-api-key' });
  assert.equal(disabledSession, null, 'disabled Firebase Authentication users must be rejected');
  assert.equal(authFetchCalls, 2, 'disabled-user validation rejects disabled Firebase accounts');
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
assert.match(dashboardHtml, /id="preference-smtp-from-email"/, 'SMTP From email should be configurable');
assert.match(dashboardHtml, /id="smtp-test-button"/, 'dashboard must expose the protected SMTP connection test action');
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
const { buildCustomerConfirmationEmail } = await import('../functions/lib/contact-email.js');
const simpleConfirmation = buildCustomerConfirmationEmail({ name: 'Alex', email: 'alex@example.com', puppy: 'Milo' });
assert.match(simpleConfirmation.text, /^Hello Alex,[\s\S]*Thank you for contacting Papillon & Co\. We have received your message about Milo and will get back to you soon\.[\s\S]*Papillon & Co\.$/, 'customer confirmation should be short, friendly, and mention the enquiry');
assert.doesNotMatch(simpleConfirmation.text, /Reply-To|submit it again|automatic confirmation/i, 'customer confirmation should not contain unnecessary instructions or reply-to details');
assert.match(contactApiSource, /subject: `We received your message \| Papillon & Co\.`,/, 'customer confirmation should use a simple subject');
assert.match(contactApiSource, /fromEmail:\s*smtp\.fromEmail[\s\S]*envelopeFromEmail:\s*smtp\.user[\s\S]*fromName:\s*smtp\.fromName/, 'contact email must use the authenticated SMTP identity for its From header and envelope');
assert.match(contactApiSource, /replyTo:\s*email/, 'the admin notification must set Reply-To to the visitor');
assert.match(contactApiSource, /customerEmail[\s\S]*no Reply-To on system-to-customer mail/, 'customer confirmation must omit Reply-To');
assert.match(contactApiSource, /const messageSubject = \(isPuppyContact[\s\S]*A little hello about \$\{verifiedPuppyName\} 🐾[\s\S]*:\s*subject\)/, 'homepage notifications should use the submitted subject and puppy pages should use a creative listing-name subject');
assert.match(contactApiSource, /listing\?\.title \|\| listing\?\.name/, 'puppy enquiry subject should prefer a listing title and fall back to the listing name');
const smtpTransportSource = await (await import('node:fs/promises')).readFile(new URL('../functions/lib/smtp.js', import.meta.url), 'utf8');
assert.match(smtpTransportSource, /envelopeFromEmail[\s\S]*sendMailFrom\(client, envelopeSender\)/, 'SMTP envelope sender should remain separate from the visible From header');

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
assert.match(publicScript, /function createPuppySkeletonCard\(\)/, 'homepage should build skeleton cards while listing data loads');
assert.match(publicScript, /renderPuppySkeletons\(\)/, 'homepage should render skeleton cards before fetching listings');
assert.match(publicStyles, /@keyframes papillon-skeleton-shimmer/, 'public cards should have a shimmer animation');
assert.match(publicStyles, /\.puppy-image-wrap\.is-loading::before/, 'listing card images should shimmer until the image is loaded');
const puppyDetailStyles = await (await import('node:fs/promises')).readFile(new URL('../assets/css/puppy-detail.css', import.meta.url), 'utf8');
assert.match(puppyDetailStyles, /\.profile-gallery-thumbnails \{[^}]*display: flex;[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;[^}]*scrollbar-width: none;/, 'profile thumbnails should form a horizontal non-wrapping rail with hidden scrollbar');
assert.match(puppyDetailStyles, /\.gallery-thumbnail \{[^}]*aspect-ratio: 1 \/ 1;/, 'profile gallery thumbnails should be square');
assert.match(puppyDetailStyles, /\.gallery-thumbnail\.is-loading::before/, 'gallery thumbnails should shimmer while their images load');
assert.match(puppyContactJs, /Array\.isArray\(puppy\.gallery\)[\s\S]*imageWrap\.classList\.add\('is-loading'\)/, 'selected puppy card should fall back to gallery imagery and shimmer while loading');
assert.match(puppyContactCss, /\.contact-puppy-image-wrap \{[^}]*aspect-ratio:4\/4\.3;/, 'selected puppy card should have an image frame with a stable aspect ratio');

const puppyApi = await (await import('node:fs/promises')).readFile(new URL('../functions/api/puppies.js', import.meta.url), 'utf8');
assert.match(puppyApi, /assertFirestoreDocumentFits\(mainFields, `puppies\/\$\{slug\}`/, 'server validates the main listing document size');
assert.match(puppyApi, /assertFirestoreDocumentFits\(galleryFields, `puppies\/\$\{slug\}\/gallery\/\$\{photoId\}`/, 'server validates each gallery document size');
assert.ok(dashboardScript.includes("estimateDocumentSizeBytes(estimatedMainDocument, 'puppies/' + slug)"), 'dashboard preflights the main document size before submit');
// Deployment/security architecture regression guards.
const fs = await import('node:fs/promises');
const rootRules = await fs.readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const configRules = await fs.readFile(new URL('../config/firestore.rules', import.meta.url), 'utf8');
assert.equal(rootRules, configRules, 'root and compatibility Firestore rules must match');
assert.match(rootRules, /allow read, write:\s*if false;/, 'client Firestore access must be deny-all');
const firebaseConfig = JSON.parse(await fs.readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
assert.equal(firebaseConfig.firestore.rules, 'firestore.rules', 'Firebase CLI must deploy the root deny-all rules');
const adminGuard = await fs.readFile(new URL('../functions/lib/require-admin.js', import.meta.url), 'utf8');
assert.match(adminGuard, /admin\/\$\{user\.uid\}/, 'administrator access must use admin/{uid}');
assert.match(adminGuard, /data\.role === 'admin'/, 'administrator document must grant the admin role');
const smtpConfig = await fs.readFile(new URL('../functions/lib/smtp-config.js', import.meta.url), 'utf8');
assert.match(smtpConfig, /private\/smtp/, 'SMTP settings must use the standalone private/smtp document');
assert.match(smtpConfig, /const record = \{[\s\S]*password: encryptedPassword,[\s\S]*fromEmail,[\s\S]*uid: String\(uid \|\| ''\)/, 'encrypted SMTP password and administrator UID must be saved');
assert.match(smtpConfig, /!suppliedPassword && legacyPreferences\?\.smtp/, 'a newly supplied password must bypass unreadable legacy SMTP ciphertext');
const smtpSaveBlock = smtpConfig.slice(smtpConfig.indexOf('const record = {'), smtpConfig.indexOf('await setPrivateDocument(env, SMTP_PATH, record)'));
assert.doesNotMatch(smtpSaveBlock, /secure:|security:|enabled:|fromName:/, 'SMTP document must not store legacy security/enabled/fromName fields');
const smtpTestApi = await fs.readFile(new URL('../functions/api/admin/smtp-test.js', import.meta.url), 'utf8');
assert.match(smtpTestApi, /sameOriginRequest/, 'SMTP connection test must reject cross-origin requests');
assert.match(smtpTestApi, /requireAdmin/, 'SMTP connection test must require administrator authorization');
const genericSendApi = await fs.readFile(new URL('../functions/api/send.js', import.meta.url), 'utf8');
assert.match(genericSendApi, /No Reply-To is emitted/, 'generic admin-to-customer emails must omit Reply-To');
assert.match(genericSendApi, /sameOriginRequest[\s\S]*requireAdmin/, 'generic email endpoint must enforce same-origin and administrator checks');
assert.match(contactApiSource, /replyTo:\s*email/, 'only the admin notification from the public contact form should set Reply-To');
assert.match(contactApiSource, /customerEmail[\s\S]*no Reply-To on system-to-customer mail/, 'customer confirmation must omit Reply-To');
const varsExample = await fs.readFile(new URL('../.dev.vars.example', import.meta.url), 'utf8');
for (const name of ['FIREBASE_PROJECT_ID', 'FIREBASE_WEB_API_KEY', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'SMTP_ENCRYPTION_KEY', 'SMTP_HOST_ALLOWLIST']) {
  assert.match(varsExample, new RegExp('^' + name + '=', 'm'), `the Movara-compatible five-variable template must include ${name}`);
}
assert.doesNotMatch(varsExample, /FIREBASE_CLIENT_EMAIL|FIREBASE_PRIVATE_KEY|FIREBASE_API_KEY=/, 'legacy separate Firebase environment variables must be removed');
console.log('Smoke tests passed: service-account JSON, Firestore admin authorization, Movara-compatible SMTP AES-GCM storage, secure SMTP transport checks, contact notification/confirmation headers, same-origin email endpoints, deny-all rules, preserved listing/contact behavior, and Firestore document-size limits.');
