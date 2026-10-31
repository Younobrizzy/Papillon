import { getPrivateDocument } from '../lib/private-firestore.js';
import { isValidSmtpEncryptionKey } from '../lib/crypto.js';
import { loadSmtpConfig } from '../lib/smtp-config.js';

export async function onRequestGet({ env }) {
  let system = 'incomplete';
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_WEB_API_KEY && env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      await getPrivateDocument(env, 'privateConfig/sitePreferences');
      system = 'configured';
    } catch { system = 'unavailable'; }
  }

  let smtp = 'unconfigured';
  if (system === 'configured' && isValidSmtpEncryptionKey(env.SMTP_ENCRYPTION_KEY)) {
    try { await loadSmtpConfig(env); smtp = 'configured'; }
    catch (error) { smtp = error?.message?.includes('not configured') ? 'unconfigured' : 'unavailable'; }
  }

  return Response.json({
    system,
    smtp,
    encryption: isValidSmtpEncryptionKey(env.SMTP_ENCRYPTION_KEY) ? 'configured' : 'missing_or_invalid'
  }, {
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}
