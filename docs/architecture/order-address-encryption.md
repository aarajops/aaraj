# Order address encryption

Order delivery addresses and persisted Pathao OAuth tokens are encrypted with AES-256-GCM before they are stored. Order-address ciphertext is bound to its Order ID; token ciphertext is bound to its environment and purpose. Existing address `v1` values use the single `ORDER_PII_ENCRYPTION_KEY`; new address and token ciphertext carries a key ID.

## Initial configuration

For an installation that has not rotated its key, keep `ORDER_PII_ENCRYPTION_KEY` stable across deployments. The application reads existing address `v1` rows and writes `v2.legacy` rows while this compatibility setting is in use. Pathao tokens use the same existing key for encryption at rest, so Pathao setup does not need a separate encryption secret.

## Activate a new key

Deploy the application and migration that support the versioned keyring first. Generate a new canonical 32-byte base64url key, then configure both keys and select the new key ID:

```dotenv
ORDER_PII_KEYRING='{"activeKeyId":"<active-key-id>","keys":{"legacy":"<existing-key>","<active-key-id>":"<new-key>"}}'
```

When `ORDER_PII_KEYRING` is set, remove `ORDER_PII_ENCRYPTION_KEY`. Keep `legacy` in the keyring: old `v1` addresses, existing checkout idempotency fingerprints, and any token ciphertext encrypted with that key depend on it. New Orders and refreshed Pathao tokens use `activeKeyId`; reads select the key ID stored in each `v2` value. Switching `activeKeyId` does not make older values unreadable as long as their keys remain configured.

Keep every key in a protected secret store. Verify a non-production Order can still be read and checkout retries still replay after switching the active ID. Never test by deleting an old key from production first.

## Current retirement limit

The database deliberately treats an Order's address as an immutable snapshot. The application currently has no controlled bulk re-encryption operation or Order retention/deletion process. Therefore key rotation currently changes the key for **new** addresses; it does not re-encrypt existing addresses. Do not remove an old key while any stored address uses it. In particular, `legacy` cannot be retired until both `v1` ciphertext and legacy-key checkout fingerprints have a reviewed migration or retention path.
