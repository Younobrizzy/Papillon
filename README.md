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

- Responsive homepage, Shipping Policy page, puppy profiles, puppy-specific contact/delivery enquiry pages, and a custom 404 page.
- Dashboard sign-in through Firebase Authentication (email/password). Any active Firebase Authentication user can access the dashboard; no `admins` collection or role document is required. No custom dashboard email/password Cloudflare variables or app-managed login cookie are used.
- Firestore-backed puppy create, read, update, and delete operations. No puppy demo records are bundled or seeded.
- One main JPEG photo per listing and up to eight gallery photos, each independently compressed to no more than **240 KiB (245,760 bytes)** before save and checked again by the server. The dashboard preflights the complete main listing size and the server validates the full size of the main and every gallery document before committing writes.
- Clean puppy URLs such as `/little-puppy`; every listing uses the shared `puppy.html` template.
- Landing-page pagination with six puppy cards per page, responsive page buttons, previous/next controls, ellipses, and a result count. This is client-side display pagination: `/api/puppies` returns the current public listing set in one request.
- Public contact phone number loaded into the initial HTML, shown in its own labeled phone card on the homepage, and linked using `tel:`.
- Public live-chat / site script field. The saved snippet is executed only on the homepage, puppy profile pages, puppy contact pages, and shipping page; it is not loaded on the dashboard or 404 page.
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
| `config/firestore.rules` | Default-deny rules for browser Firestore access |
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
| `functions/api/config.js` | Returns the six Firebase Web SDK config values from environment variables at `GET /api/config` |
| `functions/api/admin-session.js` | Verifies Firebase Authentication users for dashboard access; no role document, custom password, or cookie session |
| `functions/api/puppies.js` | Public listing reads and Firebase-authenticated listing create/update/delete operations in Firestore |
| `functions/api/preferences.js` | Reads/saves private Preferences and public site config; requires a valid Firebase Authentication sign-in |
| `functions/api/public-scripts.js` | Public read-only endpoint for the phone number and live-chat/site snippet |
| `functions/api/contact.js` | Validates a contact/enquiry form, rate-limits submissions, and sends SMTP email |
| `functions/api/og-image.js` | Serves the custom site or individual puppy JPEG social image |
| `functions/lib/admin-session.js` | Validates Firebase ID tokens, same-origin checks, and safe text helpers; no Firestore role check |
| `functions/lib/private-firestore.js` | Reads/writes private Firestore settings and transactionally rate-limits contact submissions; replaces Cloudflare KV |
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
| `/<puppy-slug>` | Puppy profile resolved from the listing slug using `puppy.html` |
| `/contact/<puppy-slug>` | Puppy-specific enquiry form with contact details, shipping address, delivery preference, and preferred payment method |
| `/404.html` | Branded not-found page |

An unknown puppy slug renders the shared profile template, which displays a not-found state when the API returns no matching listing. The static name-specific profiles and old demo records have been removed. An empty Firestore `puppies` collection should produce an empty homepage listing state until you add real listings.

### HTTP APIs

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /api/config` | Public | Returns Firebase Web configuration. Requires all six `FIREBASE_*` web-config values. |
| `GET /api/admin-session` | Firebase ID token | Verifies the current Firebase Authentication user; no allowlist lookup is performed. |
| `POST /api/admin-session` | Firebase ID token + same origin | Optional verification endpoint; does not accept a password or issue a custom cookie. |
| `DELETE /api/admin-session` | Same origin | Legacy-compatible no-op confirmation; Firebase SDK performs actual sign-out in the browser. |
| `GET /api/puppies` | Public read | Returns public puppy listings. |
| `GET /api/puppies?slug=<slug>` | Public read | Returns one puppy and its gallery by slug. |
| `POST /api/puppies` | Valid Firebase Authentication sign-in + same origin | Creates or updates a listing and its gallery documents. |
| `DELETE /api/puppies?slug=<slug>` | Valid Firebase Authentication sign-in + same origin | Deletes a listing and its gallery documents. |
| `GET /api/preferences` | Valid Firebase Authentication sign-in | Loads Preferences. The SMTP password is never returned. |
| `POST /api/preferences` | Valid Firebase Authentication sign-in + same origin | Saves private email/SMTP values and public Firestore site settings. |
| `GET /api/public-scripts` | Public read | Returns `script`, `phoneNumber`, and update metadata; never returns SMTP secrets. |
| `GET /api/og-image` | Public read | Serves the custom site social image or redirects to the built-in fallback. |
| `GET /api/og-image?slug=<slug>` | Public read | Serves the main image for one puppy listing as JPEG bytes. |
| `POST /api/contact` | Same-origin public form submission | Validates and delivers a contact email; the API also supports optional puppy-name metadata. |

Dashboard mutation endpoints require a valid Firebase ID token from any active Firebase Authentication account, plus an allowed same-origin request for mutations. Every signed-in account can create/update/delete puppy listings and modify dashboard Preferences, including contact-recipient and SMTP settings. Firestore operations are made server-side using the service account. The browser never receives the service-account private key.

## Deploy to Cloudflare Pages

Cloudflare Pages is the supported hosting setup for the full feature set because this project needs Pages Functions, Firestore access, and Cloudflare's TCP socket support for SMTP. No KV namespace is used.

### 1. Prepare the project root

1. Download and extract the ZIP.
2. Open the extracted project directory (the ZIP contains the project files at its root).
3. Use the **contents of that directory** as the Cloudflare Pages project root. It must directly contain `index.html`, `functions/`, `assets/`, `_redirects`, and the other top-level files.
4. Do not put the folder one level deeper than the configured project root. Cloudflare must see the `functions/` folder next to `index.html`.

### 2. Create the Pages project

For a Git-connected deployment, commit the project contents to the repository and connect it to Cloudflare Pages. Use no frontend build command because the site is plain HTML/CSS/JavaScript. Set the output/build directory to the project root (`.`) when the provider's setup requires an output directory, and ensure the `functions/` folder is deployed with the static files. For this project, keep `wrangler.toml` out of the repository and deploy the project root through the Cloudflare Pages Git integration (or your usual Pages deployment workflow). This intentionally leaves the dashboard as the source of truth for regular Variables and Secrets. If this project was previously deployed with a Wrangler configuration file, remove that file and complete a fresh deployment before configuring ordinary Variables in the dashboard.

**Do not rely on a static-only drag-and-drop deployment to run the backend.** Verify that `/api/config`, `/api/puppies`, `/api/preferences`, and the other function routes are handled by Pages Functions, not returned as missing static files.

### 3. No Cloudflare KV binding is required

Papillon does not use Cloudflare KV. Private contact/SMTP Preferences and contact-form rate limits are stored in Firestore through the server-side service account. Do not create or configure a `PAPILLON_STORE` binding.

### 4. Configure environment variables and secrets

Use the included `.dev.vars.example` as a checklist for local development; copy it to `.dev.vars` and replace the blank values. The real `.dev.vars` file is ignored by Git. For production, open the Pages project → **Settings → Variables and Secrets**. Add the six regular Variables and exactly three Secrets listed in the next section in both Production and Preview as appropriate. This repository intentionally has no `wrangler.toml`: using a Wrangler configuration file makes it the source of truth for Pages configuration and can prevent editing regular Variables in the dashboard. Use **Secrets** only for `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and `SMTP_ENCRYPTION_KEY`. Redeploy after modifying configuration so the running deployment has the new values.

### 5. Configure Firebase and Firestore

Follow [Firebase and Firestore setup](#firebase-and-firestore-setup). The site needs server-side Firestore access for puppy listings, public Preferences, and server-rendered social previews.

### 6. Configure Firebase Authentication dashboard access

Follow [Firebase Authentication dashboard access](#firebase-authentication-dashboard-access). Enable Email/Password sign-in and create Firebase Authentication accounts for users who should have dashboard access. No `admins` collection or per-user Firestore document is required.

### 7. Configure email

Set `SMTP_ENCRYPTION_KEY` as a Cloudflare **Secret** (and as a local `.dev.vars` value during development), deploy, visit `/dashboard/`, sign in with the Firebase Auth user, and fill in Preferences. Contact email and SMTP are not ready until saved through the dashboard.

### 8. Create a deployment and run the checks

Use the checklist under [Testing after deployment](#testing-after-deployment) before promoting the production site.

## Cloudflare variables and secrets

Configure these under **Cloudflare Dashboard → Workers & Pages → your Pages project → Settings → Variables and Secrets**. Add them to **Production** and **Preview** separately wherever you use those environments. Cloudflare exposes both regular variables and secrets to Pages Functions through `env.NAME`. At runtime, every value below is read as a **string**; the Cloudflare type column tells you whether to create a regular **Variable** or a protected **Secret** in the dashboard.

This project intentionally does **not** include `wrangler.toml`, `wrangler.json`, or `wrangler.jsonc`. You can configure deployment variables and secrets directly in the Cloudflare dashboard, and Cloudflare Pages still discovers the `functions/` directory when the project root is deployed correctly. A Wrangler CLI command is only needed for local development or optional command-line deployment; a Wrangler configuration file is not required for the dashboard-managed deployment described here.

### Required regular variables

Create each row as a Cloudflare **Variable** (not a Secret). Each value is a string. The first six values below are the exact Firebase Web configuration for the `papillonandco-98c22` project; they are intentionally used by the browser SDK, so they are not private service-account credentials. Firebase API keys are client identifiers; use Firebase Authentication, Firestore rules, IAM, and API restrictions for security rather than treating the Web API key as a password.

| Name | Cloudflare type | Value format | Value / purpose |
| --- | --- | --- | --- |
| `FIREBASE_PROJECT_ID` | **Variable** | String / text | `papillonandco-98c22` — Firebase/Google Cloud project ID. Must match Authentication and Firestore. |
| `FIREBASE_API_KEY` | **Variable** | String / text | `AIzaSyAejpKo6LNw5z_q3DtpALXKtcpJsc90xVY` — Firebase Web app API key used by the browser SDK and Firebase ID-token verification flow. This is client configuration, not a service-account secret. |
| `FIREBASE_AUTH_DOMAIN` | **Variable** | String / hostname | `papillonandco-98c22.firebaseapp.com` — enter the hostname only; do not add `https://`. |
| `FIREBASE_STORAGE_BUCKET` | **Variable** | String / text | `papillonandco-98c22.firebasestorage.app` — storage bucket value from the Firebase Web app configuration. |
| `FIREBASE_MESSAGING_SENDER_ID` | **Variable** | String / numeric-looking text | `543638533861` — enter it as text, not as a numeric type. |
| `FIREBASE_APP_ID` | **Variable** | String / text | `1:543638533861:web:22c0917b5f8d9a348d060c` — Firebase Web app ID. |

### Required secrets

Use Cloudflare's **Secret** type for each of these values. Do not use a regular variable for a private key or encryption key.

| Name | Cloudflare type | Value format | Value / purpose |
| --- | --- | --- | --- |
| `FIREBASE_CLIENT_EMAIL` | **Secret** | String / email address | `client_email` from the dedicated Firestore service-account JSON. Treat the service-account identity as sensitive. |
| `FIREBASE_PRIVATE_KEY` | **Secret** | String / PKCS#8 PEM | The complete `private_key` from that service-account JSON, including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`. Preserve line breaks or use escaped `\n` sequences. |
| `SMTP_ENCRYPTION_KEY` | **Secret** | String / encryption key | Stable random key used to encrypt the SMTP password before storing it in private Firestore settings. Generate a fresh key for your own deployment; a 32-byte random value encoded as base64 is recommended. The code also accepts a 64-character hex key or a sufficiently long passphrase. Never copy an example or commit the real value. |

### Local development

Copy `.dev.vars.example` to `.dev.vars` in the project root. The six public Firebase Web values are prefilled for `papillonandco-98c22`; verify them against **Firebase Console → Project settings → Your apps** before use. Fill in `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and `SMTP_ENCRYPTION_KEY` with your own backend credentials. Wrangler loads these local values into the Pages Functions environment. Keep `.dev.vars` private and ignored by Git; never commit it. The prefilled Web configuration is public client configuration, not a substitute for the private service-account credentials.

`FIREBASE_PRIVATE_KEY` should be the complete `private_key` value from the downloaded Firebase service-account JSON, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines. It may use real newline characters or escaped `\n` sequences; surrounding quotes are tolerated. The backend now validates the PEM and returns a specific configuration error if the value is malformed. Do not use `private_key_id` or a base64-encoded copy of the PEM. Do not paste the entire service-account JSON into a frontend file. Never put `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, or `SMTP_ENCRYPTION_KEY` in HTML, browser JavaScript, public Firestore documents, or the live-chat snippet.

No Cloudflare KV binding is required. The six Firebase Web configuration values are returned by `GET /api/config`; the service-account credentials and SMTP encryption key must never be returned by that endpoint. After changing a Cloudflare variable or secret, redeploy the Pages project so the deployed Functions use the updated configuration.

### Firebase Authentication dashboard access

The dashboard uses Firebase Authentication (email/password). **Any active Firebase Authentication account can sign in and use the dashboard.** The application does not query an `admins` collection, and it does not require any per-user role document in Firestore.

1. In the Firebase console, select project **`papillonandco-98c22`**.
2. Open **Authentication → Sign-in method** and enable **Email/Password**.
3. Open **Authentication → Users** and create an account for each person who should be able to use the dashboard. Sign in at `/dashboard/` with that account.
4. In **Authentication → Settings → Authorized domains**, make sure the Cloudflare Pages domain and any custom production domain are listed.
5. In Cloudflare Pages → **Settings → Variables and Secrets**, add the six Firebase Web/project values as regular **Variables** and add `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and `SMTP_ENCRYPTION_KEY` as **Secrets**. The project ID must match the Firebase project used by Authentication and Firestore.
6. Redeploy the Pages project and sign in with any active Firebase Authentication account. The backend verifies the ID token through Firebase Authentication; it does not read an `admins` collection.

**Access impact:** every Firebase Authentication user who can sign in can manage puppy listings and galleries, site metadata, the public phone number/live-chat script, contact email, and SMTP settings. The dashboard does not include an account-registration screen. Create only the intended users in Firebase Authentication; if your project permits self-service sign-up, any newly created account would also receive dashboard access, so restrict account creation separately if you do not want that. No `PAPILLON_ADMIN_EMAIL` or `PAPILLON_ADMIN_PASSWORD` variables are used.

The dashboard sends the current Firebase ID token as an `Authorization: Bearer ...` header to protected API endpoints. The backend checks that Firebase recognizes the token and account. Local storage is used only for UI convenience and is never accepted as proof of authorization.

## Firebase and Firestore setup

### 1. Create the Firebase project/database

1. Open the Firebase console and select the project whose ID will be set in `FIREBASE_PROJECT_ID`.
2. Create the default Cloud Firestore database in Native mode if one does not exist.
3. Make sure the database is in the same Google Cloud project as the configured service account.

### 2. Create a Firestore service account

1. In Google Cloud Console → IAM & Admin → Service Accounts, create or select a service account for Papillon.
2. Grant a least-privilege role that permits the required Firestore data operations, for example **Cloud Datastore User** (`roles/datastore.user`). Follow your organization's policy if it requires a narrower custom role.
3. Create a service-account key and download its JSON privately.
4. Copy the `client_email` value to Cloudflare's `FIREBASE_CLIENT_EMAIL` secret and the `private_key` value to `FIREBASE_PRIVATE_KEY`.
5. Set `FIREBASE_PROJECT_ID` to the Firebase project's exact ID.
6. Never upload the JSON key to the website root or commit it to Git. After copying the needed values, keep the JSON in an approved secret store or delete the local copy securely.

Server-to-Firestore requests use Google's authenticated REST API. Service-account requests are authorized with Google Cloud IAM and do not rely on public browser Firestore rules. Keep direct browser Firestore access closed unless another, separate feature genuinely needs it and has appropriate security rules.

### 3. Firestore client security rules

The project routes Firestore reads and writes through Cloudflare Pages Functions using the server-side service account. The browser uses Firebase Authentication for dashboard sign-in but does not need direct Firestore access. The included `config/firestore.rules` therefore denies all client SDK reads and writes; server-side service-account requests continue to work because they use Google Cloud IAM and bypass Firestore Security Rules.

Review the rules file before deploying it if this Firebase project is shared with another application that needs direct client-side Firestore access. Deploy rules using the Firebase CLI or paste the equivalent rules into Firestore → Rules. Do not use broad authenticated-user rules that expose `privateConfig/sitePreferences` or `contactRateLimits`.

### 4. Verify the configuration

After deploy, test `GET /api/puppies`. With valid Firestore settings and no listing documents, it should return an empty list, not sample puppies. If it returns a configuration error, inspect the variable names and service-account key format. Add the first real puppy using the dashboard after signing in with any active Firebase Authentication account.

## Puppy listings and images

No dummy/demo listing records are included. All listing content comes from Firestore. When there are no listings, the homepage displays a dedicated “No puppy listings yet” state; loading/API failures use a separate temporary-unavailable message. Use the dashboard to create, edit, and remove listings.

### Firestore data layout

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

**Private Firestore document** — `privateConfig/sitePreferences` contains the contact recipient email and SMTP connection information, including the encrypted SMTP password and IV. It is read only by server-side Pages Functions using the service-account credentials; the Preferences endpoint never returns the encrypted password or IV. Do not put this document in `siteConfig/public`.

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
- the puppy-specific contact page (`/contact/<puppy-slug>`)
- the Shipping Policy page (`/shipping/`)

It is intentionally not loaded on `404.html` or `/dashboard/`. Treat this field as executable code: a saved snippet may run as JavaScript on every included page. Only use a snippet copied from a live-chat provider you trust. Do not paste passwords, private API keys, service-account JSON, or any other secret. A public script is not suitable for server credentials.

### Site title, description, and social image

- **Site title:** sets the homepage page/social title; puppy pages use the puppy name with the brand name, and shipping uses “Shipping Policy” with the brand name.
- **Branding:** sets the public brand label used for titles, Open Graph site name, logo alt text and footer label.
- **Description:** sets the homepage description and is used as fallback where a listing has no summary/details.
- **Social preview image:** select an image in Preferences; the dashboard converts it to JPEG and requires it to be 240 KiB or smaller. Save Preferences to write the image to `siteConfig/siteOgImage`. Removing the image enables the built-in `assets/images/og-image.jpg` fallback.

Older installations may have browser-local Preferences or values saved in the former KV binding. If old values appear in the same browser, review them, unlock the relevant fields, re-enter the SMTP password, and save Preferences once. Current authoritative public values are read from Firestore `siteConfig/public`; private email and SMTP values are stored in `privateConfig/sitePreferences`. Existing KV data is not automatically migrated, so re-save the contact email and SMTP settings after deploying this version.

## Instant SEO and social sharing previews

On Cloudflare Pages, `functions/_middleware.js` intercepts the initial HTML response and fills metadata before sending it to the visitor or a social crawler. It covers the homepage, shipping page, clean puppy slug URLs, and `/contact/<puppy-slug>` pages. Contact page metadata identifies the selected puppy and uses that listing’s social image. It does not rewrite the dashboard or 404 page.

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

The homepage contact form submits to `POST /api/contact`. The payload includes the visitor's name, email, subject, message, optional puppy name, and a hidden bot-trap field. The backend:

1. checks the request is same-origin and within the body-size limit;
2. quietly ignores form submissions where the hidden bot-trap field has been filled;
3. validates name, email, subject, and message;
4. rate-limits each client IP to five sends per ten minutes using a Firestore transaction on `contactRateLimits/{hashedIp}`;
5. reads the contact recipient and SMTP settings from the private Firestore document `privateConfig/sitePreferences`;
6. decrypts the SMTP password in the Worker and connects to the configured server;
7. sends a Papillon-branded HTML email plus a plain-text alternative, with the visitor email set as `Reply-To`.

This is an ordinary contact-message workflow. It does not generate verification codes or require code expiration. Rate-limit documents store a hashed IP identifier, count, window start, and `expiresAt` timestamp; configure a Firestore TTL policy on `contactRateLimits.expiresAt` to automatically clean up old records. The function reports success only when the SMTP server accepts the message; SMTP acceptance does not guarantee delivery to the inbox instead of spam.

### Configure contact email and SMTP

1. Confirm the Firebase service-account variables are configured and the service account has Firestore read/write access. No `PAPILLON_STORE` binding is required.
2. Complete the Firebase Authentication setup above and set `SMTP_ENCRYPTION_KEY` in Cloudflare.
3. Deploy, then visit `/dashboard/` over HTTPS and sign in with the authorized Firebase Authentication user.
4. Open **Preferences**, unlock **Contact email**, enter the address that should receive enquiries, and unlock the SMTP fields.
5. Enter the SMTP host, submission port, and username/email. Enter the SMTP password/app password and save. A complete host, port, username, and password is required the first time.
6. The saved SMTP password is encrypted with AES-GCM before it is stored in the private Firestore document `privateConfig/sitePreferences`; the password is not returned to the dashboard. Keep `SMTP_ENCRYPTION_KEY` stable. If that key is changed, the existing saved SMTP password cannot be decrypted, and you will need to save the password again under the intended key.
7. Submit a test message from the homepage contact form. Confirm the email reaches the configured Contact email and the visitor's address appears as Reply-To.

The SMTP username is used as the From email, and the displayed sender name is `Papillon & Co.`. The visitor's address is not substituted as the From email; it is used as Reply-To so email providers do not reject a forged sender. The SMTP provider must allow sending from the authenticated account.

### SMTP connection details

- Port `465` uses implicit TLS (`SSL/TLS`).
- Other supported submission ports, commonly `587` or `2525`, use `STARTTLS`.
- Port `25` is rejected because it is unavailable from Cloudflare Workers in this implementation.
- The SMTP host must be a public hostname or public IP address. Local/private and reserved network addresses are rejected, including addresses detected after the hostname resolves.
- If a provider requires an app password, use the provider-issued app password rather than the mailbox's normal login password.

SMTP settings and the recipient are stored in the private Firestore document `privateConfig/sitePreferences`; the live-chat script, phone, and page metadata are in public Firestore documents. Do not place SMTP values inside `siteConfig/public` or the script snippet.

## Local development

### Static-only preview

Install a supported Node.js release, open a terminal in the project root, and run:

```bash
node scripts/dev-server.cjs
```

Open `http://localhost:8080/`, `http://localhost:8080/shipping/`, a sample clean route such as `http://localhost:8080/example-puppy`, or `/contact/example-puppy`. The sample slug will show the profile template but display a not-found state unless a real listing exists in Firestore and the required API backend is running.

`scripts/dev-server.cjs` is only a static development server. It does not execute Cloudflare Pages Functions, connect to Firestore, rewrite initial HTML metadata, or send SMTP messages. Therefore, an API-dependent feature can fail locally even though the static page itself loads.

### Test the actual backend locally

Copy `.dev.vars.example` to `.dev.vars` at the project root, then fill in your Firebase Web configuration, service-account email/private key, and a stable `SMTP_ENCRYPTION_KEY`. Run Pages locally with `npx wrangler pages dev .`; `.dev.vars` supplies local values. No `wrangler.toml` is included intentionally, so Cloudflare Dashboard can manage regular Variables as well as Secrets. If you need to pin a Pages Functions compatibility date, set it in the Cloudflare dashboard under the Pages project's Functions settings for both Production and Preview. `.dev.vars` and `.env*` are excluded by `.gitignore`; never commit real credentials. No KV binding is needed. Use a test Firebase project and test SMTP account, not production customer data. Test with HTTPS/deployed Pages when verifying Firebase ID-token authorization and crawler behavior.

## Testing after deployment

Run `npm run validate` from the project root first. It checks required project files, JavaScript syntax, key environment-variable documentation, Firestore default-deny rules, and that the old KV binding is absent from runtime/config files. Then run these checks against the deployed site before announcing it is production-ready. A passing local validation does not prove live Firebase credentials, SMTP delivery, or Cloudflare deployment are working.

### Basic page and route checks

- [ ] `/` loads with styles, logo, navigation loader, and no console-breaking errors.
- [ ] `/dashboard/` opens the login page; successful login reaches the dashboard.
- [ ] `/shipping/` loads and the `/shipping` alias redirects to `/shipping/`.
- [ ] A real puppy slug opens that puppy, and a random missing slug displays the not-found state.
- [ ] The puppy CTA opens `/contact/<slug>`, the selected puppy appears on the enquiry page, and a submission includes the shipping address and preferred delivery/payment methods in the email. Verify the page does not collect payment credentials or process a payment.
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
- [ ] Save a trusted test live-chat snippet and confirm it loads on the homepage, puppy profile, puppy contact, and shipping pages only.
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
- [ ] Confirm Reply-To is the visitor's submitted email address.
- [ ] Verify invalid input is rejected and repeated submissions are rate-limited.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `GET /api/config` says `Missing configuration: FIREBASE_...` | Add all six Web config variables from the Firebase Web app settings, then redeploy. This endpoint is separate from service-account access. |
| `/api/puppies` returns 503 or reports an invalid private key | Set `FIREBASE_PROJECT_ID` to the project ID; set `FIREBASE_CLIENT_EMAIL` to `client_email`; set `FIREBASE_PRIVATE_KEY` to the complete `private_key` PEM value, including BEGIN/END lines. Real newlines and escaped `\n` are supported. Do not paste `private_key_id`. Redeploy after changing Cloudflare secrets. |
| `/api/puppies` reports Firestore permission denied | Confirm the project ID matches the Firebase project, Firestore is initialized in Native mode, and the service account identified by `FIREBASE_CLIENT_EMAIL` has the **Cloud Datastore User** (`roles/datastore.user`) role on that Google Cloud project. Check Cloudflare Pages Function logs for the exact status. |
| Firestore returns permission/access errors | Make sure the service account belongs to the same Google Cloud project and has a Firestore data role allowing the operations used by this site. |
| Dashboard sign-in is rejected | Confirm Email/Password is enabled, the six Firebase Web config variables are correct, the account is enabled in Firebase Authentication, and `/api/admin-session` returns a successful authenticated response. No `admins` Firestore document is required. Check the Firebase API key and Pages Function logs if verification fails. |
| Preferences or contact form says storage is unavailable | Check `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`, confirm the service account can access Firestore, and inspect Pages Function logs. No KV binding is required. |
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

### Email layout

`functions/lib/contact-email.js` generates both HTML and plain-text versions of the contact message. Its HTML is inline-styled and adapted from the `email-json-sender` project while using Papillon & Co. branding. Keep email CSS mostly inline because many email clients strip external stylesheets.

## Security and maintenance

- Keep `FIREBASE_PRIVATE_KEY` and `SMTP_ENCRYPTION_KEY` as server-side Cloudflare secrets. Do not put them in HTML, JavaScript, public Firestore fields, or the live-chat snippet.
- Keep `privateConfig/sitePreferences` and `contactRateLimits` inaccessible to browser clients through Firestore Security Rules. Server-side Pages Functions access these documents with the service account. No Cloudflare KV binding is used.
- Dashboard access uses valid Firebase Authentication ID tokens. No Firestore `admins` allowlist is used. Do not rely on localStorage for access control. Sign in over HTTPS in production and log out on shared devices.
- The SMTP password is encrypted at rest with AES-GCM. Do not change `SMTP_ENCRYPTION_KEY` without a planned credential re-encryption or reset.
- The `siteConfig/public` values, phone number and live-chat snippet are public configuration by design. Assume anyone can retrieve the configured snippet and phone number. Do not save secrets there.
- A live-chat snippet can execute arbitrary provider JavaScript on the pages where it is included. Any signed-in dashboard user can edit it, so only trusted provider code should be pasted.
- Firestore writes are server-side and mutations require a valid Firebase ID token from any active Firebase Authentication account. Every user who can sign in can manage puppy listings, public site settings, contact recipient details, and SMTP settings. Do not make public `POST`/`DELETE` listing APIs unauthenticated.
- Contact submissions are constrained by validation, same-origin checking, a bot-trap field, body-size limits, and a short rate-limit window, but you should still monitor usage and provider logs.
- Use a test deployment for large changes, keep a known-good deployment available for rollback, and test a real enquiry after changing SMTP or secrets.
- Use images and puppy descriptions truthfully, and review all public listing details before publication.

## Alternative hosting

Cloudflare Pages is the supported production host because it runs the `functions/` backend alongside the static frontend. This project intentionally does not include an Apache/cPanel rewrite file: moving it to another host requires implementing equivalent server-side handling for Firestore access, Firebase Authentication verification, Preferences storage, social metadata middleware, the social image endpoint, and SMTP delivery. The included `node scripts/dev-server.cjs` is only for visual/static preview and is not a production backend.
