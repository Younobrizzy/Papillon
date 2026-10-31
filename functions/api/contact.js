import { sendSmtp, validateSmtpHost } from '../lib/smtp.js';
import { buildContactEmail, buildCustomerConfirmationEmail } from '../lib/contact-email.js';
import { cleanText, jsonResponse, validEmail, sameOriginRequest } from '../lib/admin-session.js';
import { getPrivateDocument, consumeContactRateLimit } from '../lib/private-firestore.js';
import { loadSmtpConfig } from '../lib/smtp-config.js';

const PRIVATE_PREFERENCES_PATH = 'privateConfig/sitePreferences';
const MAX_BODY_BYTES = 24 * 1024;
const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 10 * 60;

export async function onRequestPost(context) {
  if (!sameOriginRequest(context.request)) return jsonResponse({ error: 'Request origin is not allowed.' }, 403);
  let body;
  try {
    const raw = await context.request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return jsonResponse({ error: 'Your message is too long.' }, 413);
    body = JSON.parse(raw);
  } catch { return jsonResponse({ error: 'Please check your form and try again.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse({ error: 'Please check your form and try again.' }, 400);
  if (String(body.website || '').trim()) return jsonResponse({ success: true, message: 'Your message has been sent successfully.' });

  const name = cleanText(body.name, 100);
  const email = cleanText(body.email, 254).toLowerCase();
  const enquiryType = cleanText(body.enquiryType, 40);
  const isPuppyContact = enquiryType === 'puppy-contact';
  const subject = isPuppyContact ? '' : cleanText(body.subject, 180);
  const message = String(body.message || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 8000);
  const puppy = cleanText(body.puppy, 100);
  const puppySlug = cleanText(body.puppySlug, 100).toLowerCase();
  const phone = cleanText(body.phone, 40);
  const shippingAddress = cleanText(body.shippingAddress, 180);
  const shippingAddress2 = cleanText(body.shippingAddress2, 180);
  const city = cleanText(body.city, 100);
  const region = cleanText(body.region, 100);
  const postalCode = cleanText(body.postalCode, 30);
  const preferredPaymentMethod = cleanText(body.preferredPaymentMethod, 80);
  if (name.length < 2 || !validEmail(email)) return jsonResponse({ error: 'Please provide your name and a valid email address.' }, 400);
  if (isPuppyContact) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(puppySlug) || shippingAddress.length < 3 || city.length < 2 || preferredPaymentMethod.length < 2) {
      return jsonResponse({ error: 'Please complete your shipping address and preferred payment method.' }, 400);
    }
  } else if (subject.length < 2 || message.length < 2) {
    return jsonResponse({ error: 'Please provide a subject and a message.' }, 400);
  }

  const ip = String(context.request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 80);
  const rateKey = await rateLimitKey(ip);
  try {
    const limit = await consumeContactRateLimit(context.env, rateKey, RATE_LIMIT, RATE_WINDOW_SECONDS);
    if (!limit.allowed) return jsonResponse({ error: 'Too many messages have been sent from this connection. Please wait a little before trying again.' }, 429, { 'Retry-After': String(limit.retryAfter || RATE_WINDOW_SECONDS) });
  } catch (error) {
    console.error('Contact form rate limit check failed:', error);
    return jsonResponse({ error: 'The contact form is temporarily unavailable. Please try again later.' }, 503);
  }

  let preferences;
  let listing = null;
  let smtp;
  try {
    const [savedPreferences, puppyDocument, smtpConfig] = await Promise.all([
      getPrivateDocument(context.env, PRIVATE_PREFERENCES_PATH),
      isPuppyContact ? getPrivateDocument(context.env, `puppies/${puppySlug}`) : Promise.resolve(null),
      loadSmtpConfig(context.env)
    ]);
    preferences = savedPreferences;
    if (isPuppyContact) listing = puppyDocument;
    smtp = smtpConfig;
  } catch (error) {
    console.error('Contact form could not load its delivery configuration:', error?.message || error);
    return jsonResponse({ error: 'The contact service is temporarily unavailable. Please try again later.' }, error?.status || 503);
  }
  if (isPuppyContact && !listing) return jsonResponse({ error: 'This puppy listing is no longer available. Please return to the available puppies page.' }, 404);
  const recipient = String(preferences?.email || '').trim().toLowerCase();
  if (!validEmail(recipient)) return jsonResponse({ error: 'The contact email has not been configured yet.' }, 503);

  try {
    validateSmtpHost(smtp.host, context.env);
    const verifiedPuppyName = isPuppyContact ? cleanText(listing?.title || listing?.name, 100) : puppy;
    const composedMessage = isPuppyContact
      ? [
          message ? `Additional notes:\n${message}` : '',
          `Shipping address: ${[shippingAddress, shippingAddress2, city, region, postalCode].filter(Boolean).join(', ')}`,
          `Preferred payment method: ${preferredPaymentMethod}`
        ].filter(Boolean).join('\n\n')
      : message;
    const messageSubject = (isPuppyContact
      ? `A little hello about ${verifiedPuppyName} 🐾 | Papillon & Co.`
      : subject).slice(0, 220);
    const composed = buildContactEmail({
      name, email, subject: messageSubject, message: composedMessage,
      puppy: verifiedPuppyName, phone, shippingAddress, shippingAddress2,
      city, region, postalCode, preferredPaymentMethod, puppySlug: isPuppyContact ? puppySlug : ''
    });
    const hostName = new URL(context.request.url).hostname;
    const transport = {
      host: smtp.host,
      port: smtp.port,
      security: smtp.security,
      user: smtp.user,
      password: smtp.password,
      fromEmail: smtp.fromEmail,
      envelopeFromEmail: smtp.user,
      fromName: smtp.fromName,
      ehloName: /^[a-z0-9.-]+$/i.test(hostName) ? hostName : 'localhost'
    };
    const adminEmail = sendSmtp({
      ...transport,
      payload: {
        to: [recipient],
        // The only public-form Reply-To: the admin can reply to the visitor.
        replyTo: email,
        subject: messageSubject,
        message: composed.text,
        html: composed.html
      }
    });
    const confirmation = buildCustomerConfirmationEmail({ name, email, puppy: verifiedPuppyName, subject: messageSubject });
    const customerEmail = sendSmtp({
      ...transport,
      payload: {
        to: [email],
        subject: `We received your message | Papillon & Co.`,
        message: confirmation.text,
        html: confirmation.html
        // Intentionally no Reply-To on system-to-customer mail.
      }
    });
    const [adminResult, customerResult] = await Promise.allSettled([adminEmail, customerEmail]);
    if (adminResult.status === 'rejected') throw adminResult.reason;
    if (customerResult.status === 'rejected') {
      console.error('Papillon customer confirmation email failed:', customerResult.reason?.message || customerResult.reason);
    }
    return jsonResponse({
      success: true,
      message: customerResult.status === 'fulfilled'
        ? 'Your message has been sent successfully. A confirmation email is on its way.'
        : 'Your message has been received successfully. We could not send the confirmation email, but our team has your enquiry.',
      notificationSent: true,
      confirmationSent: customerResult.status === 'fulfilled'
    });
  } catch (error) {
    console.error('Papillon contact email send failed:', error?.message || error);
    return jsonResponse({ error: 'We could not send your message right now. Please try again in a moment.' }, 502);
  }
}

async function rateLimitKey(ip) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '').slice(0, 32);
}
