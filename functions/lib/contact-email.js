import { escapeHtml } from './admin-session.js';

const BRAND = 'Papillon &amp; Co.';
const TAGLINE = 'Little dogs, big love.';
const ACCENT = '#D66E55';
const TEXT = '#29241f';
const MUTED = '#77746d';
const BORDER = '#eee5dc';
const PAPER = '#fffdfa';

function baseTemplate({ eyebrow, title, bodyHtml, footerNote = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};color:${TEXT};font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${PAPER};margin:0;padding:0;">
    <tr><td align="left" style="padding:0;margin:0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;background:${PAPER};margin:0;padding:0;">
        <tr><td style="height:4px;background:${ACCENT};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 24px 26px;">
          <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};">${escapeHtml(eyebrow)}</div>
          <h1 style="margin:8px 0 0;font-size:27px;line-height:34px;color:${TEXT};font-weight:700;">${escapeHtml(title)}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 24px 8px;border-top:1px solid ${BORDER};background:${PAPER};text-align:center;">
          <div style="font-size:13px;line-height:18px;font-weight:700;letter-spacing:.08em;color:${TEXT};">${BRAND}</div>
          <div style="margin-top:4px;font-size:11px;line-height:16px;color:${MUTED};">${TAGLINE}</div>
          ${footerNote ? `<div style="margin-top:8px;font-size:10px;line-height:15px;color:#8a877f;">${escapeHtml(footerNote)}</div>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildContactEmail({ name, email, subject, message, puppy = '', phone = '', shippingAddress = '', shippingAddress2 = '', city = '', region = '', postalCode = '', country = '', preferredPaymentMethod = '', puppySlug = '' }) {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeSubject = escapeHtml(subject);
  const safePuppy = escapeHtml(puppy);
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, '<br>');
  const puppyRow = puppy ? `
      <tr><td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:12px;line-height:18px;color:${MUTED};width:140px;vertical-align:top;">Puppy</td><td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:13px;line-height:20px;color:${TEXT};font-weight:600;">${safePuppy}</td></tr>` : '';
  const extraRows = [
    ['Phone', phone],
    ['Shipping address', [shippingAddress, shippingAddress2, city, region, postalCode, country].filter(Boolean).join('\n')],
    ['Preferred payment method', preferredPaymentMethod],
    ['Listing URL slug', puppySlug]
  ].filter(([, value]) => String(value || '').trim()).map(([label, value]) => `<tr><td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:12px;line-height:18px;color:${MUTED};width:140px;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:13px;line-height:20px;color:${TEXT};overflow-wrap:anywhere;">${escapeHtml(value).replace(/\r?\n/g, '<br>')}</td></tr>`).join('');

  const html = baseTemplate({
    eyebrow: puppy ? 'Puppy enquiry' : 'Website contact form',
    title: 'You have a new message',
    bodyHtml: `
      <p style="margin:14px 0 0;font-size:14px;line-height:22px;color:${MUTED};">A visitor has sent a message through the Papillon &amp; Co. website.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:22px 0 0;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};">
        <tr><td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:12px;line-height:18px;color:${MUTED};width:105px;vertical-align:top;">Name</td><td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:13px;line-height:20px;color:${TEXT};font-weight:600;">${safeName}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:12px;line-height:18px;color:${MUTED};vertical-align:top;">Email</td><td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:13px;line-height:20px;color:${TEXT};word-break:break-word;"><a href="mailto:${safeEmail}" style="color:${ACCENT};text-decoration:underline;">${safeEmail}</a></td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:12px;line-height:18px;color:${MUTED};vertical-align:top;">Subject</td><td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:13px;line-height:20px;color:${TEXT};font-weight:600;">${safeSubject}</td></tr>
        ${puppyRow}
        ${extraRows}
      </table>
      <div style="margin:22px 0 0;">
        <div style="font-size:10px;line-height:14px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">Message</div>
        <div style="padding:16px;border:1px solid ${BORDER};border-radius:8px;background:#ffffff;font-size:14px;line-height:23px;color:${TEXT};overflow-wrap:anywhere;">${safeMessage}</div>
      </div>
      <p style="margin:18px 0 0;font-size:12px;line-height:18px;color:${MUTED};">You can reply directly to this email to respond to ${safeName}.</p>
    `,
    footerNote: 'A message submitted through the Papillon & Co. website.'
  });

  const text = [
    'New message from the Papillon & Co. website',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Subject: ${subject}`,
    ...(puppy ? [`Puppy: ${puppy}`] : []),
    ...(phone ? [`Phone: ${phone}`] : []),
    ...([shippingAddress, shippingAddress2, city, region, postalCode, country].some(Boolean) ? [`Shipping address: ${[shippingAddress, shippingAddress2, city, region, postalCode, country].filter(Boolean).join(', ')}`] : []),
    ...(preferredPaymentMethod ? [`Preferred payment method: ${preferredPaymentMethod}`] : []),
    ...(puppySlug ? [`Listing URL slug: ${puppySlug}`] : []),
    '',
    'Message:',
    message,
    '',
    'You can reply directly to this email to respond to the sender.'
  ].join('\n');
  return { html, text };
}
