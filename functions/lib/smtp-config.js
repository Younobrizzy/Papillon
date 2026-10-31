import { decryptSecret, decryptSmtpPassword, encryptSmtpPassword } from './crypto.js';
import { getPrivateDocument, setPrivateDocument } from './private-firestore.js';
import { readPublicSiteScript } from './public-site-script.js';
import { validateSmtpHost } from './smtp.js';
import { validEmail } from './admin-session.js';

const SMTP_PATH = 'private/smtp';
const LEGACY_PREFERENCES_PATH = 'privateConfig/sitePreferences';

export async function migrateLegacySmtp(env, legacyPreferences, uid) {
  const current = await getPrivateDocument(env, SMTP_PATH);
  if (current?.password) return current;
  const legacy = legacyPreferences?.smtp;
  if (!legacy?.passwordCiphertext || !legacy?.passwordIv || !legacy.host || !legacy.port || !legacy.username) return current;

  // Papillon's previous AES-GCM format used the same decoded 32-byte key when
  // configured with the documented base64 secret. Decrypt and re-encrypt to
  // the explicit Movara-compatible password bundle before moving the record.
  const plaintext = await decryptSecret(legacy.passwordCiphertext, legacy.passwordIv, env);
  const password = await encryptSmtpPassword(env, plaintext);
  const migrated = {
    host: String(legacy.host).trim().toLowerCase(),
    port: Number(legacy.port),
    username: String(legacy.username).trim().toLowerCase(),
    password,
    fromEmail: String(legacy.fromEmail || legacy.username).trim().toLowerCase(),
    uid: String(uid || '').trim(),
    updatedAt: new Date().toISOString()
  };
  if (!migrated.uid) throw new Error('An administrator identity is required to migrate SMTP settings.');
  await setPrivateDocument(env, SMTP_PATH, migrated);
  const { smtp: _legacySmtp, ...safePreferences } = legacyPreferences;
  await setPrivateDocument(env, LEGACY_PREFERENCES_PATH, {
    ...safePreferences,
    updatedAt: new Date().toISOString()
  });
  return migrated;
}

export async function loadSmtpConfig(env) {
  const [document, branding] = await Promise.all([
    getPrivateDocument(env, SMTP_PATH),
    readPublicSiteScript(env).catch(() => ({}))
  ]);
  if (!document) {
    const error = new Error('SMTP settings are not configured. Save SMTP settings in Dashboard → Preferences → SMTP setup.');
    error.status = 503;
    throw error;
  }
  const host = validateSmtpHost(document.host, env);
  const port = Number(document.port);
  if (![465, 587, 2525].includes(port)) {
    const error = new Error('SMTP port must be 465, 587, or 2525.'); error.status = 503; throw error;
  }
  const username = String(document.username || '').trim().toLowerCase();
  const fromEmail = String(document.fromEmail || document.username || '').trim().toLowerCase();
  if (!validEmail(username) || !validEmail(fromEmail)) {
    const error = new Error('Saved SMTP username or From email is invalid.'); error.status = 503; throw error;
  }
  const password = await decryptSmtpPassword(env, document.password);
  if (!password) { const error = new Error('SMTP password is not configured.'); error.status = 503; throw error; }
  return {
    host,
    port,
    security: port === 465 ? 'ssl' : 'starttls',
    user: username,
    username,
    password,
    fromEmail,
    fromName: String(branding.siteBranding || branding.siteTitle || 'Papillon & Co.').trim().slice(0, 120),
    uid: String(document.uid || ''),
    updatedAt: document.updatedAt || ''
  };
}

export async function getSafeSmtpSettings(env) {
  const document = await getPrivateDocument(env, SMTP_PATH);
  if (!document) return { host: '', port: '', username: '', fromEmail: '', hasPassword: false };
  return {
    host: String(document.host || ''),
    port: Number(document.port || 0) || '',
    username: String(document.username || ''),
    fromEmail: String(document.fromEmail || document.username || ''),
    hasPassword: Boolean(document.password?.algorithm === 'AES-256-GCM' && document.password?.iv && document.password?.ciphertext)
  };
}

export async function saveSmtpSettings(env, body, uid, legacyPreferences = {}) {
  const host = String(body?.host || '').trim().toLowerCase().replace(/\.$/, '');
  const port = Number(body?.port);
  const username = String(body?.username || '').trim().toLowerCase();
  const fromEmail = String(body?.fromEmail || body?.username || '').trim().toLowerCase();
  const suppliedPassword = typeof body?.password === 'string' ? body.password : '';
  if (!host && !body?.port && !username && !fromEmail && !suppliedPassword) {
    return await getSafeSmtpSettings(env);
  }
  const validatedHost = validateSmtpHost(host, env);
  if (![465, 587, 2525].includes(port)) { const error = new Error('Choose SMTP port 465, 587, or 2525.'); error.status = 400; throw error; }
  if (!validEmail(username)) { const error = new Error('Enter a valid SMTP username email address.'); error.status = 400; throw error; }
  if (!validEmail(fromEmail)) { const error = new Error('Enter a valid From email address.'); error.status = 400; throw error; }
  if (suppliedPassword.length > 4096) { const error = new Error('SMTP password is too long.'); error.status = 413; throw error; }

  let existing = await getPrivateDocument(env, SMTP_PATH);
  // If the administrator supplied a new password, create the Movara-format
  // record directly. This also lets installations replace legacy settings
  // when their previous encryption key is no longer usable.
  if (!existing && !suppliedPassword && legacyPreferences?.smtp) existing = await migrateLegacySmtp(env, legacyPreferences, uid);
  let encryptedPassword = existing?.password;
  if (suppliedPassword) encryptedPassword = await encryptSmtpPassword(env, suppliedPassword);
  if (!encryptedPassword) { const error = new Error('Enter the SMTP password before saving SMTP settings for the first time.'); error.status = 400; throw error; }

  const record = {
    host: validatedHost,
    port,
    username,
    password: encryptedPassword,
    fromEmail,
    uid: String(uid || '').trim(),
    updatedAt: new Date().toISOString()
  };
  if (!record.uid) { const error = new Error('The authenticated administrator identity is missing.'); error.status = 403; throw error; }
  await setPrivateDocument(env, SMTP_PATH, record);
  return { host: record.host, port: record.port, username: record.username, fromEmail: record.fromEmail, hasPassword: true };
}
