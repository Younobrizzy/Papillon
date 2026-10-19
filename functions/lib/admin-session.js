const encoder = new TextEncoder();
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
let cachedGoogleToken = '';
let cachedGoogleTokenExpiry = 0;
let cachedSigningKey = null;
let cachedSigningFingerprint = '';

function base64UrlEncode(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getBearerToken(request) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('Authorization') || '');
  return match ? match[1] : '';
}

async function verifyFirebaseIdToken(idToken, env) {
  const apiKey = String(env.FIREBASE_API_KEY || '').trim();
  if (!apiKey) throw new Error('FIREBASE_API_KEY is not configured.');
  if (!idToken || idToken.length > 8192) return null;
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ idToken })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(result.users) || !result.users[0]) return null;
  const user = result.users[0];
  if (!user.localId || user.disabled === true) return null;
  return { uid: String(user.localId), email: String(user.email || '').trim().toLowerCase() };
}

async function getServiceAccountKey(env) {
  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || '').trim();
  const pem = String(env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!clientEmail || !pem) throw new Error('Firestore service-account credentials are not configured.');
  if (!pem.includes('BEGIN PRIVATE KEY')) throw new Error('FIREBASE_PRIVATE_KEY must contain a PKCS#8 private key PEM.');
  const fingerprint = `${clientEmail}|${pem.slice(0, 48)}|${pem.length}`;
  if (cachedSigningKey && cachedSigningFingerprint === fingerprint) return cachedSigningKey;
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  cachedSigningKey = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  cachedSigningFingerprint = fingerprint;
  return cachedSigningKey;
}

export async function getFirestoreAccessToken(env) {
  if (cachedGoogleToken && cachedGoogleTokenExpiry > Date.now() + 60_000) return cachedGoogleToken;
  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || '').trim();
  if (!projectId || !clientEmail || !String(env.FIREBASE_PRIVATE_KEY || '').trim()) throw new Error('Firestore service-account credentials are not configured.');
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64UrlEncode(JSON.stringify({ iss: clientEmail, scope: 'https://www.googleapis.com/auth/datastore', aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claims}`;
  const key = await getServiceAccountKey(env);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  const assertion = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error('Google OAuth could not issue a Firestore access token.');
  cachedGoogleToken = result.access_token;
  cachedGoogleTokenExpiry = Date.now() + Math.max(60, Number(result.expires_in) || 3600) * 1000;
  return cachedGoogleToken;
}

/**
 * Any active Firebase Authentication account with a valid ID token can use the
 * dashboard. No Firestore role/allowlist document is required. LocalStorage and
 * browser-supplied email values are never accepted as proof of authentication.
 */
export async function readFirebaseSession(request, env) {
  const idToken = getBearerToken(request);
  if (!idToken) return null;
  try {
    const user = await verifyFirebaseIdToken(idToken, env);
    if (!user) return null;
    return { uid: user.uid, email: user.email };
  } catch (error) {
    console.error('[Papillon Firebase Auth] Sign-in verification failed:', error?.message || error);
    return null;
  }
}

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders }
  });
}

export function sameOriginRequest(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim());
}

export function cleanText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
