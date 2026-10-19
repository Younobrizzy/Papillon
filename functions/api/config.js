// Firebase web configuration is supplied through Cloudflare Pages environment
// variables. These values are intended for the browser Firebase SDK; never add
// Firebase Admin/service-account private keys to this response.
export function onRequestGet({ env }) {
  const required = [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID'
  ];

  for (const key of required) {
    if (!env[key]) {
      return Response.json(
        { error: `Missing configuration: ${key}` },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }
      );
    }
  }

  return Response.json(
    {
      apiKey: env.FIREBASE_API_KEY,
      authDomain: String(env.FIREBASE_AUTH_DOMAIN).trim().replace(/^https?:\/\//i, '').replace(/\/$/, ''),
      projectId: env.FIREBASE_PROJECT_ID,
      storageBucket: env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
      appId: env.FIREBASE_APP_ID
    },
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    }
  );
}
