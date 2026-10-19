import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const requiredFiles = [
  'index.html', 'puppy.html', 'dashboard/index.html', 'shipping/index.html',
  'functions/_middleware.js', 'functions/api/config.js', 'functions/api/admin-session.js',
  'functions/api/puppies.js', 'functions/api/preferences.js', 'functions/api/public-scripts.js',
  'functions/api/contact.js', 'functions/api/og-image.js', 'functions/lib/private-firestore.js',
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
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const varsExample = fs.readFileSync(path.join(root, '.dev.vars.example'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'config/firestore.rules'), 'utf8');
const privateFirestore = fs.readFileSync(path.join(root, 'functions/lib/private-firestore.js'), 'utf8');
const contact = fs.readFileSync(path.join(root, 'functions/api/contact.js'), 'utf8');

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
