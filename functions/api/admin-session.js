import { jsonResponse, sameOriginRequest } from '../lib/admin-session.js';
import { requireAdmin } from '../lib/require-admin.js';

export async function onRequestGet({ request, env }) {
  try {
    const session = await requireAdmin(request, env);
    return jsonResponse({ authenticated: true, email: session.email, uid: session.uid, role: 'admin' });
  } catch (error) {
    const status = Number(error?.status) || 503;
    const message = status === 401 || status === 403 ? error.message : 'Administrator access could not be verified. Please try again.';
    return jsonResponse({ authenticated: false, error: message }, status);
  }
}

export async function onRequestPost(context) {
  if (!sameOriginRequest(context.request)) return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
  return onRequestGet(context);
}

export async function onRequestDelete(context) {
  if (!sameOriginRequest(context.request)) return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
  // Firebase Auth state is cleared by the browser SDK. The server issues no login cookie.
  return jsonResponse({ success: true });
}
