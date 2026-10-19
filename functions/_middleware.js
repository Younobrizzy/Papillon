import { readPublicSiteScript, readPublicPuppySocial } from './lib/public-site-script.js';

const DEFAULT_SITE_TITLE = 'Papillon & Co. — Little dogs, big love';
const DEFAULT_SITE_BRANDING = 'Papillon & Co.';
const DEFAULT_SITE_DESCRIPTION = 'Meet our charming Papillon puppies, raised with care and ready to find their forever homes.';
const PAGE_DESCRIPTIONS = {
  '/shipping/': 'Read how we plan puppy travel and delivery arrangements with care, safety, and clear communication.'
};
const CACHE_TTL_MS = 10_000;
let publicSettingsCache = { expiresAt: 0, value: null, promise: null };
const puppyCache = new Map();

function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function tidyText(value, maxLength = 400) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeSlug(value) {
  let slug = String(value || '').trim();
  try { slug = decodeURIComponent(slug); } catch (_) { /* keep the original value */ }
  slug = slug.toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : '';
}

async function loadSettings(env) {
  if (publicSettingsCache.value && publicSettingsCache.expiresAt > Date.now()) return publicSettingsCache.value;
  if (publicSettingsCache.promise) return publicSettingsCache.promise;
  publicSettingsCache.promise = readPublicSiteScript(env)
    .then(value => {
      publicSettingsCache = { value, expiresAt: Date.now() + CACHE_TTL_MS, promise: null };
      return value;
    })
    .catch(error => {
      publicSettingsCache = { value: null, expiresAt: 0, promise: null };
      throw error;
    });
  return publicSettingsCache.promise;
}

async function loadPuppy(env, slug) {
  const cached = puppyCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await readPublicPuppySocial(env, slug);
  puppyCache.set(slug, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (puppyCache.size > 100) {
    for (const [key, item] of puppyCache) if (item.expiresAt <= Date.now()) puppyCache.delete(key);
    if (puppyCache.size > 100) puppyCache.delete(puppyCache.keys().next().value);
  }
  return value;
}

function resolveListingSlug(pathname, url) {
  if (pathname === '/puppy.html') return safeSlug(url.searchParams.get('slug'));
  const raw = pathname.replace(/^\/+|\/+$/g, '');
  if (!raw || raw.includes('.') || raw.includes('/')) return '';
  if (['dashboard', 'shipping', 'contact', 'api', 'assets', 'admin', '404'].includes(raw)) return '';
  return safeSlug(raw);
}

function resolveContactSlug(pathname) {
  const match = /^\/contact\/([^/]+)\/?$/i.exec(pathname);
  if (!match || /^index\.html$/i.test(match[1])) return '';
  return safeSlug(match[1]);
}

function normalizePhone(value) {
  const phone = String(value || '').trim();
  const dial = phone.replace(/[^0-9+]/g, '');
  if (!phone || !/^\+?\d{7,20}$/.test(dial)) return null;
  return { display: phone, dial };
}

function absoluteUrl(url, path) {
  return new URL(path, url.origin).toString();
}

function formatPuppyDescription(puppy, fallback) {
  const summary = tidyText(puppy.summary || puppy.details, 280);
  const facts = [puppy.age, puppy.gender, puppy.coat].map(value => tidyText(value, 60)).filter(Boolean);
  const price = Number(puppy.price);
  if (Number.isFinite(price) && price > 0) facts.push('C$' + new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 }).format(price));
  const text = [summary || `Meet ${tidyText(puppy.name, 80)}, a Papillon puppy looking for a loving home.`, ...facts].join(' · ');
  return tidyText(text, 300) || fallback;
}

export async function onRequest(context) {
  // Pages `_redirects` rules are skipped whenever a Pages Function matches.
  // Because this middleware runs site-wide, rewrite puppy contact URLs here
  // so the shared HTML template is served while the original URL is preserved.
  const incomingUrl = new URL(context.request.url);
  const isPuppyContactRoute = Boolean(resolveContactSlug(incomingUrl.pathname));
  const isDocumentRequest = context.request.method === 'GET' || context.request.method === 'HEAD';
  const requestForNext = isPuppyContactRoute && isDocumentRequest
    ? new Request(new URL('/contact/index.html', incomingUrl), context.request)
    : context.request;
  const response = await context.next(requestForNext);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;

  const url = new URL(context.request.url);
  const path = normalizePath(url.pathname);
  const isHome = path === '/' || url.pathname === '/index.html';
  const isShipping = path === '/shipping/' || url.pathname === '/shipping/index.html';
  const contactSlug = resolveContactSlug(url.pathname);
  const isPuppyContact = Boolean(contactSlug);
  const slug = resolveListingSlug(url.pathname, url);
  const listingSlug = slug || contactSlug;
  if (!isHome && !isShipping && !slug && !isPuppyContact) return response;

  const env = context.env || {};
  const [settingsResult, listingResult] = await Promise.all([
    loadSettings(env).catch(error => {
      console.error('[Papillon social metadata] Public settings unavailable:', error?.message || error);
      return {};
    }),
    listingSlug ? loadPuppy(env, listingSlug).catch(error => {
      console.error('[Papillon social metadata] Puppy metadata unavailable:', error?.message || error);
      return null;
    }) : Promise.resolve(null)
  ]);
  const settings = settingsResult || {};
  const siteTitle = tidyText(settings.siteTitle, 120) || DEFAULT_SITE_TITLE;
  const siteBranding = tidyText(settings.siteBranding, 80) || DEFAULT_SITE_BRANDING;
  const siteDescription = tidyText(settings.siteDescription, 400) || DEFAULT_SITE_DESCRIPTION;
  const listing = listingResult;

  const baseTitle = siteTitle;
  let title = baseTitle;
  let description = siteDescription;
  let socialImagePath = settings.hasSiteOgImage
    ? '/api/og-image'
    : '/assets/images/og-image.jpg';
  let imageAlt = `${siteBranding} — Papillon puppies ready to meet their forever families.`;
  let canonicalPath = isHome ? '/' : isShipping ? '/shipping/' : isPuppyContact ? `/contact/${contactSlug}` : `/${slug}`;

  if (isShipping) {
    title = `Shipping Policy | ${siteBranding}`;
    description = PAGE_DESCRIPTIONS['/shipping/'];
    imageAlt = `${siteBranding} shipping policy`;
  } else if (isPuppyContact && listing) {
    title = `Contact us about ${tidyText(listing.name || 'this puppy', 80)} | ${siteBranding}`;
    description = `Share your shipping details and preferred payment method to discuss bringing ${tidyText(listing.name || 'this puppy', 80)} home.`;
    socialImagePath = `/api/og-image?slug=${encodeURIComponent(contactSlug)}`;
    imageAlt = tidyText(listing.imageAlt || `${listing.name || 'Papillon'} puppy`, 180);
  } else if (isPuppyContact && !listing) {
    title = `Puppy Contact | ${siteBranding}`;
    description = 'Contact Papillon & Co. about a puppy and discuss shipping and payment preferences.';
  } else if (slug && listing) {
    title = `${tidyText(listing.name || 'Papillon Puppy', 80)} | ${siteBranding}`;
    description = formatPuppyDescription(listing, siteDescription);
    socialImagePath = `/api/og-image?slug=${encodeURIComponent(slug)}`;
    imageAlt = tidyText(listing.imageAlt || `${listing.name || 'Papillon'} puppy`, 180);
  } else if (slug && !listing) {
    title = `Puppy Listing | ${siteBranding}`;
    description = 'Explore available Papillon puppy profiles and find a new companion.';
  }

  const socialImage = absoluteUrl(url, socialImagePath);
  const canonicalUrl = absoluteUrl(url, canonicalPath);
  const phone = normalizePhone(settings.phoneNumber);
  const rewriter = new HTMLRewriter()
    .on('title', { element(element) { element.setInnerContent(title); } })
    .on('meta[name="description"]', { element(element) { element.setAttribute('content', description); } })
    .on('meta[property="og:title"]', { element(element) { element.setAttribute('content', title); } })
    .on('meta[property="og:site_name"]', { element(element) { element.setAttribute('content', siteBranding); } })
    .on('meta[property="og:description"]', { element(element) { element.setAttribute('content', description); } })
    .on('meta[property="og:url"]', { element(element) { element.setAttribute('content', canonicalUrl); } })
    .on('meta[property="og:image"]', { element(element) { element.setAttribute('content', socialImage); } })
    .on('meta[property="og:image:secure_url"]', { element(element) { element.setAttribute('content', socialImage); } })
    .on('meta[property="og:image:alt"]', { element(element) { element.setAttribute('content', imageAlt); } })
    .on('meta[property="og:image:type"]', { element(element) { element.setAttribute('content', 'image/jpeg'); } })
    .on('meta[property="og:image:width"]', { element(element) { element.remove(); } })
    .on('meta[property="og:image:height"]', { element(element) { element.remove(); } })
    .on('meta[name="twitter:title"]', { element(element) { element.setAttribute('content', title); } })
    .on('meta[name="twitter:description"]', { element(element) { element.setAttribute('content', description); } })
    .on('meta[name="twitter:image"]', { element(element) { element.setAttribute('content', socialImage); } })
    .on('meta[name="twitter:image:alt"]', { element(element) { element.setAttribute('content', imageAlt); } })
    .on('link[rel="canonical"]', { element(element) { element.setAttribute('href', canonicalUrl); } })
    .on('.brand-logo', { element(element) { element.setAttribute('alt', siteBranding); } })
    .on('.brand', { element(element) { element.setAttribute('aria-label', `${siteBranding} home`); } })
    .on('.site-footer-copy', { element(element) { element.setInnerContent(`© ${new Date().getFullYear()} ${siteBranding}. All rights reserved.`); } })
    .on('body', { element(element) {
      if (isPuppyContact && contactSlug) element.setAttribute('data-contact-slug', contactSlug);
    } });

  if (phone) {
    rewriter
      .on('[data-contact-phone]', { element(element) { element.removeAttribute('hidden'); } })
      .on('[data-contact-phone-link]', {
        element(element) {
          element.setAttribute('href', `tel:${phone.dial}`);
          element.setInnerContent(phone.display);
        }
      });
  } else {
    rewriter.on('[data-contact-phone]', { element(element) { element.setAttribute('hidden', ''); } });
  }

  return rewriter.transform(response);
}
