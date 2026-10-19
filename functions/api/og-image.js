import { readPublicSiteOgImage, readPublicPuppyImage } from '../lib/public-site-script.js';

function parseJpegDataUrl(value) {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value || '').trim());
  if (!match || match[1].length % 4 !== 0) return null;
  const encoded = match[1];
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const byteLength = Math.floor((encoded.length * 3) / 4) - padding;
  if (byteLength < 1 || byteLength > 240 * 1024) return null;
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function missingImage() {
  return new Response('Image not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff' } });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const slug = String(url.searchParams.get('slug') || '').trim().toLowerCase();
  let imageData = '';
  try {
    if (slug) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return new Response('Invalid puppy slug', { status: 400 });
      imageData = await readPublicPuppyImage(env || {}, slug);
      if (!imageData) return missingImage();
    } else {
      imageData = await readPublicSiteOgImage(env || {});
      if (!imageData) {
        return Response.redirect(new URL('/assets/images/og-image.jpg', url.origin).toString(), 302);
      }
    }
  } catch (error) {
    console.error('[Papillon OG image]', error?.message || error);
    return new Response('Social preview image is temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const bytes = parseJpegDataUrl(imageData);
  if (!bytes) return missingImage();
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
