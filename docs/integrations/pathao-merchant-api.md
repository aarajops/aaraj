# Pathao Courier Merchant API

## Source and evidence status

This document records the Pathao Courier Merchant API and Webhook Integration material copied from AARAJ's Pathao Merchant Panel **Developer's API** page and supplied on 2026-10-14. The source page is [Pathao Merchant Developer API](https://merchant.pathao.com/courier/developer-api). The captured page identifies itself as “Pathao Courier Merchant API Integration Documentation”; it does not provide an API version, publication date, changelog, downloadable OpenAPI schema, or contract revision.

The captured page is the primary source for the behavior described below. Its examples contain public-looking sandbox credentials; this document intentionally omits all credential values. Do not copy credentials from documentation into AARAJ configuration. Use the values issued for the corresponding AARAJ merchant environment.

This record distinguishes:

- **Pathao-documented**: stated in the supplied Merchant Panel capture.
- **AARAJ implementation**: behavior in the checked-in adapter; this is not a Pathao guarantee.
- **Unverified**: not established by the supplied Pathao material or not yet exercised against Pathao.

Recheck the Merchant Panel documentation and AARAJ merchant agreement before changing production behavior. The merchant-specific agreement and account enablement govern where the documentation is incomplete.

## Environments and credentials

| Environment | Base URL | Credential source stated by Pathao |
| --- | --- | --- |
| Sandbox/test | `https://courier-api-sandbox.pathao.com` | The Developer API page provides test values for client ID, client secret, username, password, and the `password` grant type. The literal test values are deliberately not reproduced here. |
| Production/live | `https://api-hermes.pathao.com` | Client ID and client secret come from the Merchant API Credentials section. |

The token request parameter table describes `username` as the test login email or production login email and `password` as the test password or production login password. The Production/Live Environment table itself lists only base URL, client ID, and client secret. **Confirm the production login values and any account-specific credential requirements with Pathao before live use.**

The API page describes OAuth 2.0 access tokens. It says to persist the token for subsequent API calls. The AARAJ configuration names below are AARAJ deployment controls, not Pathao-defined environment-variable names:

- `PATHAO_MODE` selects disabled, sandbox, or live behavior in AARAJ.
- `PATHAO_TOKEN_ENCRYPTION_KEY` encrypts tokens in AARAJ storage.
- `PATHAO_SANDBOX_APPROVED_STORE_IDS` and `PATHAO_SANDBOX_DELIVERY_TYPES` restrict what AARAJ staff can submit.
- `PATHAO_SANDBOX_WEBHOOK_SECRET` stores the value AARAJ supplies when configuring the Pathao webhook.

Do not infer that Pathao requires these AARAJ names or that every store/service is enabled for a merchant merely because it appears in the API documentation.

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

**Source-example defect:** the supplied refresh-token cURL body is not valid JSON: it omits a comma after `grant_type` and includes a trailing comma. The field table above records the intended fields, but this document does not claim a corrected example has been validated with Pathao. AARAJ should construct valid JSON and verify refresh behavior in sandbox.

The supplied documentation does not state refresh-token rotation/reuse rules, revocation behavior, concurrent refresh behavior, or a guaranteed lifetime beyond the example response. Treat those as unverified.

## Documented API operations

Every path below is relative to the selected environment base URL. Authenticated requests use `Authorization: Bearer <access_token>` as shown in the supplied examples.

| Operation | Method and path | Documented behavior |
| --- | --- | --- |
| Issue access token | `POST /aladdin/api/v1/issue-token` | Password grant; see Authentication. |
| Refresh access token | `POST /aladdin/api/v1/issue-token` | Refresh-token grant; see Authentication. |
| Create store | `POST /aladdin/api/v1/stores` | Creates a store from merchant contact and address/location fields. The sample success response says store approval may take one hour. |
| Create order | `POST /aladdin/api/v1/orders` | Creates one courier order; see Create Order fields below. |
| Create bulk orders | `POST /aladdin/api/v1/orders/bulk` | Accepts an `orders` array. The documented sample response is HTTP `202` and says creation is accepted for later completion. |
| Get order short info | `GET /aladdin/api/v1/orders/{consignment_id}/info` | Returns consignment/order status and timestamp information. |
| List cities | `GET /aladdin/api/v1/city-list` | Returns Pathao city identifiers and names. |
| List zones for a city | `GET /aladdin/api/v1/cities/{city_id}/zone-list` | Returns zone identifiers and names for the supplied city. |
| List areas for a zone | `GET /aladdin/api/v1/zones/{zone_id}/area-list` | Returns area identifiers/names and `home_delivery_available` / `pickup_available` flags. |
| Calculate price | `POST /aladdin/api/v1/merchant/price-plan` | Calculates a price for store, item, delivery type, weight, city, and zone. |
| List merchant stores | `GET /aladdin/api/v1/stores` | Returns store IDs, names, addresses, active state, location IDs, hub ID, and default-store flags. |

The supplied API capture does not document API rate limits, retry rules, or guarantees that create-order requests are idempotent. Do not infer those guarantees from AARAJ's own idempotency controls.

## Store operations

The Create Store example includes `name`, `contact_name`, `contact_number`, `address`, `city_id`, `zone_id`, and `area_id`; `secondary_contact` and `otp_number` are optional in its parameter table. The table gives these constraints:

- Store name and contact name: 3–50 characters.
- Contact number: 11 characters; secondary contact, if supplied, is also 11 characters.
- Address: 15–120 characters.
- City, zone, and area IDs: integers.

The example success response is HTTP `200`, includes the store name, and says to wait one hour for approval. The text does not define an approval-status polling operation in this section.

The Get Merchant Store Info operation returns paginated `data.data` entries. Documented fields include integer `store_id`, `store_name`, `store_address`, `is_active` (`1` active, `0` deactivated), `city_id`, `zone_id`, `hub_id`, `is_default_store`, and `is_default_return_store`.

**Example/table discrepancy:** the Create Store request table calls city/zone/area IDs “Recipient” IDs, although they describe the store location. Treat the field names and endpoint as documented; confirm unclear store-location semantics with Pathao before creating a production store.

## Create Order fields

The single-order endpoint is `POST /aladdin/api/v1/orders`. The supplied parameter table states:

| Field | Required | Documented rule |
| --- | --- | --- |
| `store_id` | Yes | Merchant-provided store ID; determines pickup location; integer. |
| `merchant_order_id` | No | Merchant's order/tracking reference. |
| `recipient_name` | Yes | 3–100 characters. |
| `recipient_phone` | Yes | 11 characters. |
| `recipient_secondary_phone` | No | If supplied, 11 characters. |
| `recipient_address` | Yes | Full address, 10–220 characters. |
| `recipient_city` | No | Omit if not supplied; Pathao says it can be populated from the full address. Do not send `null`. |
| `recipient_zone` | No | Same omission/address-mapping rule as city. |
| `recipient_area` | No | Optional; Pathao says it can be populated from the full address. Do not send `null`. |
| `delivery_type` | Yes | `48` = Normal Delivery; `12` = On Demand Delivery. |
| `item_type` | Yes | `1` = Document; `2` = Parcel. |
| `special_instruction` | No | Optional instruction. |
| `item_quantity` | Yes | Parcel quantity. |
| `item_weight` | Yes | Float, 0.5–10 kg. |
| `item_description` | No | Optional parcel description. |
| `amount_to_collect` | Yes | Recipient-payable/collectible amount; documentation says use `0` for non-COD. |

The sample success response is HTTP `200` with `consignment_id`, optional `merchant_order_id`, `order_status`, and `delivery_fee`.

**Documentation discrepancies and unverified details:**

- The request example serializes `item_weight` as a string, while the parameter table says float. AARAJ currently sends a JSON number; verify the accepted wire type in sandbox.
- The supplied text calls `amount_to_collect` an integer but does not clearly specify currency units, rounding, or whether its sample values are BDT. Confirm units and limits with Pathao before relying on amounts.
- The Create Order sample includes `merchant_order_id` even though its table marks it optional.
- The documentation says address mapping can infer city/zone/area, but does not guarantee that all addresses or services are resolvable.
- It does not specify the result of a timeout after Pathao has accepted an order. AARAJ must retain an unknown outcome and verify through order info/reconciliation before any retry.

The AARAJ integration currently uses `store_id`, recipient details, delivery type, parcel quantity/weight, and COD amount. It fixes `item_type` to Parcel (`2`). It does not currently use Pathao's Create Store, bulk-order, city/zone/area lookup, or price-plan operations as part of booking.

## Price calculation

The documented price operation is `POST /aladdin/api/v1/merchant/price-plan`. Its request table requires `store_id`, `item_type`, `delivery_type`, `item_weight`, `recipient_city`, and `recipient_zone`. The sample response includes `price`, `discount`, `promo_discount`, `plan_id`, `cod_enabled`, `cod_percentage`, `additional_charge`, and `final_price`.

The sample quotes `store_id` as a string, while the parameter table says integer. It also shows `delivery_type: 48`; the order/price tables define the two documented codes. AARAJ does not currently use this endpoint to calculate customer checkout delivery fees. Pathao's price response must not be treated as AARAJ's customer tariff or merchant contract without a separate product/account decision.

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

The supplied page lists these event labels and example event names:

| Merchant Panel event | Example `event` value |
| --- | --- |
| Order Created | `order.created` |
| Order Updated | `order.updated` |
| Pickup Requested | `order.pickup-requested` |
| Assigned For Pickup | `order.assigned-for-pickup` |
| Pickup | `order.picked` |
| Pickup Failed | `order.pickup-failed` |
| Pickup Cancelled | `order.pickup-cancelled` |
| At the Sorting Hub | `order.at-the-sorting-hub` |
| In Transit | `order.in-transit` |
| Received at Last Mile Hub | `order.received-at-last-mile-hub` |
| Assigned for Delivery | `order.assigned-for-delivery` |
| Delivered | `order.delivered` |
| Partial Delivery | `order.partial-delivery` |
| Return | `order.returned` |
| Delivery Failed | `order.delivery-failed` |
| On Hold | `order.on-hold` |
| Payment Invoice | `order.paid` |
| Paid Return | `order.paid-return` |
| Exchange | `order.exchanged` |
| Store Created | `store.created` |
| Store Updated | `store.updated` |
| Return Id Created | `order.return-id-created` |
| Return In Transit | `order.return-in-transit` |
| Returned To Merchant | `order.returned-to-merchant` |

Example payloads in the supplied material include `consignment_id`, `merchant_order_id`, `store_id`, `event`, `updated_at`, and `timestamp`. Depending on event, examples also include `delivery_fee`, `collected_amount`, `invoice_id`, `return_consignment_id`, `return_type`, and `reason`. The page explicitly says `reason` may be absent in some cases. These are examples, not a complete required-field schema for every event.

**AARAJ coverage gap:** the current webhook ingress schema persists the common event/order fields, delivery fee, and collected amount. It does not currently retain all documented sample fields such as `invoice_id`, `return_consignment_id`, `return_type`, or `reason`. Store-created and store-updated events are not in AARAJ's recognized order-event set. Confirm whether these fields/events are required for AARAJ's approved workflow before relying on them.

## Current AARAJ implementation and release status

The relevant implementation is in `apps/api/src/delivery/pathao/`. Its sandbox/live hosts match the supplied material; it implements token issuance/refresh, store listing, order creation, order-info lookup, and the webhook callback. It currently accepts only the documented delivery-type numbers `12` and `48`. The webhook route is `/api/v1/delivery/pathao/webhook` and returns HTTP `202` with the integration handshake header.

Those code facts do not establish that a real Pathao request has succeeded. CI uses deterministic mocks. Keep Pathao disabled until sandbox authentication, store listing, an isolated sandbox order, and webhook delivery have been exercised and the merchant-specific settings have been verified. Live use has additional AARAJ approval and credential-rotation gates; the supplied docs alone do not satisfy them.

## Environment configuration interpretation

For GitHub Environment `aaraj-production`:

- Use Environment **Secrets** for client secrets, login passwords, the merchant-configured webhook secret, and AARAJ's token-encryption key.
- Use Environment **Variables** for `PATHAO_MODE` and AARAJ's approved store/delivery-type allowlists.
- `PATHAO_SANDBOX_DELIVERY_TYPES` accepts only codes that Pathao documents and that AARAJ has verified for the specific sandbox account. The supplied Pathao capture documents `48` and `12`; it does not establish that both services are enabled for every account.
- Keep `PATHAO_MODE=disabled` unless a reviewed release explicitly permits sandbox activation. GitHub configuration storage by itself does not make API calls.

These names and rules describe AARAJ's deployment boundary, not Pathao's own configuration interface.

## Open provider-confirmation items

Before production booking, obtain written or account-visible confirmation from Pathao for:

1. Production username/password requirements, given the environment table omission.
2. The accepted `item_weight` JSON type and `amount_to_collect` currency/unit/limits.
3. Store approval timing and how to determine that a store/service is enabled in each environment.
4. Delivery-type availability for AARAJ's sandbox and production merchant accounts.
5. Webhook handshake status/header comparison, signature construction, retry behavior, event ordering, replay behavior, and payload field requirements.
6. Create-order timeout recovery and whether any provider-side idempotency guarantee exists.

Record the Pathao response or updated official docs with the date and account/environment scope. Do not resolve these questions using third-party SDKs or blog posts as authority.
