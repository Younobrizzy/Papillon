/**
 * Parse the complete Firebase service-account JSON from Cloudflare Secrets.
 * The JSON remains server-side and is never returned by public endpoints.
 */
let cachedKey = null;
let cachedFingerprint = '';

function decodePem(pem) {
  const body = String(pem || '')
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!body || !/^[A-Za-z0-9+/]*={0,2}$/.test(body) || body.length % 4 === 1) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON contains an invalid private key.');
  }
  const normalized = body + '='.repeat((4 - body.length % 4) % 4);
  try {
    const binary = atob(normalized);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON contains an invalid private key.');
  }
}

export function getFirebaseServiceAccount(env = {}) {
  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not configured.');
  const raw = String(env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
  let account;
  try { account = JSON.parse(raw); }
  catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.'); }
  const clientEmail = String(account?.client_email || '').trim();
  const privateKey = String(account?.private_key || '').replace(/\\n/g, '\n').trim();
  const accountProjectId = String(account?.project_id || '').trim();
  if (!clientEmail || !privateKey || !accountProjectId) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must include project_id, client_email, and private_key.');
  }
  if (accountProjectId !== projectId) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON project_id does not match FIREBASE_PROJECT_ID.');
  }
  return { projectId, clientEmail, privateKey };
}

export async function getFirebaseSigningKey(env) {
  const account = getFirebaseServiceAccount(env);
  const fingerprint = `${account.projectId}|${account.clientEmail}|${account.privateKey}`;
  if (cachedKey && cachedFingerprint === fingerprint) return cachedKey;
  try {
    cachedKey = await crypto.subtle.importKey(
      'pkcs8', decodePem(account.privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    );
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON private_key is not a valid PKCS#8 RSA key. Download a fresh service-account JSON key.');
  }
  cachedFingerprint = fingerprint;
  return cachedKey;
}
