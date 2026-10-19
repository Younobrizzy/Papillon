import { readPublicSiteScript } from '../lib/public-site-script.js';

export async function onRequestGet({ env }) {
  try {
    const saved = await readPublicSiteScript(env);
    return Response.json(
      { success: true, script: saved.script, phoneNumber: saved.phoneNumber || '', updatedAt: saved.updatedAt || null },
      {
        headers: {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  } catch (error) {
    // Keep the public site usable if the script service is temporarily unavailable.
    // The dashboard save endpoint returns a visible error so configuration problems are not hidden.
    console.error('Public site script could not be loaded:', error);
    return Response.json(
      { success: false, script: '', phoneNumber: '', error: 'Public site scripts are temporarily unavailable.' },
      { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
