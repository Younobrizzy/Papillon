# Papillon & Co. deployment checklist

Use this checklist with `README.md` before making the site public.

## A. Firebase and Firestore

- [ ] Select the Firebase project `papillonandco-98c22` (or set the matching `FIREBASE_PROJECT_ID`) and create the default Firestore database in Native mode.
- [ ] Enable Firebase Authentication → Email/Password and create the intended administrator account.
- [ ] Copy the administrator UID and create `admin/{uid}` with `{ "uid": "THE_UID", "role": "admin", "active": true }`.
- [ ] Create a dedicated service account with the required Firestore IAM data-access permissions and put its complete JSON in `FIREBASE_SERVICE_ACCOUNT_JSON`.
- [ ] Deploy the root deny-all rules using `firebase deploy --only firestore:rules --project papillonandco-98c22`.
- [ ] Confirm the Firebase service-account JSON `project_id` matches `FIREBASE_PROJECT_ID`.

## B. Cloudflare Pages environment

- [ ] Deploy the extracted project folder as the Pages project root; `index.html`, `functions/`, `assets/`, and `_redirects` must be at the root.
- [ ] Keep `wrangler.toml` absent so Cloudflare Dashboard can manage normal Variables and Secrets.
- [ ] Add `FIREBASE_PROJECT_ID` as a Variable.
- [ ] Add `FIREBASE_WEB_API_KEY` as a Variable.
- [ ] Add `FIREBASE_SERVICE_ACCOUNT_JSON` as a Secret containing the complete service-account JSON.
- [ ] Generate `SMTP_ENCRYPTION_KEY` with `openssl rand -base64 32` and add it as a Secret. Keep it stable after SMTP is saved.
- [ ] Optionally set `SMTP_HOST_ALLOWLIST` as a comma-separated hostname Variable.
- [ ] Configure Production and Preview environments separately and redeploy after changing environment values.

## C. SMTP and Preferences

- [ ] Sign in to `/dashboard/` using the Firebase account whose UID has an active `admin/{uid}` grant.
- [ ] Open Preferences and save the contact recipient email.
- [ ] Open SMTP setup and save host, port (465, 587, or 2525), SMTP username, From email, and password.
- [ ] Confirm SMTP is saved at `private/smtp` with an AES-256-GCM password bundle; do not store SMTP password in `privateConfig/sitePreferences` or `siteConfig/public`.
- [ ] Use **Test SMTP connection** and confirm TLS/STARTTLS plus SMTP authentication succeed.
- [ ] Keep `SMTP_ENCRYPTION_KEY` unchanged after saving the SMTP password.

## D. Smoke test before launch

- [ ] Run `npm run validate` and `npm test` from the project root.
- [ ] Open `/api/config` and confirm it returns only public Firebase Web config.
- [ ] Open `/api/health` and confirm Firebase, SMTP, and encryption are ready.
- [ ] Check `/`, `/shipping/`, `/dashboard/`, a real puppy slug, and an unknown slug.
- [ ] Add, edit, and delete a test puppy; check its gallery documents.
- [ ] Confirm public APIs do not expose contact-recipient or SMTP credential data.
- [ ] Submit a test contact form. Confirm the studio receives the notification with the visitor email as `Reply-To` and the customer receives a confirmation without `Reply-To`.
- [ ] Confirm excessive form submissions are rate-limited.
- [ ] Inspect Cloudflare Pages Function logs and remove test records before launch.

## Important limitation

Local validation cannot prove that the live Cloudflare secrets, Firebase IAM permissions, Firebase Authentication, SMTP host, SMTP password, or DNS/network path are correct. Use `/api/health`, the authenticated SMTP connection test, and an actual test contact submission in the deployed environment to verify production behavior.
