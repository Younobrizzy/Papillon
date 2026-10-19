import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../functions/lib/crypto.js';

const env = { SMTP_ENCRYPTION_KEY: 'local-test-key-do-not-use-in-production-2026' };
const secret = 'smtp-password-for-test-only';
const encrypted = await encryptSecret(secret, env);
assert.ok(encrypted.ciphertext && encrypted.iv, 'encryption returns ciphertext and IV');
assert.notEqual(encrypted.ciphertext, secret, 'ciphertext must not be plaintext');
assert.equal(await decryptSecret(encrypted.ciphertext, encrypted.iv, env), secret, 'AES-GCM round-trip succeeds');
await assert.rejects(
  () => decryptSecret(encrypted.ciphertext, encrypted.iv, { SMTP_ENCRYPTION_KEY: 'a-different-test-key-for-failure-case' }),
  /Unable to decrypt the saved SMTP password/,
  'changing the key must make old ciphertext unreadable'
);
await assert.rejects(
  () => encryptSecret(secret, { SMTP_ENCRYPTION_KEY: 'short' }),
  /at least 16 characters/,
  'short encryption keys must be rejected'
);
console.log('Smoke tests passed: SMTP password encryption/decryption, wrong-key rejection, and key validation.');
