import { readFirebaseSession } from './admin-session.js';
import { getPrivateDocument } from './private-firestore.js';

export class AdminAuthorizationError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AdminAuthorizationError';
    this.status = status;
  }
}

/** Server-verified Firebase identity plus a deterministic admin/{uid} grant. */
export async function requireAdmin(request, env) {
  const user = await readFirebaseSession(request, env);
  if (!user) throw new AdminAuthorizationError(401, 'Sign in with an authorized administrator account.');
  const document = await getPrivateDocument(env, `admin/${user.uid}`);
  const data = document || {};
  const status = String(data.status || '').toLowerCase();
  const allowed = data.role === 'admin'
    && String(data.uid || '') === user.uid
    && data.disabled !== true
    && data.active !== false
    && !['disabled', 'revoked'].includes(status);
  if (!allowed) throw new AdminAuthorizationError(403, 'This Firebase account is not authorized to manage Papillon & Co.');
  return { ...user, role: 'admin' };
}

export function adminErrorResponse(error, jsonResponse) {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return jsonResponse({ authenticated: false, error: error.message }, status);
  return null;
}
