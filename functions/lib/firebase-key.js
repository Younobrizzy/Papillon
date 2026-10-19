/**
 * Parse the Firebase service-account private key from Cloudflare Pages secrets.
 * Accepts the raw PEM value, a quoted PEM value, escaped newline sequences,
 * or the complete service-account JSON object. Never logs or returns key data.
 */
let cachedKey = null;
let cachedFingerprint = '';

function readPrivateKeyPem(env) {
  let raw = String(env.FIREBASE_PRIVATE_KEY || '').replace(/^\uFEFF/, '').trim();
  if (!raw) {
    const error = new Error('FIREBASE_PRIVATE_KEY is empty. Set it to the private_key value from your Firebase service-account JSON.');
    error.status = 503;
    throw error;
  }

  // Allow a user to paste the complete service-account JSON by mistake.
  const jsonCandidate = raw.replace(/^['"]|['"]$/g, '');
  if (jsonCandidate.startsWith('{')) {
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (typeof parsed.private_key === 'string') raw = parsed.private_key;
    } catch {
      const error = new Error('FIREBASE_PRIVATE_KEY looks like service-account JSON but is not valid JSON. Paste only its private_key value, including the BEGIN/END lines.');
      error.status = 503;
      throw error;
    }
  }

  raw = raw.replace(/^['"]|['"]$/g, '').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim();
  const match = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(raw);
  if (!match) {
    const error = new Error('FIREBASE_PRIVATE_KEY must be the complete PKCS#8 private_key PEM from the Firebase service-account JSON, including BEGIN and END lines. Do not paste private_key_id or the whole JSON object.');
    error.status = 503;
    throw error;
  }

  let base64 = match[1].replace(/\s+/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
    const error = new Error('FIREBASE_PRIVATE_KEY contains invalid PEM characters. Copy the private_key value again from the downloaded Firebase service-account JSON and preserve its full contents.');
    error.status = 503;
    throw error;
  }
  base64 += '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(base64);
    return { pem: `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`, der: Uint8Array.from(binary, character => character.charCodeAt(0)) };
  } catch {
    const error = new Error('FIREBASE_PRIVATE_KEY could not be decoded. In Cloudflare, set it to the full private_key PEM value from the service-account JSON, not a base64-encoded copy or private_key_id.');
    error.status = 503;
    throw error;
  }
}

export async function getFirebaseSigningKey(env) {
  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || '').trim();
  if (!clientEmail) {
    const error = new Error('FIREBASE_CLIENT_EMAIL is empty. Set it to the client_email value from the same Firebase service-account JSON as the private key.');
    error.status = 503;
    throw error;
  }
  const { pem, der } = readPrivateKeyPem(env);
  const fingerprint = `${clientEmail}|${pem}`;
  if (cachedKey && cachedFingerprint === fingerprint) return cachedKey;
  try {
    cachedKey = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    const error = new Error('FIREBASE_PRIVATE_KEY is not a valid PKCS#8 RSA private key. Download a new JSON key for the Firebase service account and update the Cloudflare secret.');
    error.status = 503;
    throw error;
  }
  cachedFingerprint = fingerprint;
  return cachedKey;
}
