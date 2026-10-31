import { requireAdmin } from '../../lib/require-admin.js';
import { loadSmtpConfig } from '../../lib/smtp-config.js';
import { verifySmtpSender } from '../../lib/smtp.js';
import { jsonResponse, sameOriginRequest } from '../../lib/admin-session.js';

export async function onRequestPost({ request, env }) {
  if (!sameOriginRequest(request)) return jsonResponse({ success: false, error: 'Request origin is not allowed.' }, 403);
  try {
    await requireAdmin(request, env);
    const smtp = await loadSmtpConfig(env);
    const result = await verifySmtpSender({
      host: smtp.host,
      port: smtp.port,
      security: smtp.security,
      user: smtp.user,
      password: smtp.password,
      fromEmail: smtp.fromEmail,
      ehloName: 'papillon-and-co.com'
    });
    return jsonResponse({
      success: true,
      smtp: 'connected',
      authenticated: true,
      senderAccepted: result.compatible === true,
      transportSecurity: 'TLS'
    });
  } catch (error) {
    console.error('[Papillon SMTP test]', error?.message || error);
    const status = Number(error?.status) || 502;
    const message = status === 401 || status === 403 || status === 400 || status === 503
      ? error.message
      : 'SMTP connection or authentication failed. Check the host, port, username, password, and provider access settings.';
    return jsonResponse({ success: false, error: message }, status);
  }
}
