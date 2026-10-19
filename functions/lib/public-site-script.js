import { getFirebaseSigningKey } from './firebase-key.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const encoder = new TextEncoder();
let cachedAccessToken = '';
let cachedAccessTokenExpiry = 0;

function base64UrlEncode(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function assertFirestoreConfig(env) {
  if (!String(env.FIREBASE_PROJECT_ID || '').trim() || !String(env.FIREBASE_CLIENT_EMAIL || '').trim() || !String(env.FIREBASE_PRIVATE_KEY || '').trim()) {
    const error = new Error('Firestore server credentials are not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in Cloudflare.');
    error.status = 503;
    throw error;
  }
}

async function getAccessToken(env) {
  assertFirestoreConfig(env);
  if (cachedAccessToken && cachedAccessTokenExpiry > Date.now() + 60_000) return cachedAccessToken;
  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || '').trim();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64UrlEncode(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claims}`;
  const key = await getFirebaseSigningKey(env);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  const assertion = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    const error = new Error('Google OAuth could not issue a Firestore access token. Check the service-account email and private key in Cloudflare.');
    error.status = 503;
    throw error;
  }
  cachedAccessToken = result.access_token;
  cachedAccessTokenExpiry = Date.now() + Math.max(60, Number(result.expires_in) || 3600) * 1000;
  return cachedAccessToken;
}

function documentUrl(env, path = 'siteConfig/public') {
  const projectId = encodeURIComponent(String(env.FIREBASE_PROJECT_ID || '').trim());
  const documentPath = String(path || '').replace(/^\/+/, '');
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`;
}

function readFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return Boolean(value.booleanValue);
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(readFirestoreValue);
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, nested]) => [key, readFirestoreValue(nested)]));
  return null;
}

function documentFields(document) {
  return Object.fromEntries(Object.entries(document?.fields || {}).map(([key, value]) => [key, readFirestoreValue(value)]));
}

async function firestoreFetch(env, url, init = {}) {
  const token = await getAccessToken(env);
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
}

export async function readPublicSiteScript(env) {
  // Restrict normal site-config reads to small public fields. The social image is
  // stored separately so every page request does not download hundreds of KB.
  const configUrl = new URL(documentUrl(env));
  for (const fieldPath of ['script', 'phoneNumber', 'siteTitle', 'siteBranding', 'siteDescription', 'siteOgImageAvailable', 'updatedAt']) {
    configUrl.searchParams.append('mask.fieldPaths', fieldPath);
  }
  const response = await firestoreFetch(env, configUrl.toString());
  if (response.status === 404) {
    return {
      exists: false, script: '', phoneNumber: '', updatedAt: '',
      siteTitle: '', siteBranding: '', siteDescription: '', hasSiteOgImage: false
    };
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Could not read Firestore public site configuration${result.error?.message ? `: ${result.error.message}` : '.'}`);
    error.status = response.status >= 500 ? 503 : response.status;
    throw error;
  }
  const fields = documentFields(result);
  return {
    exists: true,
    script: typeof fields.script === 'string' ? fields.script : '',
    phoneNumber: typeof fields.phoneNumber === 'string' ? fields.phoneNumber : '',
    siteTitle: typeof fields.siteTitle === 'string' ? fields.siteTitle : '',
    siteBranding: typeof fields.siteBranding === 'string' ? fields.siteBranding : '',
    siteDescription: typeof fields.siteDescription === 'string' ? fields.siteDescription : '',
    hasSiteOgImage: Boolean(fields.siteOgImageAvailable),
    updatedAt: typeof fields.updatedAt === 'string' ? fields.updatedAt : ''
  };
}

async function readPuppyDocumentWithMask(env, slug, fieldPaths) {
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) return null;
  const url = new URL(documentUrl(env, `puppies/${encodeURIComponent(normalizedSlug)}`));
  for (const fieldPath of fieldPaths) url.searchParams.append('mask.fieldPaths', fieldPath);
  const response = await firestoreFetch(env, url.toString());
  if (response.status === 404) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Could not read puppy social metadata${result.error?.message ? `: ${result.error.message}` : '.'}`);
    error.status = response.status >= 500 ? 503 : response.status;
    throw error;
  }
  return { slug: normalizedSlug, ...documentFields(result) };
}

export async function readPublicPuppySocial(env, slug) {
  const fields = await readPuppyDocumentWithMask(env, slug, [
    'slug', 'name', 'gender', 'coat', 'age', 'price', 'status', 'personality', 'summary', 'details', 'imageAlt'
  ]);
  if (!fields) return null;
  const storedSlug = String(fields.slug || slug).trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storedSlug)) return null;
  return {
    slug: storedSlug,
    name: String(fields.name || '').trim(),
    gender: String(fields.gender || '').trim(),
    coat: String(fields.coat || '').trim(),
    age: String(fields.age || '').trim(),
    price: Number(fields.price) || 0,
    status: String(fields.status || 'Looking for a home').trim(),
    personality: String(fields.personality || '').trim(),
    summary: String(fields.summary || '').trim(),
    details: String(fields.details || '').trim(),
    imageAlt: String(fields.imageAlt || '').trim()
  };
}

export async function readPublicPuppyImage(env, slug) {
  const fields = await readPuppyDocumentWithMask(env, slug, ['image']);
  return fields && typeof fields.image === 'string' ? fields.image : '';
}

export async function readPublicSiteOgImage(env) {
  const response = await firestoreFetch(env, documentUrl(env, 'siteConfig/siteOgImage'));
  if (response.ok) {
    const result = await response.json().catch(() => ({}));
    const fields = documentFields(result);
    // An existing image document is authoritative, including an intentionally
    // empty image after the owner removes their custom preview.
    return typeof fields.image === 'string' ? fields.image : '';
  } else if (response.status !== 404) {
    const result = await response.json().catch(() => ({}));
    const error = new Error(`Could not read the public social preview image${result.error?.message ? `: ${result.error.message}` : '.'}`);
    error.status = response.status >= 500 ? 503 : response.status;
    throw error;
  }

  // Backward compatibility for installations that stored the image directly
  // on siteConfig/public before it was moved into its own document. This large
  // field is requested only by the dashboard or the image endpoint, not on page
  // HTML and public-script configuration reads.
  const legacyUrl = new URL(documentUrl(env));
  legacyUrl.searchParams.append('mask.fieldPaths', 'siteOgImage');
  const legacyResponse = await firestoreFetch(env, legacyUrl.toString());
  if (legacyResponse.status === 404) return '';
  const legacyResult = await legacyResponse.json().catch(() => ({}));
  if (!legacyResponse.ok) {
    const error = new Error(`Could not read the legacy social preview image${legacyResult.error?.message ? `: ${legacyResult.error.message}` : '.'}`);
    error.status = legacyResponse.status >= 500 ? 503 : legacyResponse.status;
    throw error;
  }
  const legacyFields = documentFields(legacyResult);
  return typeof legacyFields.siteOgImage === 'string' ? legacyFields.siteOgImage : '';
}

export async function writePublicSiteScript(env, script, phoneNumber = '', metadata = {}) {
  const site = metadata && typeof metadata === 'object' ? metadata : {};
  const siteOgImage = String(site.siteOgImage || '');

  // Store the large Base64 social image in a separate document so routine public
  // config reads (phone number/live-chat snippet/page metadata) remain lightweight.
  const imageUrl = new URL(documentUrl(env, 'siteConfig/siteOgImage'));
  imageUrl.searchParams.append('updateMask.fieldPaths', 'image');
  imageUrl.searchParams.append('updateMask.fieldPaths', 'updatedAt');
  const imageResponse = await firestoreFetch(env, imageUrl.toString(), {
    method: 'PATCH',
    body: JSON.stringify({ fields: { image: { stringValue: siteOgImage }, updatedAt: { timestampValue: new Date().toISOString() } } })
  });
  const imageResult = await imageResponse.json().catch(() => ({}));
  if (!imageResponse.ok) {
    const error = new Error(`Could not save the social preview image to Firestore${imageResult.error?.message ? `: ${imageResult.error.message}` : '.'}`);
    error.status = imageResponse.status >= 500 ? 503 : imageResponse.status;
    throw error;
  }

  const url = new URL(documentUrl(env));
  [
    'script', 'phoneNumber', 'siteTitle', 'siteBranding', 'siteDescription', 'siteOgImageAvailable', 'updatedAt'
  ].forEach(field => url.searchParams.append('updateMask.fieldPaths', field));
  const response = await firestoreFetch(env, url.toString(), {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        script: { stringValue: script },
        phoneNumber: { stringValue: phoneNumber },
        siteTitle: { stringValue: String(site.siteTitle || '') },
        siteBranding: { stringValue: String(site.siteBranding || '') },
        siteDescription: { stringValue: String(site.siteDescription || '') },
        siteOgImageAvailable: { booleanValue: Boolean(siteOgImage) },
        updatedAt: { timestampValue: new Date().toISOString() }
      }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Could not save the public site configuration to Firestore${result.error?.message ? `: ${result.error.message}` : '.'}`);
    error.status = response.status >= 500 ? 503 : response.status;
    throw error;
  }
  return { updatedAt: result.fields?.updatedAt?.timestampValue || new Date().toISOString() };
}
