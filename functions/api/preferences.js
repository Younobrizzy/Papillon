import { jsonResponse, sameOriginRequest, validEmail, cleanText } from '../lib/admin-session.js';
import { requireAdmin } from '../lib/require-admin.js';
import { readPublicSiteScript, readPublicSiteOgImage, writePublicSiteScript } from '../lib/public-site-script.js';
import { getPrivateDocument, setPrivateDocument } from '../lib/private-firestore.js';
import { getSafeSmtpSettings, migrateLegacySmtp, saveSmtpSettings } from '../lib/smtp-config.js';

const PRIVATE_PREFERENCES_PATH = 'privateConfig/sitePreferences';

function authError(error) {
  const status = Number(error?.status) || 503;
  return jsonResponse({ error: status === 401 || status === 403 ? error.message : 'Administrator access could not be verified. Please try again.' }, status);
}

function legacySmtpSummary(preferences) {
  const smtp = preferences?.smtp || {};
  return {
    host: String(smtp.host || ''),
    port: Number(smtp.port || 0) || '',
    username: String(smtp.username || ''),
    fromEmail: String(smtp.fromEmail || smtp.username || ''),
    hasPassword: Boolean(smtp.passwordCiphertext && smtp.passwordIv)
  };
}

export async function onRequestGet(context) {
  let session;
  try { session = await requireAdmin(context.request, context.env); }
  catch (error) { return authError(error); }

  let saved;
  try {
    saved = await getPrivateDocument(context.env, PRIVATE_PREFERENCES_PATH) || {};
  } catch (error) {
    console.error('Could not read private Preferences:', error);
    return jsonResponse({ error: 'Preferences could not be loaded. Please try again later.' }, error?.status || 503);
  }

  let smtp;
  let smtpMigrationWarning = '';
  try {
    const migrated = await migrateLegacySmtp(context.env, saved, session.uid);
    smtp = migrated ? await getSafeSmtpSettings(context.env) : legacySmtpSummary(saved);
  } catch (error) {
    console.error('Legacy SMTP migration could not be completed:', error?.message || error);
    smtp = legacySmtpSummary(saved);
    smtpMigrationWarning = 'Existing SMTP settings need to be saved again. Confirm the SMTP encryption key is a base64-encoded 32-byte value.';
  }

  let publicDocument = { exists: false, siteTitle: '', siteBranding: '', siteDescription: '', hasSiteOgImage: false };
  let publicSiteOgImage = '';
  let publicScript = String(saved.script || '');
  let publicPhoneNumber = String(saved.phoneNumber || '');
  try {
    publicDocument = await readPublicSiteScript(context.env);
    if (publicDocument.exists) {
      publicScript = publicDocument.script;
      publicPhoneNumber = publicDocument.phoneNumber || '';
    }
    try { publicSiteOgImage = await readPublicSiteOgImage(context.env); }
    catch (imageError) { console.error('Could not read public social preview image:', imageError); }
  } catch (error) {
    console.error('Could not read public site settings:', error);
  }

  return jsonResponse({
    success: true,
    configured: Boolean(saved),
    smtpMigrationWarning,
    preferences: {
      email: String(saved.email || ''),
      script: publicScript,
      phoneNumber: publicPhoneNumber,
      siteTitle: String(publicDocument.siteTitle || ''),
      siteBranding: String(publicDocument.siteBranding || ''),
      siteDescription: String(publicDocument.siteDescription || ''),
      siteOgImage: publicSiteOgImage,
      smtp
    }
  });
}

export async function onRequestPost(context) {
  if (!sameOriginRequest(context.request)) return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
  let session;
  try { session = await requireAdmin(context.request, context.env); }
  catch (error) { return authError(error); }

  let body;
  try {
    const raw = await context.request.text();
    if (new TextEncoder().encode(raw).byteLength > 512 * 1024) return jsonResponse({ error: 'Preferences payload is too large.' }, 413);
    body = JSON.parse(raw);
  } catch { return jsonResponse({ error: 'Invalid preferences payload.' }, 400); }

  const email = cleanText(body?.email, 254).toLowerCase();
  const script = String(body?.script || '');
  const siteTitle = cleanText(body?.siteTitle, 120);
  const siteBranding = cleanText(body?.siteBranding, 80);
  const siteDescription = cleanText(body?.siteDescription, 400);
  const siteOgImage = String(body?.siteOgImage || '').trim();
  const rawPhoneNumber = String(body?.phoneNumber || '').trim();
  if (rawPhoneNumber.length > 32) return jsonResponse({ error: 'Phone number must be 32 characters or fewer.' }, 400);
  const phoneNumber = cleanText(rawPhoneNumber, 32);
  const phoneDigits = phoneNumber.replace(/\D/g, '');
  if (phoneNumber && (!/^\+?[0-9().\-\s]{7,32}$/.test(phoneNumber) || phoneDigits.length < 7 || phoneDigits.length > 20)) {
    return jsonResponse({ error: 'Enter a valid phone number with 7–20 digits, or leave it blank.' }, 400);
  }
  if (new TextEncoder().encode(script).byteLength > 48000) return jsonResponse({ error: 'The script snippet is too large. Use a snippet smaller than 48 KB.' }, 413);
  if (email && !validEmail(email)) return jsonResponse({ error: 'Enter a valid contact email address or leave it blank.' }, 400);
  if (siteOgImage) {
    const imageMatch = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(siteOgImage);
    if (!imageMatch || imageMatch[1].length % 4 !== 0) return jsonResponse({ error: 'The social preview image must be a compressed JPEG data URL.' }, 400);
    const base64 = imageMatch[1];
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const imageBytes = Math.floor((base64.length * 3) / 4) - padding;
    if (imageBytes < 1) return jsonResponse({ error: 'The social preview image is empty.' }, 400);
    if (imageBytes > 240 * 1024) return jsonResponse({ error: 'The social preview image must be 240 KB or smaller after compression.' }, 413);
  }

  let existing;
  try { existing = await getPrivateDocument(context.env, PRIVATE_PREFERENCES_PATH) || {}; }
  catch (error) {
    console.error('Could not read existing private Preferences:', error);
    return jsonResponse({ error: 'Existing Preferences could not be read. Please try again.' }, error?.status || 503);
  }

  try {
    await writePublicSiteScript(context.env, script, phoneNumber, { siteTitle, siteBranding, siteDescription, siteOgImage });
  } catch (error) {
    console.error('Could not save public site settings:', error);
    return jsonResponse({ error: 'The site settings could not be saved. Please check the values and try again.' }, error?.status || 503);
  }

  // The contact recipient remains in Papillon's existing private preferences
  // document. SMTP credentials are written separately to the Movara-compatible
  // private/smtp document and are never embedded in this preferences response.
  try {
    const { smtp: _legacySmtp, ...preservedPrivatePreferences } = existing;
    await setPrivateDocument(context.env, PRIVATE_PREFERENCES_PATH, {
      ...preservedPrivatePreferences,
      email,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Could not save private contact Preferences:', error);
    return jsonResponse({ error: 'Preferences could not be saved. Please try again.' }, error?.status || 503);
  }

  const submittedSmtp = body?.smtp && typeof body.smtp === 'object' ? body.smtp : {};
  const hasAnySmtpValue = Boolean(
    String(submittedSmtp.host || '').trim() || String(submittedSmtp.port ?? '').trim() ||
    String(submittedSmtp.username || '').trim() || String(submittedSmtp.fromEmail || '').trim() ||
    String(submittedSmtp.password || '')
  );
  let smtpSettings;
  try {
    // Preserve any old embedded SMTP settings during one-time migration.
    if (existing.smtp && !String(submittedSmtp.password || '') && !await getPrivateDocument(context.env, 'private/smtp')) {
      await migrateLegacySmtp(context.env, existing, session.uid);
    }
    smtpSettings = hasAnySmtpValue
      ? await saveSmtpSettings(context.env, submittedSmtp, session.uid, existing)
      : await getSafeSmtpSettings(context.env);
  } catch (error) {
    console.error('Could not save SMTP configuration:', error?.message || error);
    return jsonResponse({ error: error?.message || 'SMTP settings could not be saved securely.' }, error?.status || 503);
  }

  return jsonResponse({
    success: true,
    message: 'Preferences saved successfully.',
    smtp: smtpSettings
  });
}
