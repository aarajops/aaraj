# Pathao fulfillment readiness

**Reviewed:** 2026-11-08
**Status:** The production release for commit `5b785a2` completed on 2026-11-05 ([GitHub Actions run](https://github.com/aarajops/aaraj/actions/runs/41963860085)). The operator confirmed on 2026-11-08 that the exposed production client secret was rotated in Pathao and replaced in GitHub Environment `aaraj-production`; a real booking and provider-delivered webhook were verified; missed-event recovery was checked with AARAJ's on-demand **Sync status** flow; and COD amount reporting semantics were confirmed against the live account. No credential values, customer details, or consignment identifiers are recorded here.

## Fulfillment flow

Staff confirm an eligible order in AARAJ, then use **Book order in Pathao** from its order panel. AARAJ submits the order to Pathao with the active default pickup store, the order's recipient details, Normal Delivery (`delivery_type=48`), Parcel (`item_type=2`), total order-line quantity, and the COD amount due. It uses `0.5 kg` when the catalog has no product weights. This is Pathao's documented minimum and the fallback in Pathao's maintained WooCommerce integration; it is not a measured parcel weight. See the [API contract notes](pathao-merchant-api.md#create-order-fields).

Pathao returns the consignment ID for the panel. A later staff handoff records physical pickup and consumes reserved stock. A booking response alone does not mean the courier collected the parcel. AARAJ's customer delivery tariff remains separate from Pathao's provider fee.

## Configuration

The production API endpoint is fixed to `https://api-hermes.pathao.com`. The five generic Pathao credentials are configured as GitHub Environment secrets and use the same names in the runtime. `PATHAO_WEBHOOK_SECRET` must match the secret registered with Pathao. The callback `https://aarajbd.com/api/v1/delivery/pathao/webhook` passed its displayed Merchant Panel integration check, and a provider-delivered order webhook was verified. Staff can recover a missed callback with **Sync status**, which checks Pathao Order Info; this is not background polling. The existing `ORDER_PII_ENCRYPTION_KEY` or `ORDER_PII_KEYRING` protects saved Pathao tokens; Pathao does not require a separate AARAJ token-encryption setting.

`delivery_type=48` is the fixed AARAJ Normal Delivery policy. There is no `PATHAO_DELIVERY_TYPE` setting, per-order store selector, manual parcel-count/weight form, Pathao price lookup, or Pathao charge calculation in the customer tariff.

## Remaining limits

- The live booking, provider-delivered webhook, on-demand missed-event recovery, and COD reporting semantics were confirmed by the operator on 2026-11-08. The earlier non-production token request returned HTTP `522`; that historical failure is not evidence against the subsequently verified production flow.
- The supplied Pathao token contract uses the password grant. [RFC 9700 §2.4](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.4) says clients must not use that grant. Live qualification confirms the provider flow works; the provider-required grant still needs an explicit security exception or a safer supported grant before broader rollout.
- Pathao's supplied capture does not document Create Order idempotency. AARAJ therefore preserves an uncertain booking outcome and requires reconciliation before any repeat booking.
- The app receives tracking through Pathao webhooks and provides on-demand status sync using the documented Order Info endpoint; it does not poll in the background.
- Webhook verification uses the durable inbox and bounded exponential retries. After eight processing attempts (including attempts reclaimed after a worker lease expires), the event moves to the existing Delivery Issues review flow; a staff recheck starts a fresh retry window. This is AARAJ's internal recovery policy, not a Pathao-published delivery guarantee.
- The supplied Pathao contract does not document a cancellation request, and Pathao's maintained [WooCommerce integration](https://github.com/pathao-eng/courier-woocommerce-plugin/blob/main/plugin-api.php) does not expose one. AARAJ therefore does not call an undocumented community endpoint. Staff cancel through Pathao's supported merchant workflow, then sync the provider-confirmed cancellation; AARAJ unlocks the order only before pickup. Return inspection/restock automation and courier COD-remittance reconciliation are outside this feature.

## Local verification

On 2026-11-05, CI and the production deployment for commit `5b785a2` completed successfully. CI uses deterministic Pathao mocks; live qualification was separately confirmed by the operator on 2026-11-08. That live evidence applies to the verified release, not automatically to later commits; repeat focused order/Pathao release checks for the exact candidate SHA before deployment. The environment secret values remain hidden by GitHub.
