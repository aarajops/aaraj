# Order address encryption

Order delivery addresses are encrypted with AES-256-GCM before they are stored. The ciphertext is bound to its Order ID. Existing `v1` values use the single `ORDER_PII_ENCRYPTION_KEY`; new `v2` values carry a key ID.

## Initial configuration

For an installation that has not rotated its key, keep `ORDER_PII_ENCRYPTION_KEY` stable across deployments. The application reads existing `v1` rows and writes `v2.legacy` rows while this compatibility setting is in use.

## Activate a new key

Deploy the application and migration that support the versioned keyring first. Generate a new canonical 32-byte base64url key, then configure both keys and select the new key ID:

```dotenv
ORDER_PII_KEYRING='{"activeKeyId":"<active-key-id>","keys":{"legacy":"<existing-key>","<active-key-id>":"<new-key>"}}'
```

When `ORDER_PII_KEYRING` is set, remove `ORDER_PII_ENCRYPTION_KEY`. Keep `legacy` in the keyring: old `v1` addresses and existing checkout idempotency fingerprints depend on it. New Orders use `activeKeyId`; reads select the key ID stored in each `v2` value. Switching `activeKeyId` does not make older values unreadable as long as their keys remain configured.

Keep every key in a protected secret store. Verify a non-production Order can still be read and checkout retries still replay after switching the active ID. Never test by deleting an old key from production first.

## Current retirement limit

The database deliberately treats an Order's address as an immutable snapshot. The application currently has no controlled bulk re-encryption operation or Order retention/deletion process. Therefore key rotation currently changes the key for **new** addresses; it does not re-encrypt existing addresses. Do not remove an old key while any stored address uses it. In particular, `legacy` cannot be retired until both `v1` ciphertext and legacy-key checkout fingerprints have a reviewed migration or retention path.
