import { jsonResponse, readAdminSession, sameOriginRequest } from '../lib/admin-session.js';

export async function onRequestGet({ request, env }) {
  const session = await readAdminSession(request, env);
  if (!session) {
    return jsonResponse({
      authenticated: false,
      error: 'This Firebase account is not authorized for the dashboard. Confirm that the user exists in Firebase Authentication and has an admins/{UID} Firestore document with role="administrator" and active=true.'
    }, 401);
  }
  return jsonResponse({ authenticated: true, email: session.email, uid: session.uid });
}

// Kept as a verification endpoint for clients that explicitly POST after sign-in.
// Passwords are never sent to this endpoint; Firebase handles credential checks.
export async function onRequestPost(context) {
  if (!sameOriginRequest(context.request)) return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
  const session = await readAdminSession(context.request, context.env);
  if (!session) return jsonResponse({ authenticated: false, error: 'This Firebase account is not authorized for the dashboard.' }, 401);
  return jsonResponse({ authenticated: true, email: session.email, uid: session.uid });
}

export async function onRequestDelete(context) {
  if (!sameOriginRequest(context.request)) return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
  // Firebase Auth state is cleared by the browser SDK. The server no longer issues a custom login cookie.
  return jsonResponse({ success: true });
}
