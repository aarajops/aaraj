# Order address encryption

New Order addresses are stored in `orders.order_header.address_ciphertext` as an
AES-256-GCM envelope. Version 2 binds the ciphertext to both its key ID and the
Order UUID as authenticated additional data, so copying ciphertext to another
Order fails authentication. Address reads decrypt only in the API before the
existing owner or staff response is assembled. Plaintext address fields are not
stored in PostgreSQL or written to audit metadata.

Staff prefix search uses HMAC-SHA-256 tokens in
`address_name_prefixes` and `address_phone_prefixes`. The HMAC key is the
stable `legacy` key in `ORDER_PII_KEYRING`; the domain string separates address
search tokens from other uses. Name searches are Unicode-normalized prefixes.
Phone searches normalize Bengali digits and the Bangladesh `01…` form to the
stored `8801…` form. Substring search is intentionally unsupported. These
indexes reveal repeated-prefix equality to a database reader, but do not store
names or phone digits.

`ORDER_PII_ENCRYPTION_KEY` remains supported for a single legacy key. For
rotation, replace it with `ORDER_PII_KEYRING`; never set both. Keep the stable
`legacy` key in the keyring because existing checkout retry fingerprints and
address-search tokens depend on it. Set a new active key while retaining all
previous encryption keys, then run the re-encryption operation below. Keep any
old key until every encrypted record type that uses it has been re-encrypted.
The application fails closed when an envelope references a key that is absent.

```json
{
  "activeKeyId": "orders-2026-q4",
  "keys": {
    "legacy": "<stable-key>",
    "orders-2026-q3": "<old-key>",
    "orders-2026-q4": "<new-key>"
  }
}
```

After building the API with the new keyring configured, stop the API. Locally,
run the rotation check with the migration database role:

```sh
pnpm --filter @aaraj/api run order-address:rotate -- --check
pnpm --filter @aaraj/api run order-address:rotate -- --execute
pnpm --filter @aaraj/api run order-address:rotate -- --check
```

On production, run the same script from the staged release with both the
runtime keyring and migration-role environment files loaded.

The execution takes an exclusive Order-table lock, verifies each existing
envelope, re-encrypts rows under the active key, and appends a redacted audit
event for each changed Order in the same transaction. It rolls back all rows
if any key or ciphertext is unavailable. Restart the API only after the final
check reports `complete`. Do not remove a former key until all other encrypted
records using it, including Pathao token records, have also been rotated.

Migrations `0066` and `0067` are a maintenance barrier. The migration runner
applies earlier migrations first, the host wrapper stops the API, and the
address converter encrypts the plaintext JSONB rows, fills the keyed prefix
tokens, and replaces the JSON with `{}` inside one locked transaction. Only
then does migration `0067` enforce non-null ciphertext and drop the plaintext
column. The immutable Order trigger is updated to protect ciphertext and both
prefix arrays. If conversion or contract migration fails after the data has
been scrubbed, the previous API stays stopped because it cannot safely read the
new rows.

The live-database migration does not rewrite old database backups, replicas,
exports, or object-store snapshots. Keep those artifacts access-controlled and
encrypted, apply the same retention and deletion policy, and run the staged
migrations before an old backup is connected to an application instance.
