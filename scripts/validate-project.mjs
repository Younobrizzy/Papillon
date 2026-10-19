import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const requiredFiles = [
  'index.html', 'puppy.html', 'contact/index.html', 'assets/js/puppy-contact.js', 'assets/css/puppy-contact.css', 'dashboard/index.html', 'shipping/index.html',
  'functions/_middleware.js', 'functions/api/config.js', 'functions/api/admin-session.js',
  'functions/api/puppies.js', 'functions/api/preferences.js', 'functions/api/public-scripts.js',
  'functions/api/contact.js', 'functions/api/og-image.js', 'functions/lib/private-firestore.js', 'functions/lib/firestore-document-size.js',
  'functions/lib/admin-session.js', 'functions/lib/crypto.js', 'functions/lib/smtp.js',
  'config/firestore.rules', 'assets/icons/site.webmanifest', 'scripts/dev-server.cjs', '.dev.vars.example', 'README.md'
];

for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) errors.push(`Missing required file: ${relative}`);
}


if (fs.existsSync(path.join(root, 'wrangler.toml')) || fs.existsSync(path.join(root, 'wrangler.json')) || fs.existsSync(path.join(root, 'wrangler.jsonc'))) {
  errors.push('Wrangler config file must remain absent so Cloudflare Dashboard can manage ordinary Variables.');
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.wrangler'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(root);
// Catch broken local links after folder reorganizations. API routes, anchors,
// external URLs, and clean puppy slugs are handled separately by Pages routing.
const staticHtml = files.filter(file => file.endsWith('.html'));
for (const file of staticHtml) {
  const html = fs.readFileSync(file, 'utf8');
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*[\"']([^\"']+)[\"']/gi)) {
    const raw = match[1];
    if (!raw.startsWith('/') || raw.startsWith('//')) continue;
    const pathname = raw.split(/[?#]/, 1)[0];
    if (!pathname || pathname.startsWith('/api/') || pathname.startsWith('/#')) continue;
    // Clean routes and homepage fragments are provided by Pages redirects.
    if (pathname === '/' || pathname === '/shipping/' || pathname === '/dashboard/' || pathname.startsWith('/#')) continue;
    if (!path.extname(pathname)) continue;
    const diskPath = path.join(root, pathname.replace(/^\//, ''));
    if (!fs.existsSync(diskPath)) errors.push(`Broken local HTML asset reference in ${path.relative(root, file)}: ${raw}`);
  }
}
const runtimeAuthSources = files
  .filter(file => /\.(?:m?js|cjs)$/.test(file) && !file.endsWith('README.md'))
  .map(file => fs.readFileSync(file, 'utf8'))
  .join('\n');
if (/documents\/admins\/|isAdministrator\s*\(|readAdminSession\s*\(/.test(runtimeAuthSources)) {
  errors.push('Firestore role-allowlist code must not be present; dashboard access uses Firebase Authentication only.');
}
const sourceFiles = files.filter(file => /\.(?:m?js|cjs)$/.test(file));
for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) errors.push(`JavaScript syntax error in ${path.relative(root, file)}: ${(result.stderr || result.stdout).trim()}`);
}

const redirectRules = fs.readFileSync(path.join(root, '_redirects'), 'utf8');
for (const alias of ['favicon.ico', 'favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'favicon-48x48.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest']) {
  const target = `assets/icons/${alias}`;
  if (!fs.existsSync(path.join(root, target))) errors.push(`Missing organized icon asset: ${target}`);
  if (!redirectRules.includes(`/${alias} /${target} 200`)) errors.push(`Missing root compatibility redirect for /${alias}`);
}
const dashboardHtml = fs.readFileSync(path.join(root, 'dashboard/index.html'), 'utf8');
const dashboardCss = fs.readFileSync(path.join(root, 'assets/css/dashboard.css'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(root, 'assets/js/dashboard.js'), 'utf8');
if (!dashboardHtml.includes('id="dashboard-auth-loader"') || !dashboardHtml.includes('id="login-screen" aria-labelledby="login-title" hidden')) {
  errors.push('Dashboard must start behind the full-screen auth loader to prevent login/dashboard flashes.');
}
if (!dashboardCss.includes('.dashboard-auth-loader.is-hidden') || !dashboardJs.includes('AUTH_TRANSITION_MIN_MS') || !dashboardJs.includes('await refreshListings();') || !dashboardJs.includes('await loadPreferencesIntoForm();')) {
  errors.push('Dashboard auth transition loader or initial-data wait is incomplete.');
}
const contactPageHtml = fs.readFileSync(path.join(root, 'contact/index.html'), 'utf8');
const contactPageJs = fs.readFileSync(path.join(root, 'assets/js/puppy-contact.js'), 'utf8');
const middlewareSource = fs.readFileSync(path.join(root, 'functions/_middleware.js'), 'utf8');
if (!middlewareSource.includes("new URL('/contact/index.html', incomingUrl)") || !middlewareSource.includes('isPuppyContactRoute && isDocumentRequest')) errors.push('Puppy contact routes must be rewritten by middleware to the shared contact page.');
if (!contactPageHtml.includes('name="shippingAddress"') || !contactPageHtml.includes('name="preferredPaymentMethod"') || !contactPageHtml.includes('class="site-header"') || !contactPageHtml.includes('class="site-footer"')) errors.push('Puppy contact page must include shipping/payment fields and the shared site header/footer.');
if (!contactPageJs.includes("fetch('/api/puppies?slug='") || !contactPageJs.includes("enquiryType: 'puppy-contact'")) errors.push('Puppy contact page must load the listing and submit a structured contact request.');
const puppyHtml = fs.readFileSync(path.join(root, 'puppy.html'), 'utf8');
const puppyDetailJs = fs.readFileSync(path.join(root, 'assets/js/puppy-detail.js'), 'utf8');
const navigationLoaderJs = fs.readFileSync(path.join(root, 'assets/js/navigation-loading.js'), 'utf8');
if (!puppyHtml.includes('class="site-navigation-loader is-visible"') || !puppyHtml.includes('body class="puppy-detail-page" aria-busy="true"')) {
  errors.push('Puppy detail page must render the page loader before scripts run.');
}
if (!puppyDetailJs.includes('await waitForImageReady(galleryMainImage, 12000)') || !puppyDetailJs.includes("new Event('papillon:puppy-detail-ready')") || !puppyDetailJs.includes('await waitForPaint();')) {
  errors.push('Puppy detail loader must wait for the listing and primary image to resolve before closing.');
}
if (!navigationLoaderJs.includes('papillon:puppy-detail-ready') || !navigationLoaderJs.includes('isPuppyDetailPage')) {
  errors.push('Navigation loader must wait for the puppy detail readiness event rather than hiding on the page load event.');
}

const puppyApi = fs.readFileSync(path.join(root, 'functions/api/puppies.js'), 'utf8');
const documentSizeGuard = fs.readFileSync(path.join(root, 'functions/lib/firestore-document-size.js'), 'utf8');
if (!puppyApi.includes('assertFirestoreDocumentFits(mainFields') || !puppyApi.includes('assertFirestoreDocumentFits(galleryFields')) {
  errors.push('Puppy API must size-check both listing and gallery documents before committing writes.');
}
if (!documentSizeGuard.includes('1024 * 1024') || !documentSizeGuard.includes('FIRESTORE_DOCUMENT_MAX_SAFE_BYTES')) {
  errors.push('Firestore document-size guard must enforce the 1 MiB document limit with a REST safety margin.');
}
if (!dashboardJs.includes('estimateDocumentSizeBytes(estimatedMainDocument')) {
  errors.push('Dashboard must preflight the listing document size before submitting it.');
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const varsExample = fs.readFileSync(path.join(root, '.dev.vars.example'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'config/firestore.rules'), 'utf8');
const privateFirestore = fs.readFileSync(path.join(root, 'functions/lib/private-firestore.js'), 'utf8');
const contact = fs.readFileSync(path.join(root, 'functions/api/contact.js'), 'utf8');
const smtpSource = fs.readFileSync(path.join(root, 'functions/lib/smtp.js'), 'utf8');
if (!smtpSource.includes('const socketInfo = await withTimeout(socket.opened') || !smtpSource.includes('const remoteAddress = socketInfo?.remoteAddress') || smtpSource.includes('socket.remoteAddress')) errors.push('SMTP must read remoteAddress from the SocketInfo returned by socket.opened.');

for (const name of ['FIREBASE_PROJECT_ID', 'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_APP_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'SMTP_ENCRYPTION_KEY']) {
  if (!varsExample.includes(name)) errors.push(`Missing ${name} from .dev.vars.example`);
  if (!readme.includes(name)) errors.push(`Missing ${name} from README setup documentation`);
}
if (!/allow\s+read,\s*write:\s*if\s+false\s*;/.test(rules)) errors.push('Firestore browser rules must remain default-deny.');
const preferencesApi = fs.readFileSync(path.join(root, 'functions/api/preferences.js'), 'utf8');
if (!preferencesApi.includes('privateConfig/sitePreferences') || !contact.includes('privateConfig/sitePreferences')) errors.push('Private Preferences must use privateConfig/sitePreferences in both Preferences and contact APIs.');
if (!contact.includes('consumeContactRateLimit')) errors.push('Contact endpoint must use the Firestore rate limiter.');
if (/PAPILLON_STORE/.test(files.filter(file => /\.(?:js|html|toml|json)$/.test(file)).map(file => fs.readFileSync(file, 'utf8')).join('\n'))) errors.push('PAPILLON_STORE reference remains in runtime/config files.');
if (/FIREBASE_PRIVATE_KEY\s*[:=]\s*["']-----BEGIN PRIVATE KEY-----/.test(files.filter(file => !file.endsWith('.dev.vars.example')).map(file => fs.readFileSync(file, 'utf8')).join('\n'))) errors.push('Possible hard-coded Firebase private key found.');
if (!readme.includes('No Cloudflare KV binding is required')) warnings.push('README should clearly state that no Cloudflare KV binding is required.');

if (errors.length) {
  console.error(`Project validation failed (${errors.length} error(s), ${warnings.length} warning(s)):`);
  for (const error of errors) console.error(`ERROR: ${error}`);
  for (const warning of warnings) console.warn(`WARN: ${warning}`);
  process.exit(1);
}
console.log(`Project validation passed. Checked ${requiredFiles.length} required files and ${sourceFiles.length} JavaScript files.`);
for (const warning of warnings) console.warn(`WARN: ${warning}`);
console.log('Reminder: this validates local structure/syntax only; it cannot verify live Firebase, SMTP, or Cloudflare credentials.');
