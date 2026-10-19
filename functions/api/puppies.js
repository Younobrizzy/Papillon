import { cleanText, jsonResponse, readFirebaseSession, sameOriginRequest } from '../lib/admin-session.js';
import { getFirebaseSigningKey } from '../lib/firebase-key.js';
import { assertFirestoreDocumentFits } from '../lib/firestore-document-size.js';

const MAX_IMAGE_BYTES = 240 * 1024;
const MAX_GALLERY_IMAGES = 8;
const MAX_REQUEST_CHARS = 4 * 1024 * 1024;
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

function firebaseProjectId(env) {
  return String(env.FIREBASE_PROJECT_ID || '').trim();
}

function dbRoot(env) {
  const projectId = firebaseProjectId(env);
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)`;
}

function documentRoot(env) {
  return `${dbRoot(env)}/documents`;
}

function documentResourceName(env, path) {
  return `projects/${firebaseProjectId(env)}/databases/(default)/documents/${String(path || '').replace(/^\/+/, '')}`;
}

function missingServiceConfig(env) {
  return !firebaseProjectId(env) || !String(env.FIREBASE_CLIENT_EMAIL || '').trim() || !String(env.FIREBASE_PRIVATE_KEY || '').trim();
}

async function getAccessToken(env) {
  if (cachedAccessToken && cachedAccessTokenExpiry > Date.now() + 60_000) return cachedAccessToken;
  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || '').trim();
  if (missingServiceConfig(env)) {
    const error = new Error('Firestore server credentials are not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in Cloudflare.');
    error.status = 503;
    throw error;
  }
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
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
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

async function firestoreRequest(env, path, init = {}) {
  const token = await getAccessToken(env);
  const response = await fetch(`${documentRoot(env)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  if (response.status === 404) return { __notFound: true };
  if (!response.ok) {
    const responseBody = await response.json().catch(() => ({}));
    const error = new Error(`Firestore request failed with status ${response.status}${responseBody.error?.message ? `: ${responseBody.error.message}` : ''}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return {};
  return response.json().catch(() => ({}));
}

async function commitWrites(env, writes) {
  if (!writes.length) return;
  const token = await getAccessToken(env);
  const response = await fetch(`${dbRoot(env)}/documents:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(`Firestore could not save the puppy listing${body.error?.message ? `: ${body.error.message}` : '.'}`);
    error.status = response.status;
    throw error;
  }
}

async function listDocuments(env, collectionPath) {
  const documents = [];
  let pageToken = '';
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ pageSize: '1000' });
    if (pageToken) query.set('pageToken', pageToken);
    const result = await firestoreRequest(env, `${collectionPath}?${query.toString()}`);
    documents.push(...(Array.isArray(result.documents) ? result.documents : []));
    pageToken = result.nextPageToken || '';
    if (!pageToken) break;
  }
  return documents;
}

function fieldValue(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return Boolean(value.booleanValue);
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(fieldValue);
  if (value.mapValue) return readFields(value.mapValue.fields || {});
  return null;
}

function readFields(fields) {
  const output = {};
  for (const [key, value] of Object.entries(fields || {})) output[key] = fieldValue(value);
  return output;
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, firestoreValue(nested)])) } };
  return { nullValue: null };
}

function firestoreFields(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, firestoreValue(value)]));
}

function documentId(document) {
  return String(document?.name || '').split('/').pop() || '';
}

function normalizeSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : '';
}

function publicPuppy(document) {
  const fields = readFields(document?.fields || {});
  const slug = normalizeSlug(fields.slug || documentId(document));
  if (!slug) return null;
  return {
    slug,
    name: cleanText(fields.name, 80),
    gender: cleanText(fields.gender, 24),
    coat: cleanText(fields.coat, 60),
    age: cleanText(fields.age, 80),
    price: Number(fields.price) || 0,
    status: cleanText(fields.status, 80) || 'Looking for a home',
    personality: cleanText(fields.personality, 120),
    image: typeof fields.image === 'string' ? fields.image : '',
    imageAlt: cleanText(fields.imageAlt, 160),
    summary: cleanText(fields.summary, 500),
    details: cleanText(fields.details, 5000),
    galleryCount: Math.max(0, Number(fields.galleryCount) || 0),
    createdAt: typeof fields.createdAt === 'string' ? fields.createdAt : '',
    updatedAt: typeof fields.updatedAt === 'string' ? fields.updatedAt : ''
  };
}

function imageByteSize(value) {
  if (typeof value !== 'string') return -1;
  const match = value.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return -1;
  const base64 = match[1];
  if (base64.length % 4 !== 0) return -1;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function validateImage(value, label) {
  const bytes = imageByteSize(value);
  if (bytes < 0) {
    const error = new Error(`${label} must be a JPEG converted to a base64 data URL. Please choose the image again.`);
    error.status = 400;
    throw error;
  }
  if (bytes > MAX_IMAGE_BYTES) {
    const error = new Error(`${label} exceeds 240 KB after conversion. Please choose another image or reduce its size.`);
    error.status = 413;
    throw error;
  }
  if (bytes === 0) {
    const error = new Error(`${label} is empty. Please choose the image again.`);
    error.status = 400;
    throw error;
  }
  return bytes;
}

async function getDocument(env, path) {
  const result = await firestoreRequest(env, path);
  return result.__notFound ? null : result;
}

async function getPuppy(env, slug, includeGallery = true) {
  const document = await getDocument(env, `/puppies/${encodeURIComponent(slug)}`);
  if (!document) return null;
  const puppy = publicPuppy(document);
  if (!puppy) return null;
  if (includeGallery) {
    const galleryDocuments = await listDocuments(env, `/puppies/${encodeURIComponent(slug)}/gallery`);
    puppy.gallery = galleryDocuments.map(item => {
      const fields = readFields(item.fields || {});
      return {
        id: documentId(item),
        src: typeof fields.image === 'string' ? fields.image : '',
        name: cleanText(fields.name, 160),
        alt: cleanText(fields.alt, 180),
        size: Number(fields.sizeBytes) || 0,
        sortOrder: Number(fields.sortOrder) || 0
      };
    }).filter(item => item.src).sort((a, b) => a.sortOrder - b.sortOrder);
  } else {
    delete puppy.gallery;
  }
  return puppy;
}

function getMutationOriginError(context) {
  if (!sameOriginRequest(context.request)) return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
  return null;
}

async function authorizeDashboardUser(context) {
  const originError = getMutationOriginError(context);
  if (originError) return { response: originError };
  const session = await readFirebaseSession(context.request, context.env);
  if (!session) return { response: jsonResponse({ error: 'Sign in to the dashboard before managing puppy listings.' }, 401) };
  return { session };
}

function errorResponse(error, fallback) {
  // Keep implementation details in server logs; return plain, non-technical messages to the UI.
  console.error('[Papillon puppy API]', error?.message || error);
  const status = Number(error?.status);
  const message = String(error?.message || '');
  const isInternalServiceError = /firestore|google oauth|service[- ]account|datastore|googleapis|access token/i.test(message);
  if (status === 403) {
    return jsonResponse({ error: 'The request could not be completed. Please try again later.' }, 403);
  }
  if ([400, 401, 404, 413].includes(status)) {
    return jsonResponse({ error: isInternalServiceError ? fallback : (message || fallback) }, status);
  }
  if (status === 503) return jsonResponse({ error: fallback }, 503);
  return jsonResponse({ error: fallback }, 500);
}

export async function onRequestGet({ request, env }) {
  try {
    if (missingServiceConfig(env)) {
      return jsonResponse({ error: 'Puppy listings are temporarily unavailable. Please try again later.' }, 503);
    }
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    if (slug !== null) {
      const normalized = normalizeSlug(slug);
      if (!normalized) return jsonResponse({ error: 'A valid puppy slug is required.' }, 400);
      const includeGallery = url.searchParams.get('summary') !== '1';
      const puppy = await getPuppy(env, normalized, includeGallery);
      if (!puppy) return jsonResponse({ error: 'Puppy not found.' }, 404);
      return jsonResponse({ puppy });
    }
    const documents = await listDocuments(env, '/puppies');
    const puppies = documents.map(publicPuppy).filter(item => item && item.name && item.image)
      .sort((a, b) => a.name.localeCompare(b.name));
    return jsonResponse({ puppies });
  } catch (error) {
    return errorResponse(error, 'Unable to load puppy listings. Please try again later.');
  }
}

export async function onRequestPost(context) {
  const auth = await authorizeDashboardUser(context);
  if (auth.response) return auth.response;
  const { request, env } = context;
  try {
    const declaredLength = Number(request.headers.get('Content-Length') || 0);
    if (declaredLength > MAX_REQUEST_CHARS) return jsonResponse({ error: 'The uploaded listing is too large. Each image must be 240 KB or less, with a maximum of 8 additional gallery photos.' }, 413);
    const rawBody = await request.text();
    if (rawBody.length > MAX_REQUEST_CHARS) return jsonResponse({ error: 'The uploaded listing is too large. Each image must be 240 KB or less, with a maximum of 8 additional gallery photos.' }, 413);
    let body;
    try { body = JSON.parse(rawBody); } catch { return jsonResponse({ error: 'Invalid request body.' }, 400); }

    const name = cleanText(body?.name, 80);
    const slug = normalizeSlug(body?.slug);
    const gender = cleanText(body?.gender, 24);
    const coat = cleanText(body?.coat, 60);
    const age = cleanText(body?.age, 80);
    const status = cleanText(body?.status, 80) || 'Looking for a home';
    const personality = cleanText(body?.personality, 120);
    const summary = cleanText(body?.summary, 500);
    const details = cleanText(body?.details, 5000) || summary;
    const price = Number(body?.price);
    const image = body?.image;
    const imageAlt = cleanText(body?.imageAlt, 160) || `${name || 'Papillon'} puppy`;
    if (name.length < 2) return jsonResponse({ error: 'Please enter a puppy name with at least 2 characters.' }, 400);
    if (!slug) return jsonResponse({ error: 'The puppy URL must contain only lowercase letters, numbers, and hyphens.' }, 400);
    if (!age) return jsonResponse({ error: 'Please enter the puppy age.' }, 400);
    if (!Number.isFinite(price) || price < 0 || price > 10000000) return jsonResponse({ error: 'Please enter a valid non-negative price.' }, 400);
    const mainImageBytes = validateImage(image, 'The main image');

    const galleryInput = Array.isArray(body?.gallery) ? body.gallery : [];
    const gallery = [];
    for (const entry of galleryInput) {
      const src = typeof entry === 'string' ? entry : entry?.src;
      if (!src || src === image) continue;
      if (gallery.length >= MAX_GALLERY_IMAGES) return jsonResponse({ error: `You can add no more than ${MAX_GALLERY_IMAGES} additional gallery images.` }, 400);
      const bytes = validateImage(src, `Gallery image ${gallery.length + 1}`);
      const originalName = typeof entry === 'object' ? entry.name : '';
      const originalAlt = typeof entry === 'object' ? entry.alt : '';
      gallery.push({
        src,
        name: cleanText(originalName, 160) || `Gallery photo ${gallery.length + 1}`,
        alt: cleanText(originalAlt, 180) || `${name} puppy photo ${gallery.length + 1}`,
        size: bytes
      });
    }

    const existingDocument = await getDocument(env, `/puppies/${encodeURIComponent(slug)}`);
    const existingFields = existingDocument ? readFields(existingDocument.fields || {}) : {};
    const now = new Date().toISOString();
    const mainFields = {
      slug, name, gender, coat, age, price, status, personality,
      image, imageAlt, imageSizeBytes: mainImageBytes, summary, details,
      galleryCount: gallery.length,
      createdAt: typeof existingFields.createdAt === 'string' ? existingFields.createdAt : now,
      updatedAt: now
    };

    // Enforce the full per-document limit before the batch reaches Firestore.
    // The cover image is in the main listing document; every gallery image has
    // an independent document and is checked separately below.
    assertFirestoreDocumentFits(mainFields, `puppies/${slug}`, 'This puppy listing');

    const galleryPath = `/puppies/${encodeURIComponent(slug)}/gallery`;
    const previousGalleryDocuments = await listDocuments(env, galleryPath);
    const desiredIds = new Set(gallery.map((_, index) => `photo-${String(index + 1).padStart(2, '0')}`));
    const rootName = documentResourceName(env, `puppies/${slug}`);
    const writes = [{ update: { name: rootName, fields: firestoreFields(mainFields) } }];
    gallery.forEach((entry, index) => {
      const photoId = `photo-${String(index + 1).padStart(2, '0')}`;
      const galleryFields = { image: entry.src, name: entry.name, alt: entry.alt, sizeBytes: entry.size, sortOrder: index + 1 };
      assertFirestoreDocumentFits(galleryFields, `puppies/${slug}/gallery/${photoId}`, `Gallery photo ${index + 1}`);
      writes.push({ update: {
        name: `${rootName}/gallery/${photoId}`,
        fields: firestoreFields(galleryFields)
      } });
    });
    previousGalleryDocuments.forEach(document => {
      const id = documentId(document);
      if (!desiredIds.has(id)) writes.push({ delete: `${rootName}/gallery/${id}` });
    });
    await commitWrites(env, writes);
    const savedPuppy = { ...mainFields, gallery: gallery.map((entry, index) => ({
      id: `photo-${String(index + 1).padStart(2, '0')}`,
      src: entry.src, name: entry.name, alt: entry.alt, size: entry.size, sortOrder: index + 1
    })) };
    return jsonResponse({ success: true, puppy: savedPuppy });
  } catch (error) {
    return errorResponse(error, 'Unable to save the puppy listing. Please try again.');
  }
}

export async function onRequestDelete(context) {
  const auth = await authorizeDashboardUser(context);
  if (auth.response) return auth.response;
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const slug = normalizeSlug(url.searchParams.get('slug'));
    if (!slug) return jsonResponse({ error: 'A valid puppy slug is required.' }, 400);
    const galleryDocuments = await listDocuments(env, `/puppies/${encodeURIComponent(slug)}/gallery`);
    const rootName = documentResourceName(env, `puppies/${slug}`);
    const writes = galleryDocuments.map(document => ({ delete: document.name }));
    writes.push({ delete: rootName });
    await commitWrites(env, writes);
    return jsonResponse({ success: true });
  } catch (error) {
    return errorResponse(error, 'Unable to delete the puppy listing. Please try again.');
  }
}
