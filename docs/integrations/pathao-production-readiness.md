# Pathao fulfillment readiness

**Reviewed:** 2026-11-02
**Status:** GitHub Environment `aaraj-production` has the five generic Pathao secrets and `AARAJ_PUBLIC_BASE_URL=https://aarajbd.com`. The staged release workflow maps those names to the runtime; the currently deployed host is unchanged until that workflow is released. The Pathao merchant account has not returned a successful API response, so provider readiness is not verified.

## Fulfillment flow

Staff confirm an eligible order in AARAJ, then use **Book order in Pathao** from its order panel. AARAJ submits the order to Pathao with the active default pickup store, the order's recipient details, Normal Delivery (`delivery_type=48`), Parcel (`item_type=2`), total order-line quantity, and the COD amount due. It uses `0.5 kg` when the catalog has no product weights. This is Pathao's documented minimum and the fallback in Pathao's maintained WooCommerce integration; it is not a measured parcel weight. See the [API contract notes](pathao-merchant-api.md#create-order-fields).

Pathao returns the consignment ID for the panel. A later staff handoff records physical pickup and consumes reserved stock. A booking response alone does not mean the courier collected the parcel. AARAJ's customer delivery tariff remains separate from Pathao's provider fee.

## Configuration

The production API endpoint is fixed to `https://api-hermes.pathao.com`. The five generic Pathao credentials are configured as GitHub Environment secrets and use the same names in the runtime. `PATHAO_WEBHOOK_SECRET` must match the secret registered with Pathao. The webhook callback is `https://aarajbd.com/api/v1/delivery/pathao/webhook`; the Pathao Merchant Panel registration has not been inspected. The existing `ORDER_PII_ENCRYPTION_KEY` or `ORDER_PII_KEYRING` protects saved Pathao tokens; Pathao does not require a separate AARAJ token-encryption setting.

`delivery_type=48` is the fixed AARAJ Normal Delivery policy. There is no `PATHAO_DELIVERY_TYPE` setting, per-order store selector, manual parcel-count/weight form, Pathao price lookup, or Pathao charge calculation in the customer tariff.

## Remaining limits

- No successful live Pathao authentication, store listing, order creation, or webhook has been verified. A prior non-production token request returned HTTP `522`; no provider request or deployment was made during the 2026-11-02 configuration review.
- The supplied Pathao token contract uses the password grant. [RFC 9700 §2.4](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.4) says clients must not use that grant. Pathao's account owner must confirm whether a safer supported grant exists; otherwise the appropriate security owner must accept this provider-required exception before live use.
- Pathao's supplied capture does not document Create Order idempotency. AARAJ therefore preserves an uncertain booking outcome and requires reconciliation before any repeat booking.
- The app receives tracking through Pathao webhooks; it does not poll for missed events. Staff must check Pathao's panel when a callback is missing.
- Post-booking cancellation, return inspection/restock automation, and courier COD-remittance reconciliation are not implemented. A booking claim keeps stock reserved until a supported fulfillment action is recorded.

## Local verification

On 2026-10-31, `pnpm run typecheck` and `pnpm run format:check` passed. On 2026-11-02, GitHub secret and variable names were checked and `git diff --check` passed; tests, provider calls, and deployment were not run in this configuration review.
