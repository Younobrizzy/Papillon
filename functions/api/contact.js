import { decryptSecret } from '../lib/crypto.js';
import { sendSmtp, validateSmtpHost } from '../lib/smtp.js';
import { buildContactEmail } from '../lib/contact-email.js';
import { cleanText, jsonResponse, validEmail, sameOriginRequest } from '../lib/admin-session.js';
import { getPrivateDocument, consumeContactRateLimit } from '../lib/private-firestore.js';

const PRIVATE_PREFERENCES_PATH = 'privateConfig/sitePreferences';
const MAX_BODY_BYTES = 24 * 1024;
const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 10 * 60;

export async function onRequestPost(context) {
  if (!sameOriginRequest(context.request)) return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
  let raw;
  let body;
  try {
    raw = await context.request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return jsonResponse({ error: 'Your message is too long.' }, 413);
    body = JSON.parse(raw);
  } catch { return jsonResponse({ error: 'Please check your form and try again.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse({ error: 'Please check your form and try again.' }, 400);

  // Quietly accept the request but skip sending if a bot fills this hidden field.
  if (String(body.website || '').trim()) return jsonResponse({ success: true, message: 'Your message has been sent successfully.' });

  const name = cleanText(body.name, 100);
  const email = cleanText(body.email, 254).toLowerCase();
  const enquiryType = cleanText(body.enquiryType, 40);
  const isPuppyContact = enquiryType === 'puppy-contact';
  const subject = isPuppyContact ? 'Puppy contact request' : cleanText(body.subject, 180);
  const message = String(body.message || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 8000);
  const puppy = cleanText(body.puppy, 100);
  const puppySlug = cleanText(body.puppySlug, 100).toLowerCase();
  const phone = cleanText(body.phone, 40);
  const shippingAddress = cleanText(body.shippingAddress, 180);
  const shippingAddress2 = cleanText(body.shippingAddress2, 180);
  const city = cleanText(body.city, 100);
  const region = cleanText(body.region, 100);
  const postalCode = cleanText(body.postalCode, 30);
  const country = cleanText(body.country, 100);
  const preferredPaymentMethod = cleanText(body.preferredPaymentMethod, 80);
  if (name.length < 2 || !validEmail(email)) {
    return jsonResponse({ error: 'Please provide your name and a valid email address.' }, 400);
  }
  if (isPuppyContact) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(puppySlug) || shippingAddress.length < 3 || city.length < 2 || country.length < 2 || preferredPaymentMethod.length < 2) {
      return jsonResponse({ error: 'Please complete your shipping address, country, and preferred payment method.' }, 400);
    }
  } else if (subject.length < 2 || message.length < 2) {
    return jsonResponse({ error: 'Please provide a subject and a message.' }, 400);
  }

  const ip = String(context.request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 80);
  const rateKey = await rateLimitKey(ip);
  try {
    const limit = await consumeContactRateLimit(context.env, rateKey, RATE_LIMIT, RATE_WINDOW_SECONDS);
    if (!limit.allowed) {
      return jsonResponse({ error: 'Too many messages have been sent from this connection. Please wait a little before trying again.' }, 429, { 'Retry-After': String(limit.retryAfter || RATE_WINDOW_SECONDS) });
    }
  } catch (error) {
    console.error('Contact form rate limit check failed:', error);
    return jsonResponse({ error: 'The contact form is temporarily unavailable. Please try again later.' }, 503);
  }

  let preferences;
  let listing = null;
  try {
    const results = await Promise.all([
      getPrivateDocument(context.env, PRIVATE_PREFERENCES_PATH),
      isPuppyContact ? getPrivateDocument(context.env, `puppies/${puppySlug}`) : Promise.resolve(null)
    ]);
    preferences = results[0];
    if (isPuppyContact) listing = results[1];
  } catch (error) {
    console.error('Contact form could not read private settings or puppy listing:', error);
    return jsonResponse({ error: 'The contact form is temporarily unavailable. Please try again later.' }, 503);
  }
  if (isPuppyContact && !listing) return jsonResponse({ error: 'This puppy listing is no longer available. Please return to the available puppies page.' }, 404);
  const recipient = String(preferences?.email || '').trim().toLowerCase();
  const smtp = preferences?.smtp || {};
  if (!validEmail(recipient)) return jsonResponse({ error: 'The contact email has not been configured yet.' }, 503);
  if (!smtp.host || !smtp.port || !smtp.username || !smtp.passwordCiphertext || !smtp.passwordIv) {
    return jsonResponse({ error: 'Outgoing email has not been configured yet.' }, 503);
  }

  try {
    validateSmtpHost(smtp.host);
    const password = await decryptSecret(smtp.passwordCiphertext, smtp.passwordIv, context.env);
    const verifiedPuppyName = isPuppyContact ? cleanText(listing?.name, 100) : puppy;
    const composedMessage = isPuppyContact
      ? [
          message ? `Additional notes:\n${message}` : '',
          `Shipping address: ${[shippingAddress, shippingAddress2, city, region, postalCode, country].filter(Boolean).join(', ')}`,
          `Preferred payment method: ${preferredPaymentMethod}`
        ].filter(Boolean).join('\n\n')
      : message;
    const composed = buildContactEmail({
      name, email, subject: isPuppyContact ? `Contact request for ${verifiedPuppyName}` : subject,
      message: composedMessage, puppy: verifiedPuppyName, phone, shippingAddress, shippingAddress2,
      city, region, postalCode, country, preferredPaymentMethod, puppySlug: isPuppyContact ? puppySlug : ''
    });
    const messageSubject = `${isPuppyContact ? 'Puppy contact request' : (puppy ? 'Puppy enquiry' : 'Website contact')}: ${isPuppyContact ? verifiedPuppyName : subject}`.slice(0, 220);
    const requestHost = new URL(context.request.url).hostname;
    await sendSmtp({
      host: smtp.host,
      port: Number(smtp.port),
      security: smtp.security || (Number(smtp.port) === 465 ? 'ssl' : 'starttls'),
      user: smtp.username,
      password,
      fromEmail: smtp.username,
      fromName: 'Papillon & Co.',
      ehloName: /^[a-z0-9.-]+$/i.test(requestHost) ? requestHost : 'localhost',
      payload: {
        to: [recipient],
        replyTo: email,
        subject: messageSubject,
        message: composed.text,
        html: composed.html
      }
    });
    return jsonResponse({ success: true, message: 'Your message has been sent successfully.' });
  } catch (error) {
    console.error('Papillon contact email send failed:', error);
    return jsonResponse({ error: 'We could not send your message right now. Please try again in a moment.' }, 502);
  }
}

async function rateLimitKey(ip) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const shortHash = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '').slice(0, 32);
  return shortHash;
}
