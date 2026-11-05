# Pathao fulfillment readiness

**Reviewed:** 2026-11-05
**Status:** The production release for commit `7737643` completed and provisioned the five Pathao runtime secrets from GitHub Environment `aaraj-production`. This confirms deployment configuration, not Pathao connectivity: no successful production API response or real webhook delivery has been verified.

## Fulfillment flow

Staff confirm an eligible order in AARAJ, then use **Book order in Pathao** from its order panel. AARAJ submits the order to Pathao with the active default pickup store, the order's recipient details, Normal Delivery (`delivery_type=48`), Parcel (`item_type=2`), total order-line quantity, and the COD amount due. It uses `0.5 kg` when the catalog has no product weights. This is Pathao's documented minimum and the fallback in Pathao's maintained WooCommerce integration; it is not a measured parcel weight. See the [API contract notes](pathao-merchant-api.md#create-order-fields).

Pathao returns the consignment ID for the panel. A later staff handoff records physical pickup and consumes reserved stock. A booking response alone does not mean the courier collected the parcel. AARAJ's customer delivery tariff remains separate from Pathao's provider fee.

## Configuration

The production API endpoint is fixed to `https://api-hermes.pathao.com`. The five generic Pathao credentials are configured as GitHub Environment secrets and use the same names in the runtime. `PATHAO_WEBHOOK_SECRET` must match the secret registered with Pathao. The callback `https://aarajbd.com/api/v1/delivery/pathao/webhook` is recorded as configured in the Merchant Panel and passed its displayed integration check; receipt and processing of a real order event remain unverified. The existing `ORDER_PII_ENCRYPTION_KEY` or `ORDER_PII_KEYRING` protects saved Pathao tokens; Pathao does not require a separate AARAJ token-encryption setting.

`delivery_type=48` is the fixed AARAJ Normal Delivery policy. There is no `PATHAO_DELIVERY_TYPE` setting, per-order store selector, manual parcel-count/weight form, Pathao price lookup, or Pathao charge calculation in the customer tariff.

## Remaining limits

- No successful live Pathao authentication, store listing, order creation, or real webhook has been verified. A prior non-production token request returned HTTP `522`. The 2026-11-05 deployment provisioned runtime configuration but did not call Pathao.
- A production client secret appeared in conversation material. Treat it as compromised until rotated in Pathao and replaced in GitHub Environment; do not qualify live use with the exposed value.
- The supplied Pathao token contract uses the password grant. [RFC 9700 §2.4](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.4) says clients must not use that grant. Pathao's account owner must confirm whether a safer supported grant exists; otherwise the appropriate security owner must accept this provider-required exception before live use.
- Pathao's supplied capture does not document Create Order idempotency. AARAJ therefore preserves an uncertain booking outcome and requires reconciliation before any repeat booking.
- The app receives tracking through Pathao webhooks and provides on-demand status sync using the documented Order Info endpoint; it does not poll in the background.
- The supplied Pathao contract does not document a cancellation request, and Pathao's maintained [WooCommerce integration](https://github.com/pathao-eng/courier-woocommerce-plugin/blob/main/plugin-api.php) does not expose one. AARAJ therefore does not call an undocumented community endpoint. Staff cancel through Pathao's supported merchant workflow, then sync the provider-confirmed cancellation; AARAJ unlocks the order only before pickup. Return inspection/restock automation and courier COD-remittance reconciliation are outside this feature.

## Local verification

On 2026-11-05, CI and the production deployment for commit `7737643` completed successfully. CI uses deterministic Pathao mocks; the release itself did not call Pathao. The environment secret values remain hidden by GitHub.
