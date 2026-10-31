import { requireAdmin } from '../lib/require-admin.js';
import { loadSmtpConfig } from '../lib/smtp-config.js';
import { sendSmtp, validateSmtpHost } from '../lib/smtp.js';
import { cleanText, jsonResponse, sameOriginRequest, validEmail } from '../lib/admin-session.js';

const MAX_BODY_LENGTH = 200_000;

function recipients(value, label, required = false) {
  if (value === undefined && !required) return [];
  const list = Array.isArray(value) ? value : [value];
  if (!list.length) throw Object.assign(new Error(`${label} cannot be empty.`), { status: 400 });
  const normalized = list.map(item => String(item || '').trim().toLowerCase());
  if (normalized.some(item => !validEmail(item))) throw Object.assign(new Error(`Enter valid ${label} email addresses.`), { status: 400 });
  return [...new Set(normalized)];
}

export async function onRequestPost({ request, env }) {
  try {
    if (!sameOriginRequest(request)) return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
    await requireAdmin(request, env);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 250 * 1024) return jsonResponse({ error: 'The email payload is too large.' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return jsonResponse({ error: 'Invalid email payload.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse({ error: 'Invalid email payload.' }, 400);
    if (['from', 'fromEmail', 'fromName', 'sender', 'replyTo'].some(key => Object.hasOwn(body, key))) {
      return jsonResponse({ error: 'Sender identity and Reply-To are managed by the server.' }, 400);
    }
    const to = recipients(body.to, 'recipient', true);
    const cc = recipients(body.cc, 'CC');
    const bcc = recipients(body.bcc, 'BCC');
    if (new Set([...to, ...cc, ...bcc]).size > 20) return jsonResponse({ error: 'A message can have at most 20 unique recipients.' }, 400);
    const subject = cleanText(body.subject, 250);
    if (!subject || /[\r\n\0]/.test(subject)) return jsonResponse({ error: 'Enter a valid email subject.' }, 400);
    let message = '';
    let html;
    const content = body.message ?? body.content;
    if (typeof content === 'string') message = content;
    else if (content && typeof content === 'object' && !Array.isArray(content)) {
      message = typeof content.text === 'string' ? content.text : '';
      html = typeof content.html === 'string' ? content.html : undefined;
    }
    if (!(message.trim()) && !(html && html.trim())) return jsonResponse({ error: 'Provide non-empty text or HTML email content.' }, 400);
    if (message.length + (html?.length || 0) > MAX_BODY_LENGTH) return jsonResponse({ error: 'The email body is too large.' }, 413);

    const smtp = await loadSmtpConfig(env);
    validateSmtpHost(smtp.host, env);
    const hostName = new URL(request.url).hostname;
    const result = await sendSmtp({
      host: smtp.host,
      port: smtp.port,
      security: smtp.security,
      user: smtp.user,
      password: smtp.password,
      fromEmail: smtp.fromEmail,
      envelopeFromEmail: smtp.user,
      fromName: smtp.fromName,
      ehloName: /^[a-z0-9.-]+$/i.test(hostName) ? hostName : 'localhost',
      payload: {
        to,
        ...(cc.length ? { cc } : {}),
        ...(bcc.length ? { bcc } : {}),
        subject,
        message,
        ...(html !== undefined ? { html } : {})
        // No Reply-To is emitted for administrator/system-to-customer mail.
      }
    });
    return jsonResponse({ success: true, status: 'accepted_by_smtp', messageId: result.messageId });
  } catch (error) {
    console.error('[Papillon email send]', error?.message || error);
    const status = Number(error?.status) || 502;
    const message = [400, 401, 403, 413, 503].includes(status)
      ? error.message
      : 'The email could not be sent. Check the SMTP configuration and try again.';
    return jsonResponse({ success: false, error: message }, status);
  }
}
