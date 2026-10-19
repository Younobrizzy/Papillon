import { getFirestoreAccessToken } from './admin-session.js';

function projectId(env) {
  const value = String(env.FIREBASE_PROJECT_ID || '').trim();
  if (!value) {
    const error = new Error('FIREBASE_PROJECT_ID is not configured.');
    error.status = 503;
    throw error;
  }
  return value;
}

function documentsRoot(env) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId(env))}/databases/(default)/documents`;
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)])) } };
  return { stringValue: String(value) };
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.hasOwn(value, 'stringValue')) return value.stringValue;
  if (Object.hasOwn(value, 'integerValue')) return Number(value.integerValue);
  if (Object.hasOwn(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.hasOwn(value, 'booleanValue')) return Boolean(value.booleanValue);
  if (Object.hasOwn(value, 'timestampValue')) return value.timestampValue;
  if (Object.hasOwn(value, 'nullValue')) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue);
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeValue(item)]));
  return null;
}

function decodeDocument(document) {
  if (!document) return null;
  return Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decodeValue(value)]));
}

async function request(env, url, init = {}) {
  const token = await getFirestoreAccessToken(env);
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  return response;
}

function firestoreError(response, payload, fallback) {
  const error = new Error(`${fallback}${payload?.error?.message ? `: ${payload.error.message}` : ` (HTTP ${response.status})`}`);
  error.status = response.status >= 500 ? 503 : response.status;
  return error;
}

export async function getPrivateDocument(env, path) {
  const response = await request(env, `${documentsRoot(env)}/${path}`);
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw firestoreError(response, payload, 'Could not read private Firestore configuration');
  return decodeDocument(payload);
}

export async function setPrivateDocument(env, path, data) {
  const fields = Object.fromEntries(Object.entries(data || {}).map(([key, value]) => [key, encodeValue(value)]));
  const response = await request(env, `${documentsRoot(env)}/${path}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw firestoreError(response, payload, 'Could not save private Firestore configuration');
  return decodeDocument(payload);
}

/**
 * Atomically increments a per-IP contact counter in Firestore. The counter
 * resets after the window; expiresAt can also be configured as a Firestore TTL
 * field so old rate-limit documents are eventually removed automatically.
 */
export async function consumeContactRateLimit(env, documentId, limit, windowSeconds) {
  const path = `contactRateLimits/${documentId}`;
  const root = documentsRoot(env);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const begin = await request(env, `${root}:beginTransaction`, {
      method: 'POST',
      body: JSON.stringify({ options: { readWrite: {} } })
    });
    const beginBody = await begin.json().catch(() => ({}));
    if (!begin.ok || !beginBody.transaction) throw firestoreError(begin, beginBody, 'Could not start contact rate-limit transaction');

    const transaction = beginBody.transaction;
    const transactionQuery = new URLSearchParams({ transaction });
    const read = await request(env, `${root}/${path}?${transactionQuery.toString()}`);
    let existing = null;
    if (read.status !== 404) {
      existing = await read.json().catch(() => ({}));
      if (!read.ok) throw firestoreError(read, existing, 'Could not read contact rate limit');
    }

    const now = Math.floor(Date.now() / 1000);
    const saved = decodeDocument(existing) || {};
    const savedStart = Number(saved.windowStartedAt || 0);
    const activeWindow = savedStart > 0 && now - savedStart < windowSeconds;
    const windowStartedAt = activeWindow ? savedStart : now;
    const currentCount = activeWindow ? Number(saved.count || 0) : 0;
    const retryAfter = activeWindow ? Math.max(1, windowSeconds - (now - savedStart)) : windowSeconds;

    if (currentCount >= limit) {
      // End the read-only transaction with an empty commit.
      await request(env, `${root}:commit`, {
        method: 'POST',
        body: JSON.stringify({ transaction, writes: [] })
      });
      return { allowed: false, retryAfter };
    }

    const fields = {
      count: { integerValue: String(currentCount + 1) },
      windowStartedAt: { integerValue: String(windowStartedAt) },
      expiresAt: { timestampValue: new Date((windowStartedAt + windowSeconds + 86400) * 1000).toISOString() }
    };
    const write = {
      update: {
        name: `projects/${projectId(env)}/databases/(default)/documents/${path}`,
        fields
      },
      currentDocument: existing?.updateTime ? { updateTime: existing.updateTime } : { exists: false }
    };
    const commit = await request(env, `${root}:commit`, {
      method: 'POST',
      body: JSON.stringify({ transaction, writes: [write] })
    });
    const commitBody = await commit.json().catch(() => ({}));
    if (commit.ok) return { allowed: true, retryAfter };
    const isConflict = commit.status === 409 || /ABORTED|transaction/i.test(String(commitBody?.error?.status || commitBody?.error?.message || ''));
    if (isConflict && attempt < 2) continue;
    throw firestoreError(commit, commitBody, 'Could not update contact rate limit');
  }
  return { allowed: false, retryAfter: windowSeconds };
}
