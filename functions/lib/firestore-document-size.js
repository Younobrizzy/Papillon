// Cloud Firestore document-size accounting for Standard edition.
// Firestore's REST resource has a documented 1 MiB - 4 byte maximum, so use
// that stricter cap to avoid a request being rejected at the boundary.
const UTF8 = new TextEncoder();

export const FIRESTORE_DOCUMENT_LIMIT_BYTES = 1024 * 1024;
export const FIRESTORE_DOCUMENT_MAX_SAFE_BYTES = FIRESTORE_DOCUMENT_LIMIT_BYTES - 4;

function utf8Bytes(value) {
  return UTF8.encode(String(value)).byteLength;
}

function stringSize(value) {
  return utf8Bytes(value) + 1;
}

function firestoreValueSize(value) {
  if (value === null || value === undefined) return 1;
  if (typeof value === 'string') return stringSize(value);
  if (typeof value === 'boolean') return 1;
  if (typeof value === 'number') return 8;
  if (value instanceof Date) return 8;
  if (Array.isArray(value)) return value.reduce((total, entry) => total + firestoreValueSize(entry), 0);
  if (typeof value === 'object') {
    return 32 + Object.entries(value).reduce((total, [name, nested]) => (
      total + stringSize(name) + firestoreValueSize(nested)
    ), 0);
  }
  return 1;
}

function documentNameSize(documentPath) {
  const segments = String(documentPath || '').split('/').filter(Boolean);
  return 16 + segments.reduce((total, segment) => total + stringSize(segment), 0);
}

/** Estimate Firestore storage bytes for a document, including its name and overhead. */
export function estimateFirestoreDocumentSizeBytes(fields, documentPath) {
  const fieldBytes = Object.entries(fields || {}).reduce((total, [name, value]) => (
    total + stringSize(name) + firestoreValueSize(value)
  ), 0);
  return documentNameSize(documentPath) + fieldBytes + 32;
}

/** Throw a user-safe 413 error if the complete document would exceed the safe cap. */
export function assertFirestoreDocumentFits(fields, documentPath, label = 'This item') {
  const sizeBytes = estimateFirestoreDocumentSizeBytes(fields, documentPath);
  if (sizeBytes > FIRESTORE_DOCUMENT_MAX_SAFE_BYTES) {
    const error = new Error(`${label} is too large to save. Please choose a smaller photo or shorten the listing text.`);
    error.status = 413;
    error.documentSizeBytes = sizeBytes;
    error.documentLimitBytes = FIRESTORE_DOCUMENT_MAX_SAFE_BYTES;
    throw error;
  }
  return sizeBytes;
}
