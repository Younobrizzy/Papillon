# Papillon & Co. — Puppy Website

A responsive puppy website and private listing dashboard built with plain HTML, CSS, and vanilla JavaScript. The site has no frontend build step. On Cloudflare Pages, its Pages Functions power Firestore-backed listings, the Preferences API, server-rendered social metadata, and SMTP-powered contact forms.

> **Important deployment note:** deploy this folder as the Pages project root so Cloudflare can discover the `functions/` directory. A static-only host or `node scripts/dev-server.cjs` does not run the `/api/*` endpoints.

The root folder intentionally keeps the entry-point files and Cloudflare Pages conventions (`index.html`, `puppy.html`, `404.html`, `_headers`, `_redirects`, and `functions/`). Supporting icons, Firestore rules, and secondary docs are grouped under `assets/icons/`, `config/`, and `docs/`. Unreferenced legacy PNG/SVG logo exports and the Apache-only rewrite file have been removed; Cloudflare Pages is the supported deployment target. This keeps the Pages runtime discovery intact while avoiding a cluttered root.

## Contents

- [Features](#features)
- [Project structure](#project-structure)
- [Routes and API endpoints](#routes-and-api-endpoints)
- [Deploy to Cloudflare Pages](#deploy-to-cloudflare-pages)
- [Cloudflare variables and bindings](#cloudflare-variables-and-bindings)
- [Firebase Authentication dashboard access](#firebase-authentication-dashboard-access)
- [Firebase and Firestore setup](#firebase-and-firestore-setup)
- [Puppy listings and images](#puppy-listings-and-images)
- [Preferences and public site settings](#preferences-and-public-site-settings)
- [Instant SEO and social sharing previews](#instant-seo-and-social-sharing-previews)
- [Contact forms and SMTP](#contact-forms-and-smtp)
- [Local development](#local-development)
- [Testing after deployment](#testing-after-deployment)
- [Troubleshooting](#troubleshooting)
- [Design and asset notes](#design-and-asset-notes)
- [Security and maintenance](#security-and-maintenance)

## Features

- Responsive homepage, Shipping Policy page, puppy profiles, and a custom 404 page.
- Dashboard sign-in through Firebase Authentication (email/password), followed by a server-side `admin/{uid}` authorization check. Only explicitly provisioned administrators can manage listings, preferences, and SMTP settings.
- Firestore-backed puppy create, read, update, and delete operations. No puppy demo records are bundled or seeded.
- One main JPEG photo per listing and up to eight gallery photos, each independently compressed to no more than **240 KiB (245,760 bytes)** before save and checked again by the server. The dashboard preflights the complete main listing size and the server validates the full size of the main and every gallery document before committing writes.
- Clean puppy URLs such as `/little-puppy`; every listing uses the shared `puppy.html` template.
- Landing-page pagination with six puppy cards per page, responsive page buttons, previous/next controls, ellipses, and a result count. This is client-side display pagination: `/api/puppies` returns the current public listing set in one request.
- Public contact phone number loaded into the initial HTML, shown in its own labeled phone card on the homepage, and linked using `tel:`.
- Public live-chat / site script field. The saved snippet is executed only on the homepage, puppy profile pages, and shipping page; it is not loaded on the dashboard or 404 page.
- Server-rendered title, description, canonical, Open Graph, and Twitter metadata for the homepage, shipping page, and puppy slug routes. This gives link preview crawlers the listing details before client JavaScript executes.
- Site-wide title, brand name, description, and optional custom social preview image editable in Preferences.
- SMTP-powered contact email, with an inline-styled HTML version and a plain-text alternative.
- Shared butterfly mark used for the favicon and page loader, plus responsive layouts and reduced-motion support.

## Project structure

Use the contents of this folder as the project root.

### Pages and assets

| Path | Purpose |
| --- | --- |
| `index.html` | Homepage, listing grid, about section, and contact form |
| `puppy.html` | Shared profile template used for every clean puppy slug URL |
| `shipping/index.html` | Shipping Policy page |
| `dashboard/index.html` | Dashboard sign-in, listing editor, and Preferences UI |
| `404.html` | Branded not-found page; no public live-chat snippet is loaded here |
| `assets/css/styles.css` | Homepage and shared site styles |
| `assets/css/puppy-detail.css` | Puppy profile and gallery styling |
| `assets/css/dashboard.css` | Dashboard, editor, and responsive sidebar styling |
| `assets/css/404.css` | Not-found page styling |
| `assets/css/navigation-loading.css` | Full-screen page navigation loader |
| `assets/js/script.js` | Homepage listing rendering, pagination, menu, and favorites |
| `assets/js/contact-form.js` | Contact form validation, loading state, and `/api/contact` submission |
| `assets/js/puppy-detail.js` | Loads the selected puppy from Firestore and handles its gallery and profile interactions |
| `assets/js/dashboard.js` | Firebase Auth sign-in/state, bearer-token API requests, listing management, image compression, Preferences, dialogs, and toasts |
| `assets/js/public-scripts.js` | Loads public phone/script configuration and executes the configured widget snippet |
| `assets/js/firebase-config.js` | Fetches browser Firebase config from `/api/config` |
| `assets/js/firebase.js` | Firebase Web SDK App/Auth initializer used by dashboard sign-in |
| `assets/js/navigation-loading.js` | Navigation loader and reduced-motion behavior |
| `assets/images/og-image.jpg` | Built-in fallback social preview image |
| `assets/images/brand/papillon-logo.svg` | Header and footer logo lockup |
| `assets/images/brand/papillon-mark.svg` | Shared butterfly mark for the dashboard and navigation loader |
| `assets/images/sections/` | Decorative/cropped section photos, separate from Firestore puppy images |
| `assets/icons/` | Favicons, Apple touch icon, PWA icons, and the web manifest |
| `firestore.rules` | Root default-deny rules deployed by Firebase CLI |
| `firebase.json` | Points Firebase CLI to the root Firestore rules file |
| `config/firestore.rules` | Matching compatibility copy of the default-deny rules |
| `docs/DEPLOYMENT_CHECKLIST.md` | Short, step-by-step launch checklist |
| `_redirects` | Cloudflare Pages-compatible clean URL rules, including aliases for conventional root icon URLs |
| `_headers` | Cache headers for icon and brand assets |
| `scripts/dev-server.cjs` | Optional Node.js static server for layout-only local development |
| Cloudflare Pages Dashboard configuration | Runtime settings and environment variables are managed in the dashboard; this project intentionally omits `wrangler.toml` so regular Variables remain editable there. |
| `.dev.vars.example` | Safe local environment-variable template; copy to ignored `.dev.vars` and fill in your own values |
| `scripts/validate-project.mjs` | Dependency-free structural, documentation, and JavaScript syntax validation |
| `scripts/smoke-test.mjs` | Smoke tests for SMTP password encryption/decryption and encryption-key validation |
| `package.json` | Project metadata and `npm run validate`, `npm test`, and `npm run dev:static` commands; no npm runtime dependencies |

### Cloudflare Pages Functions

| Path | Purpose |
| --- | --- |
| `functions/_middleware.js` | Rewrites HTML metadata and inserts the configured phone number before returning supported public pages |
| `functions/api/config.js` | Returns only the public Firebase Web API key and project ID at `GET /api/config` |
| `functions/api/admin-session.js` | Verifies Firebase Authentication identity and requires the matching `admin/{uid}` grant |
| `functions/api/puppies.js` | Public listing reads and administrator-authorized listing create/update/delete operations in Firestore |
| `functions/api/preferences.js` | Reads/saves private Preferences and public site config; requires an authorized administrator |
| `functions/api/public-scripts.js` | Public read-only endpoint for the phone number and live-chat/site snippet |
| `functions/api/contact.js` | Validates and rate-limits contact/enquiry submissions; sends an admin notification and customer confirmation |
| `functions/api/send.js` | Authenticated reusable admin-to-customer email endpoint; never emits `Reply-To` |
| `functions/api/health.js` | Reports non-secret Firebase, SMTP, and encryption configuration status |
| `functions/api/admin/smtp-test.js` | Administrator-only SMTP TLS connection and authentication test |
| `functions/lib/require-admin.js` | Enforces a server-verified Firebase ID token plus an `admin/{uid}` grant |
| `functions/lib/smtp-config.js` | Loads, validates, migrates, and saves SMTP settings in `private/smtp` |
| `functions/api/og-image.js` | Serves the custom site or individual puppy JPEG social image |
| `functions/lib/admin-session.js` | Validates Firebase ID tokens, creates Firestore service-account access tokens, and provides same-origin/text helpers |
| `functions/lib/private-firestore.js` | Reads/writes private Firestore settings and transactionally rate-limits contact submissions |
| `config/firestore.rules` | Default-deny rules for browser Firestore access; server-side service-account requests use IAM |
| `functions/lib/crypto.js` | AES-GCM encryption/decryption of the stored SMTP password |
| `functions/lib/public-site-script.js` | Reads/writes site configuration and images through the Firestore REST API |
| `functions/lib/smtp.js` | SMTP connection and delivery implementation for Cloudflare Workers |
| `functions/lib/contact-email.js` | Papillon-branded HTML and plain-text email template |

## Routes and API endpoints

### Browser routes

| Route | Description |
| --- | --- |
| `/` | Homepage |
| `/dashboard/` | Dashboard sign-in and private management interface |
| `/shipping/` | Shipping Policy |
| `/<puppy-slug>` | Puppy profile resolved from Firestore using `puppy.html` |
| `/404.html` | Branded not-found page |

An unknown puppy slug renders the shared profile template, which displays a not-found state when the API returns no matching listing. The static name-specific profiles and old demo records have been removed. An empty Firestore `puppies` collection should produce an empty homepage listing state until you add real listings.

### HTTP APIs

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /api/config` | Public | Returns the public Firebase Web API key and project ID only. |
| `GET /api/health` | Public, non-secret status | Reports Firebase, SMTP, and encryption readiness without exposing credentials. |
| `GET /api/admin-session` | Firebase ID token + `admin/{uid}` grant | Verifies the signed-in administrator. |
| `POST /api/admin-session` | Same origin + Firebase ID token + admin grant | Re-checks the administrator session. |
| `DELETE /api/admin-session` | Same origin | Confirms sign-out; Firebase SDK clears the browser session. |
| `GET /api/puppies` | Public read | Returns public puppy listings. |
| `GET /api/puppies?slug=<slug>` | Public read | Returns one puppy and its gallery by slug. |
| `POST /api/puppies` | Authorized administrator + same origin | Creates or updates a listing and gallery documents. |
| `DELETE /api/puppies?slug=<slug>` | Authorized administrator + same origin | Deletes a listing and its gallery documents. |
| `GET /api/preferences` | Authorized administrator | Loads private Preferences and safe SMTP metadata; never returns the password or ciphertext. |
| `POST /api/preferences` | Authorized administrator + same origin | Saves private contact email, public site config, and SMTP settings. |
| `POST /api/admin/smtp-test` | Authorized administrator + same origin | Tests SMTP connection, TLS, authentication, and sender acceptance without sending an email. |
| `POST /api/send` | Authorized administrator + same origin | Sends general admin-to-customer emails with no `Reply-To` header. |
| `GET /api/public-scripts` | Public read | Returns public `script` and `phoneNumber`; no private contact or SMTP data. |
| `GET /api/og-image` | Public read | Serves the custom site social image or redirects to the built-in fallback. |
| `GET /api/og-image?slug=<slug>` | Public read | Serves the main image for one puppy listing as JPEG bytes. |
| `POST /api/contact` | Same-origin public form submission | Validates and rate-limits contact/enquiry messages; sends an admin notification and attempts a customer confirmation. |

All dashboard reads of private settings and all mutations require a valid Firebase ID token plus an enabled `admin/{uid}` document. Public listing and social-preview endpoints expose only fields intended for website visitors. The service-account credential and SMTP password stay on the Cloudflare backend.

## Deploy to Cloudflare Pages

Cloudflare Pages is the supported hosting setup because the project uses Pages Functions, Firestore REST access, and Cloudflare TCP sockets for SMTP. No KV binding is required.

1. Extract the ZIP and use the project folder's contents as the Pages project root. Cloudflare must see `index.html`, `functions/`, `assets/`, `_redirects`, and `_headers` at that root.
2. Deploy through the Cloudflare Pages Git integration or your existing Pages workflow. No frontend build command is required; the site is plain HTML/CSS/JavaScript. Keep `wrangler.toml` absent so the Cloudflare dashboard remains the source of truth for Variables and Secrets.
3. Configure the five environment-variable names documented below. `FIREBASE_SERVICE_ACCOUNT_JSON` and `SMTP_ENCRYPTION_KEY` must be Cloudflare Secrets. Add the optional SMTP host allowlist if you want to restrict approved providers.
4. Deploy the Firestore deny-all rules using `firebase deploy --only firestore:rules --project papillonandco-98c22` (or replace the project ID with the matching project). These rules block direct browser SDK access; Cloudflare service-account operations use Google Cloud IAM.
5. Enable Firebase Authentication Email/Password, create the intended administrator account, and add its `admin/{uid}` authorization document as described below.
6. Open `/dashboard/`, sign in, save the contact recipient and SMTP settings under Preferences → SMTP, then use **Test SMTP connection**. Submit a real test contact form only after the health and SMTP checks succeed.
7. Configure Production and Preview environments separately and redeploy after every change to Variables or Secrets.

Do not use a static-only deployment for production: it will serve the pages but will not run the `/api/*` Cloudflare Functions.

## Cloudflare variables and secrets

Papillon follows the same five environment-variable names as Movara. Configure them in **Cloudflare Dashboard → Workers & Pages → your Pages project → Settings → Variables and Secrets** for every environment you deploy.

| Name | Type | Required | Purpose |
| --- | --- | --- | --- |
| `FIREBASE_PROJECT_ID` | Variable | Yes | Firebase project ID. For the supplied project it is `papillonandco-98c22`. |
| `FIREBASE_WEB_API_KEY` | Variable | Yes | Public Firebase Web API key used by the browser Auth SDK and ID-token verification. It is not a service-account credential. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | **Secret** | Yes | Complete service-account JSON with `project_id`, `client_email`, and `private_key`. The JSON project ID must match `FIREBASE_PROJECT_ID`. |
| `SMTP_ENCRYPTION_KEY` | **Secret** | Yes for email | Stable base64-encoded 32-byte AES key used to encrypt the SMTP password before saving it. Generate with `openssl rand -base64 32`. |
| `SMTP_HOST_ALLOWLIST` | Variable | Optional | Comma-separated approved SMTP hostnames, e.g. `smtp.example.com,*.mail.example.net`. When set, only matching hosts are accepted. |

The supplied `.dev.vars.example` retains Papillon's project ID and public Web API key. Obtain the complete service-account JSON from Google Cloud Console and place it in the `FIREBASE_SERVICE_ACCOUNT_JSON` secret. Do not split it into `FIREBASE_SERVICE_ACCOUNT_JSON` and the private key inside that service-account JSON; those legacy variables are no longer used. Do not add the service-account JSON or SMTP encryption key to HTML, browser JavaScript, public Firestore documents, or Git.

Copy `.dev.vars.example` to `.dev.vars` for local Pages development and enter the same values. Keep `.dev.vars` private and ignored by Git. Preserve the same `SMTP_ENCRYPTION_KEY` after saving an SMTP password; rotating it requires re-saving the SMTP password.

## Firebase and Firestore setup

### 1. Firebase project and Authentication

1. Use the Firebase project whose ID matches `FIREBASE_PROJECT_ID` (the included template is set to `papillonandco-98c22`).
2. Create the default Cloud Firestore database in Native mode if it does not exist.
3. Enable **Authentication → Sign-in method → Email/Password**.
4. Create the Firebase Authentication account that should administer the site. Add the production and preview domains to Authentication → Settings → Authorized domains.

### 2. Configure the service account

1. In Google Cloud Console → IAM & Admin → Service Accounts, create or select a dedicated service account for Papillon.
2. Grant only the Firestore data permissions required by the project (for example, **Cloud Datastore User**, `roles/datastore.user`, subject to your IAM policy).
3. Download its JSON key and store the complete JSON object in Cloudflare's `FIREBASE_SERVICE_ACCOUNT_JSON` Secret. The JSON must include `project_id`, `client_email`, and `private_key`, and its project ID must equal `FIREBASE_PROJECT_ID`.
4. Never upload the JSON key to the website root or commit it to Git.

### 3. Provision the administrator grant

Dashboard access requires both a valid Firebase ID token and a matching Firestore document at `admin/{uid}`. In Firebase Authentication, copy the administrator's UID. Create the Firestore document `admin/{that-uid}` with at least:

```json
{
  "uid": "THE_EXACT_FIREBASE_AUTH_UID",
  "role": "admin",
  "active": true
}
```

Only create this document for trusted administrators. The dashboard cannot grant itself admin permissions. To revoke access, set `active` to `false` or `status` to `disabled` (or remove the document).

### 4. Deploy the same deny-all Firestore rules as Movara

The root `firestore.rules` is identical to Movara's client deny-all policy:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

The browser never reads or writes Firestore directly. Cloudflare Pages Functions use the service account and Google Cloud IAM, so server-side reads/writes continue to work with these rules. Deploy with:

```bash
firebase deploy --only firestore:rules --project papillonandco-98c22
```

If this Firebase project is shared with another app that depends on direct client Firestore access, review the impact before applying the deny-all rule to that shared database.

### 5. Configuration health checks

- `GET /api/config` should return `apiKey`, `projectId`, and `authDomain` only.
- `GET /api/health` reports `system`, `smtp`, and `encryption` states without exposing credentials. The Firebase state verifies server-side Firestore access, not merely the presence of variables.
- After saving SMTP settings, call the administrator-only `POST /api/admin/smtp-test` from the dashboard. It attempts an actual TLS/STARTTLS connection and SMTP authentication but does not send a message.

## Puppy listings and images

No dummy/demo listing records are included. All listing content comes from Firestore. When there are no listings, the homepage displays a dedicated “No puppy listings yet” state; loading/API failures use a separate temporary-unavailable message. Use the dashboard to create, edit, and remove listings.

### Firestore data layout

Papillon's existing collections are retained: `puppies`, `siteConfig`, `privateConfig`, and `contactRateLimits`. The integration adds `admin/{uid}` for administrator authorization and `private/smtp` for the standalone SMTP configuration document. Contact recipient email and other private site preferences remain in `privateConfig/sitePreferences`; public branding and scripts remain in `siteConfig/public`, with the social image in `siteConfig/siteOgImage`.


**Main document:** `puppies/{slug}` stores fields used for the listing and profile, including `slug`, `name`, `gender`, `coat`, `age`, `price`, `status`, `personality`, `summary`, `details`, `image`, `imageAlt`, `imageSizeBytes`, `galleryCount`, `createdAt`, and `updatedAt`. The main `image` is a JPEG Base64 data URL.

**Gallery images:** `puppies/{slug}/gallery/photo-01`, `photo-02`, through `photo-08`. Each extra image has its own Firestore document with its own Base64 `image`, `name`, `alt`, `sizeBytes`, and `sortOrder`. Updating the gallery reconciles the gallery subdocuments to match the selected photos. Deleting a puppy deletes its gallery documents too.

### Image requirements

- One main photo is required for a listing; up to eight additional photos are supported.
- PNG, JPEG and common browser image formats can be selected in the dashboard, but each saved image is converted to JPEG.
- Each converted image must be **240 KiB (245,760 bytes) or smaller**. The browser compresses/resizes before submit; the backend independently validates image format and decoded byte count.
- If compression cannot get an image under the limit, the dashboard reports an error; choose a smaller/different source image instead of trying to bypass the limit.
- The main image is stored in the main puppy document. Gallery images are stored separately to avoid collecting all gallery Base64 values into one large document.
- Each document is estimated using Firestore storage-size rules (document path/name, UTF-8 field names and string values, typed values, and document overhead) and must stay below the **1 MiB** document limit. The writer uses a stricter **1,048,572-byte** cap to preserve the REST API's 4-byte margin. Oversize saves are rejected before the write batch is sent; the browser also preflights the listing for earlier feedback.
- Use photos that you own or are licensed/authorized to publish. Add meaningful image alt text where appropriate.

Puppy slugs are lower-case URL identifiers formed from the puppy name. When editing an existing listing, the editor preserves that listing's existing slug. If you want to change a URL, create a planned migration/redirect instead of casually renaming the document ID.

## Preferences and public site settings

Sign in at `/dashboard/`, open **Preferences**, unlock any fields you need to edit, and save the form. The Preferences page includes site identity and metadata fields, optional social preview image, phone number, live-chat/site script, contact recipient email, and SMTP connection settings.

### Which storage is used?

**Private Firestore document** — `privateConfig/sitePreferences` keeps the contact recipient email and existing private site-preference fields. SMTP credentials are stored separately in `private/smtp`, with the password encrypted as a Movara-compatible AES-256-GCM bundle. Both documents are read only by server-side Pages Functions; public APIs never return SMTP passwords, IVs, or ciphertext. Do not put private fields in `siteConfig/public`.

**Public site settings** — Firestore document `siteConfig/public` contains these fields:

| Field | Purpose |
| --- | --- |
| `siteTitle` | Default homepage title/social title |
| `siteBranding` | Public brand name used in titles, Open Graph site name, image alt text, and footer copyright |
| `siteDescription` | Default homepage and general site description; individual puppy descriptions are based on their summary/details and listing attributes |
| `phoneNumber` | Public phone number displayed in the homepage contact card when configured |
| `script` | Public live-chat or site snippet, loaded on selected public pages |
| `siteOgImageAvailable` | Boolean indicating whether a custom social preview image is configured |
| `updatedAt` | Last public settings save timestamp |

The actual optional custom social image is stored separately in Firestore document `siteConfig/siteOgImage`, field `image`, as a compressed JPEG Base64 data URL (plus `updatedAt`). This keeps ordinary public settings and HTML metadata reads small.

### Public phone number

Enter a display-friendly phone number such as `+237 6XX XXX XXX` in Preferences. The backend accepts a formatted number with 7–20 digits. On the homepage, Cloudflare middleware injects the phone number into the initial HTML when configured, so it can show before the frontend JavaScript finishes. It appears in its own phone card with a phone icon and a “Call us” label; the card stays hidden if no number is configured. The link uses a normalized `tel:` destination. The public scripts endpoint also returns the phone number as a fallback for client-side display.

### Public site script / live chat

Paste the live-chat provider's full script snippet into **Public site script / live chat** and save. A snippet smaller than 48 KB is accepted. The `assets/js/public-scripts.js` loader requests `GET /api/public-scripts` and supports either a raw JavaScript body or an HTML snippet containing script tags. It loads only on:

- the homepage (`/`)
- the shared puppy profile (`/<puppy-slug>`)
- the Shipping Policy page (`/shipping/`)

It is intentionally not loaded on `404.html` or `/dashboard/`. Treat this field as executable code: a saved snippet may run as JavaScript on every included page. Only use a snippet copied from a live-chat provider you trust. Do not paste passwords, private API keys, service-account JSON, or any other secret. A public script is not suitable for server credentials.

### Site title, description, and social image

- **Site title:** sets the homepage page/social title; puppy pages use the puppy name with the brand name, and shipping uses “Shipping Policy” with the brand name.
- **Branding:** sets the public brand label used for titles, Open Graph site name, logo alt text and footer label.
- **Description:** sets the homepage description and is used as fallback where a listing has no summary/details.
- **Social preview image:** select an image in Preferences; the dashboard converts it to JPEG and requires it to be 240 KiB or smaller. Save Preferences to write the image to `siteConfig/siteOgImage`. Removing the image enables the built-in `assets/images/og-image.jpg` fallback.

Older installations may have SMTP settings embedded in `privateConfig/sitePreferences`. The Preferences API attempts to migrate those legacy encrypted settings to `private/smtp` on the first administrator Preferences load. If the old password cannot be migrated (for example, the former key is not a base64-encoded 32-byte key), enter the SMTP password again and save. Supplying a new password writes a fresh standalone encrypted record without requiring the legacy ciphertext to decrypt. Existing KV data is not automatically migrated; if your previous deployment used KV, re-enter the contact email and SMTP settings.

## Instant SEO and social sharing previews

On Cloudflare Pages, `functions/_middleware.js` intercepts the initial HTML response and fills metadata before sending it to the visitor or a social crawler. It covers the homepage, shipping page, and clean puppy slug URLs. It does not rewrite the dashboard or 404 page.

The middleware sets or updates:

- the HTML `<title>` and meta description;
- canonical URL based on the requested host and route;
- Open Graph title, description, site name, URL, image, and image alt text;
- Twitter title, description, image, and image alt text;
- the public brand label in supported logo/footer attributes;
- the public contact phone banner when a valid phone number is configured and the page contains that banner.

For a puppy route, the middleware retrieves only the text/listing metadata from `puppies/{slug}` (name, summary/details, price, age, gender, coat, status, personality, and image alt). It does not fetch the large Base64 photo in the initial metadata lookup. The image metadata points to the normal JPEG endpoint `/api/og-image?slug=<puppy-slug>`; that endpoint reads only the main image and returns JPEG bytes. The default site social image points to `/api/og-image` when a custom image is configured, or to `/assets/images/og-image.jpg` when the built-in image is used.

This server-side HTML rewriting is important because many social crawlers do not execute frontend JavaScript before reading metadata. The middleware keeps a small in-memory cache for settings/listing reads for about 10 seconds per running Worker instance. The JPEG endpoint sends browser/shared-cache headers (up to one hour for shared caches), and social networks may cache an earlier preview independently. After changing a listing or image, refresh the URL with that network's link debugger/share preview tool if it continues to show old data; allow caches to expire where a refreshed image is not immediately visible.

**Instant per-listing social metadata requires Cloudflare Pages Functions (or an equivalent server-side HTML rewrite and image endpoint).** A static-only deployment on Apache/cPanel or another host will not automatically run `functions/_middleware.js`. If using a non-Cloudflare host, configure equivalent server-side behavior and update hard-coded metadata/canonical URLs in the HTML as needed. Cloudflare derives canonical absolute URLs from the live request origin, so the default `pet-project1.pages.dev` HTML fallback is overridden by middleware on Cloudflare.

## Contact forms and SMTP

The homepage contact form and listing-specific `/contact/{slug}` form both submit to `POST /api/contact`. The backend validates the request, ignores the honeypot, rate-limits each IP using a Firestore transaction in `contactRateLimits`, checks a puppy listing when the enquiry is listing-specific, and sends two emails through the configured SMTP account:

1. **Studio notification:** sent to the address saved in `privateConfig/sitePreferences.email`. It uses the authenticated SMTP mailbox for the visible `From` and envelope sender, and sets the visitor's submitted email as `Reply-To` so the studio can reply directly.
2. **Customer confirmation:** sent to the visitor. It uses the same sender branding and deliberately omits `Reply-To` so replies default to the configured `From` address.

The two email attempts run independently. If the studio notification is accepted, the form request is recorded as successfully received even if the customer confirmation cannot be delivered; the response includes `notificationSent` and `confirmationSent` so the frontend can distinguish the outcome. SMTP acceptance is not a guarantee of inbox placement; check spam and provider delivery logs when testing.

### SMTP setup and storage

1. Set `SMTP_ENCRYPTION_KEY` as a Cloudflare Secret (generate with `openssl rand -base64 32`) and keep it stable.
2. Sign in to `/dashboard/` using a Firebase account that has an `admin/{uid}` grant.
3. Open **Preferences → SMTP setup**. Enter host, port (`465`, `587`, or `2525`), SMTP username, From email, and SMTP password. The first save requires the password; subsequent updates can leave it blank to retain the encrypted password.
4. Save Preferences, then select **Test SMTP connection**. The test verifies transport and authentication; it does not send a test email.
5. Save the contact recipient email in the site preferences and submit a real contact form to test both email flows.

SMTP is stored in Firestore at `private/smtp`, matching Movara's document location and schema. The document stores `host`, `port`, `username`, `password` (an AES-256-GCM bundle with `algorithm`, `version`, `iv`, and `ciphertext`), `fromEmail`, `uid`, and `updatedAt`. It does not store `secure`, `security`, `enabled`, or `fromName`. TLS behavior is derived from the port; the sender display name is read from the public site branding in `siteConfig/public`. The SMTP password is encrypted before Firestore write and is never returned to the dashboard.

For older Papillon installations, the Preferences API attempts a one-time migration from the previous encrypted `smtp` object in `privateConfig/sitePreferences` to `private/smtp`. If the old password cannot be decrypted with the current `SMTP_ENCRYPTION_KEY`, the dashboard displays a warning and the password must be re-entered and saved.

### SMTP transport security

- Port `465` uses implicit TLS.
- Ports `587` and `2525` require STARTTLS; the transport refuses to continue with credentials if TLS upgrade is unavailable.
- Port `25` is not supported.
- The hostname must be public. Local, private, loopback, link-local, and reserved addresses are rejected, including the resolved socket peer IP.
- `SMTP_HOST_ALLOWLIST`, when set, further restricts SMTP hostnames to the comma-separated allowed hosts. Use this in production where possible.
- SMTP host and port are validated server-side. Sender identity is controlled by stored configuration, not request payloads.
- SMTP management, connection testing, and generic `POST /api/send` require a verified administrator and same-origin requests. Generic admin-to-customer emails do not include `Reply-To`.

The SMTP username/password and sender settings are stored only in the private `private/smtp` document. Contact recipient and other site-specific private settings remain in `privateConfig/sitePreferences`. Neither document is exposed through public APIs or browser SDK access.

## Local development

### Static-only preview

Install a supported Node.js release, open a terminal in the project root, and run:

```bash
node scripts/dev-server.cjs
```

Open `http://localhost:8080/`, `http://localhost:8080/shipping/`, or a sample clean route such as `http://localhost:8080/example-puppy`. The sample slug will show the profile template but display a not-found state unless a real listing exists in Firestore and the required API backend is running.

`scripts/dev-server.cjs` is only a static development server. It does not execute Cloudflare Pages Functions, connect to Firestore, rewrite initial HTML metadata, or send SMTP messages. Therefore, an API-dependent feature can fail locally even though the static page itself loads.

### Test the actual backend locally

Copy `.dev.vars.example` to `.dev.vars` at the project root, then fill in `FIREBASE_WEB_API_KEY`, the complete `FIREBASE_SERVICE_ACCOUNT_JSON`, and a stable `SMTP_ENCRYPTION_KEY`. Run Pages locally with `npx wrangler pages dev .`; `.dev.vars` supplies local values. No `wrangler.toml` is included intentionally, so Cloudflare Dashboard can manage regular Variables as well as Secrets. If you need to pin a Pages Functions compatibility date, set it in the Cloudflare dashboard under the Pages project's Functions settings for both Production and Preview. `.dev.vars` and `.env*` are excluded by `.gitignore`; never commit real credentials. No KV binding is needed. Use a test Firebase project and test SMTP account, not production customer data. Test with HTTPS/deployed Pages when verifying Firebase ID-token authorization and crawler behavior.

## Testing after deployment

Run `npm run validate` and `npm test` from the project root first. They check required files, JavaScript syntax, the five Movara-compatible variable names, the root and compatibility copies of the Firestore deny-all rules, admin authorization, SMTP encryption, and email header policy. Then run these checks against the deployed site before announcing it is production-ready. A passing local validation does not prove live Firebase credentials, SMTP delivery, or Cloudflare deployment are working.

### Basic page and route checks

- [ ] `/` loads with styles, logo, navigation loader, and no console-breaking errors.
- [ ] `/dashboard/` opens the login page; successful login reaches the dashboard.
- [ ] `/shipping/` loads and the `/shipping` alias redirects to `/shipping/`.
- [ ] A real puppy slug opens that puppy, and a random missing slug displays the not-found state.
- [ ] The 404 page and dashboard do **not** execute the public live-chat script.

### Firestore listings and image checks

- [ ] `GET /api/puppies` returns real records or an empty list, never bundled demo listings.
- [ ] Add a test listing from Dashboard; it appears on the homepage and can be opened from its clean slug.
- [ ] Confirm each uploaded JPEG is at most 245,760 bytes after conversion.
- [ ] Add a main image and gallery images; confirm profile gallery behavior.
- [ ] Edit the listing and remove one gallery photo; confirm the saved gallery matches the editor.
- [ ] Delete the test listing and confirm its gallery documents are also removed.

### Preferences, phone, and live chat

- [ ] Sign in, open Preferences, and save the site title, brand name, description, and phone number.
- [ ] Confirm the phone card appears above the homepage contact form when configured; click it on a phone or use a browser's `tel:` handler.
- [ ] Save a trusted test live-chat snippet and confirm it loads on the homepage, puppy profile, and shipping page only.
- [ ] Confirm `GET /api/public-scripts` returns the public `script` and `phoneNumber`, but no contact email or SMTP password.
- [ ] Confirm the public site settings appear in `siteConfig/public` and the optional social JPEG is saved in `siteConfig/siteOgImage`.

### Social metadata checks

- [ ] View the raw initial HTML response for the homepage and a real puppy URL; verify title, meta description, canonical, Open Graph, and Twitter values are already populated.
- [ ] Confirm a puppy's `og:image` is an absolute URL to `/api/og-image?slug=<slug>` and that URL returns `Content-Type: image/jpeg` with HTTP 200.
- [ ] Verify the default site preview image works at `/api/og-image`.
- [ ] Use Facebook Sharing Debugger, LinkedIn Post Inspector, or the relevant platform's preview tool to test a public HTTPS URL. If it shows an old image/title, ask the platform to scrape the URL again; platform cache is separate from this website.

### Contact email checks

- [ ] Save the contact recipient email and a valid SMTP host, port, username, and password in Preferences.
- [ ] Submit the homepage contact form.
- [ ] Confirm the receiver gets an HTML-styled email and the plain-text body is available.
- [ ] Confirm only the studio notification contains the visitor's email in `Reply-To`; the customer confirmation has no `Reply-To`.
- [ ] Use **Test SMTP connection** and confirm TLS plus SMTP authentication succeed.
- [ ] Confirm `private/smtp` contains an AES-256-GCM password bundle and that no password/ciphertext appears in API responses.
- [ ] Verify invalid input is rejected and repeated submissions are rate-limited.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `GET /api/config` says browser Firebase configuration is incomplete | Set `FIREBASE_PROJECT_ID` and `FIREBASE_WEB_API_KEY`, then redeploy. |
| `/api/puppies` returns 503 or reports an invalid service account | Set `FIREBASE_PROJECT_ID` and the complete JSON in `FIREBASE_SERVICE_ACCOUNT_JSON`. Confirm the JSON has `project_id`, `client_email`, and `private_key`, and that its `project_id` matches. Redeploy after changing the secret. |
| `/api/puppies` reports Firestore permission denied | Confirm the project ID matches the Firebase project, Firestore is initialized in Native mode, and the service account identified by `FIREBASE_SERVICE_ACCOUNT_JSON` has the **Cloud Datastore User** (`roles/datastore.user`) role on that Google Cloud project. Check Cloudflare Pages Function logs for the exact status. |
| Firestore returns permission/access errors | Make sure the service account belongs to the same Google Cloud project and has a Firestore data role allowing the operations used by this site. |
| Dashboard sign-in is rejected | Confirm Email/Password is enabled, `FIREBASE_PROJECT_ID` and `FIREBASE_WEB_API_KEY` are correct, the Firebase account is enabled, and `admin/{uid}` exists with the exact UID, `role: "admin"`, and `active: true`. Check `/api/admin-session` and Pages Function logs. |
| Preferences or contact form says storage is unavailable | Check `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, and the private key inside that service-account JSON, confirm the service account can access Firestore, and inspect Pages Function logs. No KV binding is required. |
| Saved SMTP password cannot be decrypted | `SMTP_ENCRYPTION_KEY` likely changed since the password was saved. Restore the original key, or set the intended key and re-enter/re-save the SMTP password. |
| SMTP connection/authentication fails | Verify the SMTP host, provider port, username, app password, TLS requirements, and sender permission. Port 465 uses SSL/TLS; 587/2525 typically use STARTTLS; port 25 is unsupported. |
| Contact form shows the generic send failure | Check Pages Function logs for `Papillon contact email send failed`. Verify the `SMTP_ENCRYPTION_KEY` has not changed since saving the password, then inspect the logged stage (SMTP connection, TLS, authentication, sender, recipient, or message delivery). SMTP's connected peer address is read from the result of `socket.opened`. |
| Homepage is empty | This is expected with an empty Firestore collection. Create a real listing from the dashboard; no sample puppy records are seeded. |
| Image cannot be saved | Choose a different/smaller photo. Every converted JPEG must be <= 240 KiB. Confirm the browser is allowed to decode the selected image and that `/api/puppies` is not rejecting the request due to an oversized total payload. |
| Listing says it is too large to save | The full listing or a gallery document exceeded the conservative 1 MiB per-document limit. Use a smaller photo or shorten listing text, then save again. Each gallery image is stored in its own document. |
| Phone number is not shown | Save a valid phone number in Preferences. Check `siteConfig/public.phoneNumber`, the `/api/public-scripts` response, and that the deployed HTML still contains the `data-contact-phone` markup. |
| Live chat does not appear | Check that the snippet is valid for the provider and smaller than 48 KB; inspect browser console/network requests for `/api/public-scripts` and for the provider's own script URL. The snippet is deliberately not run on dashboard/404. |
| Social preview shows the generic image/title | Check the metadata in the initial HTML, the Firestore site/listing fields, and that `/api/og-image` or `/api/og-image?slug=<slug>` returns a JPEG. Social platforms may cache old previews; force a scrape with their debugger. |
| Social image endpoint returns 404/503 | Confirm the puppy has a valid main JPEG Base64 image no larger than 240 KiB, or that the custom site image was saved successfully. Review Firestore service-account configuration and Pages logs. |
| Clean puppy URL returns a static 404 | Check `_redirects`, confirm `puppy.html` is in the deployed root, and ensure the Pages project root is the folder containing both `puppy.html` and `functions/`. |
| Backend endpoints return 404 | The deployment may be static-only or `functions/` may be outside the configured project root. Deploy with Pages Functions enabled and inspect the deployment build output. |

## Pagination and responsive layouts

The homepage displays six listings per page. Page controls include previous/next, numbered buttons, ellipses for longer collections, a result count, and accessible current-page state. Unnecessary controls are hidden for an empty or single-page result. This is client-side pagination after the public listing response is downloaded; for very large catalogues, consider adding Firestore server-side cursor pagination as a separate enhancement.

The homepage's puppy grid uses three columns on wide desktop screens, two columns on tablets/iPads (roughly 761–1100px), and one column on narrower phones. The dashboard listing grid follows a similar responsive layout and its sidebar becomes off-canvas on smaller screens. Puppy detail pages use a two-column gallery/details layout on wide screens and stack on compact screens.

## Design and asset notes

### Logo, favicon, and loader

The header/footer logo uses SVG lockups in `assets/images/brand/`. The butterfly mark in `assets/images/brand/papillon-mark.svg` is shared with the page loader and `assets/icons/favicon.svg`. ICO, Apple touch icon, and PWA icon derivatives are stored together in `assets/icons/` and are based on that same mark. Unreferenced logo PNG exports and light/dark alternate lockups were removed to avoid keeping duplicate assets. When replacing the brand mark, update the SVG source and regenerate its raster derivatives so the header, loader and favicon remain consistent. Favicon references have cache-busting query strings, and `_headers` asks Cloudflare to revalidate those assets. Root-level URLs such as `/favicon.ico` remain available through internal `_redirects` rewrites to `assets/icons/`, which preserves compatibility with browsers and crawlers that request conventional favicon paths.

### Page photos versus listing photos

Decorative hero/about photos and their crop versions live under `assets/images/sections/`; they are not puppy listing records and do not populate the Firestore `puppies` collection. Listing cards and profile galleries use images saved with the actual listing in Firestore. Decorative cover images use `object-fit: cover` where appropriate, while the full-screen gallery preview preserves the selected image.

### Loading states and puppy photo gallery

- The homepage renders six full-card shimmer placeholders while public puppy listings load; each listing photo keeps a shimmer until its image is ready.
- The selected-puppy panel on `/contact/{listing-slug}` keeps a stable image frame, tries the main listing image and gallery photos, and shows a branded placeholder if no image loads.
- Puppy profile thumbnails are square, horizontally scrollable, do not wrap, and hide the scrollbar on desktop and mobile. Thumbnails and the main photo show shimmer states while their images load.

### Email layout

`functions/lib/contact-email.js` generates both HTML and plain-text versions of the contact message. Its HTML is inline-styled and adapted from the `email-json-sender` project while using Papillon & Co. branding. Keep email CSS mostly inline because many email clients strip external stylesheets.

## Security and maintenance

- Keep `FIREBASE_SERVICE_ACCOUNT_JSON` and `SMTP_ENCRYPTION_KEY` as server-side Cloudflare Secrets. Never put them in HTML, browser JavaScript, public Firestore fields, or the live-chat snippet.
- Keep `admin`, `private`, `privateConfig`, and `contactRateLimits` inaccessible to browser clients through the deny-all Firestore rules. Server-side Pages Functions access these documents using the service account and verify administrator ID tokens against `admin/{uid}`.
- SMTP passwords are encrypted using AES-256-GCM before being stored at `private/smtp`; the password is never returned by APIs. Keep `SMTP_ENCRYPTION_KEY` stable and use `SMTP_HOST_ALLOWLIST` to restrict permitted providers where possible.
- No Cloudflare KV binding is used.
- Dashboard access requires both a valid Firebase Authentication ID token and an explicit `admin/{uid}` Firestore grant. Do not rely on localStorage for access control. Sign in over HTTPS in production and log out on shared devices.
- The SMTP password is encrypted at rest with AES-GCM. Do not change `SMTP_ENCRYPTION_KEY` without a planned credential re-encryption or reset.
- The `siteConfig/public` values, phone number and live-chat snippet are public configuration by design. Assume anyone can retrieve the configured snippet and phone number. Do not save secrets there.
- A live-chat snippet can execute arbitrary provider JavaScript on the pages where it is included. Any authorized administrator can edit it, so only trusted provider code should be pasted.
- Firestore writes are server-side and dashboard mutations require a valid Firebase ID token plus the matching active `admin/{uid}` grant. Only explicitly provisioned administrators can manage puppy listings, public site settings, contact recipient details, and SMTP settings. Do not make public `POST`/`DELETE` listing APIs unauthenticated.
- Contact submissions are constrained by validation, same-origin checking, a bot-trap field, body-size limits, and a short rate-limit window, but you should still monitor usage and provider logs.
- Use a test deployment for large changes, keep a known-good deployment available for rollback, and test a real enquiry after changing SMTP or secrets.
- Use images and puppy descriptions truthfully, and review all public listing details before publication.

## Alternative hosting

Cloudflare Pages is the supported production host because it runs the `functions/` backend alongside the static frontend. This project intentionally does not include an Apache/cPanel rewrite file: moving it to another host requires implementing equivalent server-side handling for Firestore access, Firebase Authentication verification, Preferences storage, social metadata middleware, the social image endpoint, and SMTP delivery. The included `node scripts/dev-server.cjs` is only for visual/static preview and is not a production backend.


### Puppy contact pages

- Each puppy detail page's **Contact us about this puppy** button opens `/contact/{listing-slug}`.
- The site-wide Pages middleware rewrites `/contact/{listing-slug}` internally to the shared `contact/index.html` template while preserving the original URL; this is done in middleware because Pages `_redirects` rules do not apply when a Pages Function handles the request. The page fetches the selected listing from `/api/puppies?slug=...` and displays its image, name, age, and price.
- The form collects contact details, a shipping address, and a preferred payment method. This is an enquiry only: it does not collect card/bank credentials or process payment.
- Submissions use the existing `/api/contact` endpoint and configured SMTP delivery, with the listing and structured shipping/payment preferences included in the notification email.
- The server verifies that the referenced puppy document still exists before sending the enquiry.
