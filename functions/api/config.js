// Only the public Firebase Web API key and project ID are exposed to the browser
// Firebase Authentication SDK. Service-account and SMTP secrets never leave
// Cloudflare Pages Functions.
export function onRequestGet({ env }) {
  const apiKey = String(env.FIREBASE_WEB_API_KEY || '').trim();
  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  if (!apiKey || !projectId) {
    return Response.json(
      { error: 'Firebase browser configuration is incomplete. Configure FIREBASE_WEB_API_KEY and FIREBASE_PROJECT_ID.' },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }
  return Response.json({
    apiKey,
    projectId,
    authDomain: `${projectId}.firebaseapp.com`
  }, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
