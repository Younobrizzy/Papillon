# Papillon & Co. deployment checklist

Use this checklist with `README.md` before making the site public.

## A. Firebase

- [ ] Select the intended Firebase project and create the default Firestore database.
- [ ] Enable **Authentication → Email/Password**.
- [ ] Create the Firebase Authentication accounts that should be able to sign in to the dashboard. No `admins` collection or per-user allowlist document is required.
- [ ] Deploy `config/firestore.rules`. The rules intentionally deny all browser SDK reads/writes; server-side service-account calls use Google Cloud IAM.
- [ ] Create/use a dedicated service account with the required Firestore data access. Keep its JSON key private.

## B. Cloudflare Pages

- [ ] Deploy the extracted project directory as the Pages project root. `index.html`, `functions/`, `assets/`, and `_redirects` must be at the root. Do not include `wrangler.toml`; the Cloudflare Dashboard is intended to manage ordinary Variables.
- [ ] Confirm there is no `wrangler.toml` in the deployed project; redeploy after removing it if the project was previously Wrangler-configured, so dashboard-managed regular Variables can be edited.
- [ ] Add these as Cloudflare **Variables**: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, and `FIREBASE_APP_ID`.
- [ ] Add these as Cloudflare **Secrets**: `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` from the service-account JSON.
- [ ] Generate a stable `SMTP_ENCRYPTION_KEY` (for example, `openssl rand -base64 32`) and add it as a Cloudflare **Secret**. Do not change it after saving SMTP settings unless you plan to re-save the SMTP password.
- [ ] For local development, copy `.dev.vars.example` to `.dev.vars` and enter the same values there; never commit `.dev.vars`.
- [ ] Do **not** create a `PAPILLON_STORE` KV binding. The updated project uses Firestore for private Preferences and contact rate limits.
- [ ] Confirm the production and any preview environments have the required variables, then redeploy.

## C. Dashboard and Preferences

- [ ] Open `/api/config`; it should return the six browser Firebase config values and must not return service-account credentials.
- [ ] Open `/dashboard/` and confirm any active Firebase Authentication account can sign in without a matching Firestore role document. Confirm account creation is limited to the people you intend to grant full dashboard access.
- [ ] Save the contact email and SMTP host, port, username, and password in Preferences. Re-save these values after migrating from the old KV-backed version; no automatic KV migration occurs.
- [ ] Keep `SMTP_ENCRYPTION_KEY` unchanged after saving SMTP settings. Changing it makes the previously saved SMTP password unreadable.
- [ ] Save public site title, branding, description, phone number, and optional social preview image.

## D. Smoke test before launch

- [ ] Run `npm run validate` and `npm test` from the project root.
- [ ] Check `/`, `/shipping/`, `/dashboard/`, a real puppy slug, and an unknown slug.
- [ ] Add a test puppy with main/gallery images; edit it, then delete it.
- [ ] Confirm public APIs never expose the SMTP password or private contact configuration.
- [ ] Submit a test contact form and verify actual email delivery at the configured recipient.
- [ ] Submit enough test requests to confirm the contact rate limit blocks excess submissions.
- [ ] Inspect Cloudflare Pages Function logs for errors and confirm the old KV binding is not referenced.
- [ ] Remove test listings and verify the final public content and contact details before launch.

## Important limitation

Local validation and smoke tests cannot prove that your Firebase service account, Cloudflare environment variables, domain, or SMTP provider are configured correctly. Live login, Firestore access, and real email delivery must be checked in your own deployed environment.
