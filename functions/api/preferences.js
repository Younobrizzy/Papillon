import { encryptSecret } from '../lib/crypto.js';
import { jsonResponse, readAdminSession, sameOriginRequest, validEmail, cleanText } from '../lib/admin-session.js';
import { validateSmtpHost } from '../lib/smtp.js';
import { readPublicSiteScript, readPublicSiteOgImage, writePublicSiteScript } from '../lib/public-site-script.js';
import { getPrivateDocument, setPrivateDocument } from '../lib/private-firestore.js';

const PRIVATE_PREFERENCES_PATH = 'privateConfig/sitePreferences';

export async function onRequestGet(context) {
  if (!await readAdminSession(context.request, context.env)) return jsonResponse({ error: 'Sign in to manage preferences.' }, 401);
  let saved;
  try {
    saved = await getPrivateDocument(context.env, PRIVATE_PREFERENCES_PATH);
  } catch (error) {
    console.error('Could not read private Preferences from Firestore:', error);
    return jsonResponse({ error: error?.message || 'Private Preferences could not be loaded from Firestore. Check the service-account configuration.' }, error?.status || 503);
  }
  const preferences = saved && typeof saved === 'object' ? saved : {};
  let publicScript = String(preferences.script || '');
  let publicPhoneNumber = String(preferences.phoneNumber || '');
  let publicDocument = { exists: false, siteTitle: '', siteBranding: '', siteDescription: '', hasSiteOgImage: false };
  let publicSiteOgImage = '';
  try {
    publicDocument = await readPublicSiteScript(context.env);
    if (publicDocument.exists) {
      publicScript = publicDocument.script;
      publicPhoneNumber = publicDocument.phoneNumber || '';
    }
    try {
      publicSiteOgImage = await readPublicSiteOgImage(context.env);
    } catch (imageError) {
      console.error('Could not read public social preview image:', imageError);
    }
  } catch (error) {
    // Keep dashboard access available while server-side Firestore configuration is being repaired.
    console.error('Could not read public site script from Firestore:', error);
  }
  return jsonResponse({
    success: true,
    configured: Boolean(saved),
    preferences: {
      email: String(preferences.email || ''),
      script: publicScript,
      phoneNumber: publicPhoneNumber,
      siteTitle: String((publicDocument && publicDocument.siteTitle) || ''),
      siteBranding: String((publicDocument && publicDocument.siteBranding) || ''),
      siteDescription: String((publicDocument && publicDocument.siteDescription) || ''),
      siteOgImage: publicSiteOgImage,
      smtp: {
        host: String(preferences.smtp?.host || ''),
        port: Number(preferences.smtp?.port || 0) || '',
        username: String(preferences.smtp?.username || ''),
        hasPassword: Boolean(preferences.smtp?.passwordCiphertext && preferences.smtp?.passwordIv)
      }
    }
  });
}

export async function onRequestPost(context) {
  if (!sameOriginRequest(context.request)) return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
  if (!await readAdminSession(context.request, context.env)) return jsonResponse({ error: 'Your Firebase administrator authorization has expired. Please sign in again.' }, 401);
  let body;
  try {
    const raw = await context.request.text();
    if (new TextEncoder().encode(raw).byteLength > 512 * 1024) return jsonResponse({ error: 'Preferences payload is too large.' }, 413);
    body = JSON.parse(raw);
  } catch { return jsonResponse({ error: 'Invalid preferences payload.' }, 400); }

  const email = cleanText(body?.email, 254);
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
  try {
    existing = await getPrivateDocument(context.env, PRIVATE_PREFERENCES_PATH) || {};
  } catch (error) {
    console.error('Could not read existing private Preferences from Firestore:', error);
    return jsonResponse({ error: error?.message || 'Could not read existing Preferences from Firestore.' }, error?.status || 503);
  }
  const submittedSmtp = body?.smtp && typeof body.smtp === 'object' ? body.smtp : {};
  const host = cleanText(submittedSmtp.host, 253).toLowerCase().replace(/\.$/, '');
  const portRaw = String(submittedSmtp.port ?? '').trim();
  const port = portRaw ? Number(portRaw) : 0;
  const username = cleanText(submittedSmtp.username, 254);
  const password = String(submittedSmtp.password || '');
  const hasAnySmtpValue = Boolean(host || portRaw || username || password);
  let smtp = { ...(existing.smtp || {}) };

  if (hasAnySmtpValue) {
    if (!host || !portRaw || !username) return jsonResponse({ error: 'Complete the SMTP host, port, and username.' }, 400);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 25) return jsonResponse({ error: 'Enter a valid SMTP submission port (465, 587, or 2525 are commonly supported; port 25 is unavailable).'}, 400);
    if (!validEmail(username)) return jsonResponse({ error: 'Use the SMTP account email address as the SMTP username.' }, 400);
    try { validateSmtpHost(host); } catch (error) { return jsonResponse({ error: error?.message || 'Invalid SMTP host.' }, 400); }

    let passwordCiphertext = smtp.passwordCiphertext || '';
    let passwordIv = smtp.passwordIv || '';
    if (password) {
      if (password.length > 2048) return jsonResponse({ error: 'SMTP password is too long.' }, 400);
      try {
        const encrypted = await encryptSecret(password, context.env);
        passwordCiphertext = encrypted.ciphertext;
        passwordIv = encrypted.iv;
      } catch (error) {
        console.error('SMTP password encryption failed:', error);
        return jsonResponse({ error: 'SMTP encryption is not configured on the server.' }, 503);
      }
    }
    if (!passwordCiphertext || !passwordIv) return jsonResponse({ error: 'Enter the SMTP password before saving SMTP settings.' }, 400);

    smtp = {
      host,
      port,
      security: port === 465 ? 'ssl' : 'starttls',
      username,
      passwordCiphertext,
      passwordIv
    };
  } else {
    smtp = {};
  }

  try {
    await writePublicSiteScript(context.env, script, phoneNumber, { siteTitle, siteBranding, siteDescription, siteOgImage });
  } catch (error) {
    console.error('Could not save public site script to Firestore:', error);
    return jsonResponse({ error: error?.message || 'Could not save the public script document. Check the Firestore service-account configuration and permissions.' }, error?.status || 503);
  }

  // Private contact recipient and encrypted SMTP credentials live in a separate
  // Firestore document; never place them in siteConfig/public or a browser response.
  const preferences = { email, smtp, updatedAt: new Date().toISOString() };
  try {
    await setPrivateDocument(context.env, PRIVATE_PREFERENCES_PATH, preferences);
  } catch (error) {
    console.error('Could not save private Preferences to Firestore:', error);
    return jsonResponse({ error: error?.message || 'Could not save private Preferences to Firestore. Check service-account permissions.' }, error?.status || 503);
  }
  return jsonResponse({ success: true, message: 'Preferences saved to Firestore. Private contact and SMTP settings are stored separately from public site settings.' });
}
