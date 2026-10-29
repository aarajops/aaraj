# Pathao Courier Merchant API

## Source and evidence status

This document records the Pathao Courier Merchant API and Webhook Integration material copied from AARAJ's Pathao Merchant Panel **Developer's API** page and supplied on 2026-10-14. The source page is [Pathao Merchant Developer API](https://merchant.pathao.com/courier/developer-api). The captured page identifies itself as “Pathao Courier Merchant API Integration Documentation”; it does not provide an API version, publication date, changelog, downloadable OpenAPI schema, or contract revision.

The captured page is the primary source for the behavior described below. Its examples contain public-looking sandbox credentials; this document intentionally omits all credential values. Do not copy credentials from documentation into AARAJ configuration. Use the values issued for the corresponding AARAJ merchant environment.

This record distinguishes:

- **Pathao-documented**: stated in the supplied Merchant Panel capture.
- **AARAJ implementation**: behavior in the checked-in adapter; this is not a Pathao guarantee.
- **Unverified**: not established by the supplied Pathao material or not yet exercised against Pathao.

Recheck the Merchant Panel documentation and AARAJ merchant agreement before changing production behavior. The merchant-specific agreement and account enablement govern where the documentation is incomplete.

Pathao also published a 2026-07-26 announcement describing **Pathao Commerce Instant Delivery**, with its own Developer API credentials and webhook integration. That announcement establishes that this product exists; it does not establish that AARAJ's account uses it or that its API is wire-compatible with the Courier Merchant API captured below. Confirm AARAJ's actual product and account before treating either contract as applicable. Pathao's public [website integration help article](https://help.pathao.com/integrate-pathao-panel-with-website/) only says API integration is available from the Merchant Panel's Developer API option; it does not publish the endpoint contract.

## Environments and credentials

| Environment     | Base URL                                 | Credential source stated by Pathao                                                                                                                                                         |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sandbox/test    | `https://courier-api-sandbox.pathao.com` | The Developer API page provides test values for client ID, client secret, username, password, and the `password` grant type. The literal test values are deliberately not reproduced here. |
| Production/live | `https://api-hermes.pathao.com`          | Client ID and client secret come from the Merchant API Credentials section.                                                                                                                |

The token request parameter table describes `username` as the test login email or production login email and `password` as the test password or production login password. The Production/Live Environment table itself lists only base URL, client ID, and client secret; the supplied material does not further describe how production login values are issued.

The API page describes OAuth 2.0 access tokens. It says to persist the token for subsequent API calls. AARAJ maps the documented values into its GitHub-managed runtime configuration:

- `PATHAO_BASE_URL` is set to exactly one documented URL from the table above. AARAJ derives the internal environment label from this URL.
- Pathao requires `delivery_type` on every Create Order request: `48` means Normal Delivery and `12` means On-Demand. AARAJ's regular nationwide fulfillment uses the documented Normal Delivery value `48`; this fixed service policy is not an environment variable. Pathao's Merchant Panel describes standard/nationwide delivery separately from the faster On-Demand option.
- OAuth tokens are encrypted at rest using AARAJ's existing `ORDER_PII_ENCRYPTION_KEY` or `ORDER_PII_KEYRING`; token ciphertext records its key ID so the existing keyring rotation rules apply. This is AARAJ's internal storage protection, not a Pathao credential or an additional Pathao setting.
- The `PATHAO_SANDBOX_*` and `PATHAO_LIVE_*` GitHub Environment Secrets contain the respective credentials and webhook secret. The deployment provisions only the credential set matching `PATHAO_BASE_URL`.
- AARAJ obtains the merchant's stores from Pathao's documented `GET /aladdin/api/v1/stores` response and presents entries Pathao marks active. Store setup belongs to the merchant account in Pathao's Merchant Panel; ecommerce does not create or edit stores. AARAJ submits the selected Pathao-issued integer `store_id` when booking an order.

These `PATHAO_*` names are AARAJ deployment mappings, not names prescribed by Pathao. Provider credential rotation must be performed in the merchant account and deployment secret store; the application does not rotate credentials on the merchant's behalf.

## Authentication

### Issue an access token

- Method and path: `POST /aladdin/api/v1/issue-token`
- JSON request fields: `client_id`, `client_secret`, `grant_type`, `username`, `password`.
- The documentation says the issue-token call uses `grant_type: "password"`.
- Required request header: `Content-Type: application/json`.
- Documented success status: HTTP `200`.
- Sample response fields: `token_type` (`Bearer`), `expires_in` (example: `432000` seconds), `access_token`, and `refresh_token`.

The response values and expiry shown are examples, not an AARAJ guarantee. Never log or expose either token.

### Refresh an access token

- Method and path: `POST /aladdin/api/v1/issue-token`
- JSON request fields: `client_id`, `client_secret`, `grant_type: "refresh_token"`, and `refresh_token`.
- Documented success status: HTTP `200`.
- The response table again lists bearer token type, expiry, access token, and refresh token.

**Source-example defect:** the supplied refresh-token cURL body is not valid JSON: it omits a comma after `grant_type` and includes a trailing comma. AARAJ constructs a valid JSON object using the documented field table. Whether Pathao accepts refresh calls and rotates refresh tokens remains unverified until a successful sandbox roundtrip.

The supplied documentation does not state refresh-token rotation/reuse rules, revocation behavior, concurrent refresh behavior, or a guaranteed lifetime beyond the example response. Treat those as unverified.

## Documented API operations

Every path below is relative to the selected environment base URL. Authenticated requests use `Authorization: Bearer <access_token>` as shown in the supplied examples.

| Operation             | Method and path                                    | Documented behavior                                                                                                                   |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Issue access token    | `POST /aladdin/api/v1/issue-token`                 | Password grant; see Authentication.                                                                                                   |
| Refresh access token  | `POST /aladdin/api/v1/issue-token`                 | Refresh-token grant; see Authentication.                                                                                              |
| Create store          | `POST /aladdin/api/v1/stores`                      | Creates a store from merchant contact and address/location fields. The sample success response says store approval may take one hour. |
| Create order          | `POST /aladdin/api/v1/orders`                      | Creates one courier order; see Create Order fields below.                                                                             |
| Create bulk orders    | `POST /aladdin/api/v1/orders/bulk`                 | Accepts an `orders` array. The documented sample response is HTTP `202` and says creation is accepted for later completion.           |
| Get order short info  | `GET /aladdin/api/v1/orders/{consignment_id}/info` | Returns consignment/order status and timestamp information.                                                                           |
| List cities           | `GET /aladdin/api/v1/city-list`                    | Returns Pathao city identifiers and names.                                                                                            |
| List zones for a city | `GET /aladdin/api/v1/cities/{city_id}/zone-list`   | Returns zone identifiers and names for the supplied city.                                                                             |
| List areas for a zone | `GET /aladdin/api/v1/zones/{zone_id}/area-list`    | Returns area identifiers/names and `home_delivery_available` / `pickup_available` flags.                                              |
| Calculate price       | `POST /aladdin/api/v1/merchant/price-plan`         | Calculates a price for store, item, delivery type, weight, city, and zone.                                                            |
| List merchant stores  | `GET /aladdin/api/v1/stores`                       | Returns store IDs, names, addresses, active state, location IDs, hub ID, and default-store flags.                                     |

The supplied API capture does not document API rate limits, retry rules, or guarantees that create-order requests are idempotent. Do not infer those guarantees from AARAJ's own idempotency controls.

## Store operations

The Create Store example includes `name`, `contact_name`, `contact_number`, `address`, `city_id`, `zone_id`, and `area_id`; `secondary_contact` and `otp_number` are optional in its parameter table. The table gives these constraints:

- Store name and contact name: 3–50 characters.
- Contact number: 11 characters; secondary contact, if supplied, is also 11 characters.
- Address: 15–120 characters.
- City, zone, and area IDs: integers.

The example success response is HTTP `200`, includes the store name, and says to wait one hour for approval. The text does not define an approval-status polling operation in this section. AARAJ does not call Create Store; a merchant must set up and activate the pickup store in Pathao before selecting it in order fulfillment.

The Get Merchant Store Info operation returns paginated `data.data` entries. Documented fields include integer `store_id`, `store_name`, `store_address`, `is_active` (`1` active, `0` deactivated), `city_id`, `zone_id`, `hub_id`, `is_default_store`, and `is_default_return_store`.

**Example/table discrepancy:** the Create Store request table calls city/zone/area IDs “Recipient” IDs, although they describe the store location. The supplied material does not resolve this wording discrepancy. AARAJ does not currently create stores through this operation.

## Create Order fields

The single-order endpoint is `POST /aladdin/api/v1/orders`. The supplied parameter table states:

| Field                       | Required | Documented rule                                                                                  |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `store_id`                  | Yes      | Merchant-provided store ID; determines pickup location; integer.                                 |
| `merchant_order_id`         | No       | Merchant's order/tracking reference.                                                             |
| `recipient_name`            | Yes      | 3–100 characters.                                                                                |
| `recipient_phone`           | Yes      | 11 characters.                                                                                   |
| `recipient_secondary_phone` | No       | If supplied, 11 characters.                                                                      |
| `recipient_address`         | Yes      | Full address, 10–220 characters.                                                                 |
| `recipient_city`            | No       | Omit if not supplied; Pathao says it can be populated from the full address. Do not send `null`. |
| `recipient_zone`            | No       | Same omission/address-mapping rule as city.                                                      |
| `recipient_area`            | No       | Optional; Pathao says it can be populated from the full address. Do not send `null`.             |
| `delivery_type`             | Yes      | `48` = Normal Delivery; `12` = On Demand Delivery.                                               |
| `item_type`                 | Yes      | `1` = Document; `2` = Parcel.                                                                    |
| `special_instruction`       | No       | Optional instruction.                                                                            |
| `item_quantity`             | Yes      | Parcel quantity.                                                                                 |
| `item_weight`               | Yes      | Float, 0.5–10 kg.                                                                                |
| `item_description`          | No       | Optional parcel description.                                                                     |
| `amount_to_collect`         | Yes      | Recipient-payable/collectible amount; documentation says use `0` for non-COD.                    |

The sample success response is HTTP `200` with `consignment_id`, optional `merchant_order_id`, `order_status`, and `delivery_fee`.

**Documentation discrepancies and unverified details:**

- The request example serializes `item_weight` as a string, while the parameter table says float. AARAJ currently sends a JSON number; verify the accepted wire type in sandbox.
- The supplied text calls `amount_to_collect` an integer but does not clearly specify currency units, rounding, or whether its sample values are BDT; these details are not established by this documentation capture.
- The Create Order sample includes `merchant_order_id` even though its table marks it optional.
- The documentation says address mapping can infer city/zone/area, but does not guarantee that all addresses or services are resolvable.
- It does not specify the result of a timeout after Pathao has accepted an order. AARAJ must retain an unknown outcome and verify through order info/reconciliation before any retry.

After staff confirms an order and it is packed, AARAJ's order panel submits the Pathao Create Order request directly. It sends the selected active Pathao `store_id`, recipient details, required `delivery_type=48` for Normal Delivery, actual parcel quantity and measured parcel weight, and the order's COD amount. It fixes `item_type` to Parcel (`2`). Customer checkout instructions are normalized and passed as the optional `special_instruction`; the supplied capture gives no length limit, so AARAJ does not add a Pathao-specific cap. Internal staff notes are not sent. The panel receives and displays Pathao's consignment ID. When Pathao physically collects the parcel, staff record that handoff from the same booking panel; AARAJ uses the saved consignment ID and Pathao operator automatically. The handoff consumes reserved stock. It does not currently use Pathao's Create Store, bulk-order, city/zone/area lookup, or price-plan operations as part of booking.

The Create Order table specifies `item_weight` as a float and `amount_to_collect` as an integer. Its cURL example quotes `item_weight` as text. AARAJ follows the field table: integer IDs, enum codes, quantity, and collection amount are JSON numbers; weight is a JSON number; documented text fields are JSON strings. The adapter rejects numeric strings where Pathao documents a numeric response field.

## Price calculation

The documented price operation is `POST /aladdin/api/v1/merchant/price-plan`. Its request table requires `store_id`, `item_type`, `delivery_type`, `item_weight`, `recipient_city`, and `recipient_zone`. The sample response includes `price`, `discount`, `promo_discount`, `plan_id`, `cod_enabled`, `cod_percentage`, `additional_charge`, and `final_price`.

The sample quotes `store_id` as a string, while the parameter table says integer. It also shows `delivery_type: 48`; the order/price tables define the two documented codes. AARAJ does not call this endpoint. Customer delivery charges come from AARAJ's configured, versioned delivery tariffs in `apps/api/src/delivery/delivery.service.ts`, used by `apps/api/src/quote/quote.service.ts`; Pathao does not check or calculate the customer charge. Pathao's optional `delivery_fee` returned after booking remains a separate provider-cost observation and never changes the customer tariff, quote total, or COD amount.

## Webhook integration

### Registration and callback validation

The supplied Webhook Integration page says to provide a callback URL and a webhook secret. It lists these callback conditions:

- URL is reachable and resolves within three redirects.
- HTTPS uses a valid certificate.
- URL responds within 10 seconds.
- For the `webhook_integration` validation event, return HTTP `202`.
- Return `X-Pathao-Merchant-Webhook-Integration-Secret` with the documented integration value `f3992ecc-59da-4cbe-a049-a13da2018d51`.

The overview says that header value must be **exactly** the documented value; the per-event pages say it should **contain** the value. AARAJ returns the exact value, which satisfies the stricter wording. Confirm the provider's comparison behavior if the documentation changes.

The integration handshake header value is distinct from the webhook secret entered during registration. Do not use the fixed handshake value as the merchant's webhook secret.

### Incoming event headers and payloads

The documentation says Pathao sends `X-PATHAO-Signature` with the secret supplied during webhook integration and `Content-Type: application/json`. It does not describe a signature/HMAC algorithm, canonical payload format, timestamp tolerance, replay window, retry schedule, or event ordering guarantee. AARAJ currently verifies the supplied header value against its configured shared secret; this is an implementation behavior, not a documented Pathao cryptographic-signature guarantee.

The Pathao-maintained [`pathao-eng/courier-woocommerce-plugin`](https://github.com/pathao-eng/courier-woocommerce-plugin/blob/main/plugin-api.php) compares the incoming `X-PATHAO-SIGNATURE` value directly with its configured webhook secret. That public implementation is consistent with AARAJ's shared-secret check, but it does not replace an end-to-end sandbox callback verification for this merchant account.

The supplied page lists these event labels and example event names:

| Merchant Panel event      | Example `event` value             |
| ------------------------- | --------------------------------- |
| Order Created             | `order.created`                   |
| Order Updated             | `order.updated`                   |
| Pickup Requested          | `order.pickup-requested`          |
| Assigned For Pickup       | `order.assigned-for-pickup`       |
| Pickup                    | `order.picked`                    |
| Pickup Failed             | `order.pickup-failed`             |
| Pickup Cancelled          | `order.pickup-cancelled`          |
| At the Sorting Hub        | `order.at-the-sorting-hub`        |
| In Transit                | `order.in-transit`                |
| Received at Last Mile Hub | `order.received-at-last-mile-hub` |
| Assigned for Delivery     | `order.assigned-for-delivery`     |
| Delivered                 | `order.delivered`                 |
| Partial Delivery          | `order.partial-delivery`          |
| Return                    | `order.returned`                  |
| Delivery Failed           | `order.delivery-failed`           |
| On Hold                   | `order.on-hold`                   |
| Payment Invoice           | `order.paid`                      |
| Paid Return               | `order.paid-return`               |
| Exchange                  | `order.exchanged`                 |
| Store Created             | `store.created`                   |
| Store Updated             | `store.updated`                   |
| Return Id Created         | `order.return-id-created`         |
| Return In Transit         | `order.return-in-transit`         |
| Returned To Merchant      | `order.returned-to-merchant`      |

Example payloads in the supplied material include `consignment_id`, `merchant_order_id`, `store_id`, `event`, `updated_at`, and `timestamp`. Depending on event, examples also include `delivery_fee`, `collected_amount`, `invoice_id`, `return_consignment_id`, `return_type`, and `reason`. The page explicitly says `reason` may be absent in some cases. These are examples, not a complete required-field schema for every event.

**AARAJ coverage gap:** the current webhook ingress schema persists the common event/order fields, delivery fee, and collected amount. It does not currently retain all documented sample fields such as `invoice_id`, `return_consignment_id`, `return_type`, or `reason`. Store-created and store-updated events are not in AARAJ's recognized order-event set. Confirm whether these fields/events are required for AARAJ's approved workflow before relying on them.

## Current AARAJ implementation and release status

The relevant implementation is in `apps/api/src/delivery/pathao/`. It implements token issuance/refresh, store listing, order creation, order-info lookup for booking reconciliation, and the webhook callback. AARAJ sends `delivery_type=48` for Normal Delivery on every booking; no delivery-type environment setting is required. The webhook route is `/api/v1/delivery/pathao/webhook` and returns HTTP `202` with the integration handshake header. The `order.delivery-failed` event maps to its own tracking state. Tracking updates are webhook-first; AARAJ does not poll for missed tracking events. Staff must review discrepancies with the Pathao merchant panel and the provider before taking a supported action.

Those code facts do not establish that a real Pathao request has succeeded. Local tests use deterministic mocks. The production workflow reads deployment values from the protected GitHub Environment, but its live state was not independently inspected during this review. A recorded sandbox token request returned HTTP/2 `522` from Cloudflare; Pathao did not return an API token response, so the result does not establish whether the supplied credentials are valid. This review did not repeat that request. No successful sandbox order or provider-delivered webhook has been verified. The API has no provider credential-rotation control.

## Production qualification

**Not qualified:** the supplied sandbox credentials have not completed an API request in this environment. The recorded token request received HTTP/2 `522` from Cloudflare, not a Pathao API authentication response. Authentication, store listing, order creation/lookup, webhook delivery, timeout reconciliation, cancellation, and COD semantics therefore remain unverified. The selected base URL is the environment selector; no additional AARAJ live-booking flag is used. Keep the sandbox URL configured until the merchant product, account settings, and operational handling are confirmed. Missed tracking callbacks have no automated recovery and require staff/provider review. Use manual delivery until qualification succeeds. Mocked CI is not provider qualification.

## Environment configuration interpretation

For GitHub Environment `aaraj-production`:

- The environment's current values were not independently inspected. A prior 2026-10-10 record says the base URL had been removed; verify the actual GitHub Environment and host runtime before relying on that historical state. The helper clears Pathao credentials from `runtime.env` when the base URL is absent and preserves unrelated application settings; a running process keeps its current configuration until the next apply and restart.
- Use the Environment **Variable** `PATHAO_BASE_URL` to select sandbox or live. AARAJ always sends Pathao's documented Normal Delivery code `48` when creating a booking.
- Use Environment **Secrets** for the sandbox/live client IDs, client secrets, usernames, passwords, and webhook secrets. AARAJ uses its existing order-data encryption key from the application runtime; Pathao setup adds no encryption-key secret.
- The release workflow selects credentials from the URL, validates the configuration, and provisions it through the root-owned helper before activation. Changing GitHub Environment values alone does not apply them.

These environment-variable names describe AARAJ's deployment mapping, not Pathao's own configuration interface.

## Details not specified by the supplied capture

The supplied page does not define production login credential provisioning, the `item_weight` wire type beyond its table saying float, `amount_to_collect` currency units/limits, account-specific service availability, API rate limits, webhook retry/order/replay behavior, a webhook signature algorithm, or create-order idempotency. These are unknowns in this capture, not extra requirements stated by Pathao. AARAJ records them as unverified and does not invent API rules for them.
