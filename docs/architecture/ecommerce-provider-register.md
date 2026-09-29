# E-commerce provider verification register

**Verified: 2026-09-28.** Companion to the [enterprise blueprint](ecommerce-blueprint.md). This register separates public documentation from implementation decisions and merchant-onboarding evidence. Public pages can change or conflict; the account's approved API version and effective merchant agreement govern production integration.

## Payment providers

| Provider | Verified public capability or requirement | Remaining onboarding evidence |
| --- | --- | --- |
| bKash | Merchant onboarding precedes production credentials. Official references distinguish create, execute and query operations. The product overview lists several payment products with different behavior. | Approved product/API version, credential lifecycle, callback authenticity, execute retry rules, transaction lookup, refund/query capabilities, limits and settlement reports. Do not assume every listed product is enabled for the account. |
| SSLCOMMERZ | Server-side Order Validation follows IPN. Verify amount and transaction details before fulfillment. Refund initiation and refund-status lookup are separate; the documented unique `refund_trans_id` parameter was introduced on 2025-02-24. Production refund access requires IP registration. | Current merchant configuration, validation fixtures, refund access/IP registration, rate limits, report format and settlement contract. |
| aamarPay | IPN documentation describes successful-payment notifications only. Search Transaction uses the merchant transaction reference and instructs checking amount/status. The IPN page says notifications are signed. | Exact signature algorithm/header/canonical bytes and key rotation are not specified sufficiently in the inspected page. Obtain these details, approved refunds/status mechanisms, report format and retry rules before enabling the adapter. |
| Nagad | The official site exposes a merchant-payment service. | A current authoritative public integration contract was not verified. Obtain official versioned API documentation, credential/key provisioning, cryptographic requirements, verification/refund protocols, limits and settlement evidence. Third-party packages are not the contract. |

Sources: [bKash product overview](https://developer.bka.sh/docs/product-overview), [execute reference](https://developer.bka.sh/reference/executepaymentusingpost), [query reference](https://developer.bka.sh/reference/querypaymentusingget); [SSLCOMMERZ documentation](https://developer.sslcommerz.com/doc/v4/); [aamarPay IPN](https://aamarpay.readme.io/reference/instant-payment-notification), [transaction search](https://aamarpay.readme.io/reference/search-transaction), [payment initiation](https://aamarpay.readme.io/reference/initiate-payment-json); [Nagad merchant service](https://nagad.com.bd/services/?service=merchant-payment).

The architecture must persist attempt and provider references before an outbound mutation, query ambiguous outcomes, and deduplicate authenticated callbacks against durable records. Browser redirects never establish payment success. Application `Idempotency-Key` handling is not evidence that a provider supports that header or guarantees idempotency. Redis's 24-hour response cache supplements durable financial uniqueness.

Keep subunit arithmetic internal and perform explicit decimal-string formatting/parsing at adapter boundaries. Validate merchant identity, reference, amount, currency and status. Never copy examples that disable TLS verification, log credentials in URLs, or wait indefinitely. Separate pending-transaction reconciliation from matching settlements and bank credits. Treat refund acceptance, refund completion and settlement adjustment as distinct observations.

## Couriers, geography and contracted fees

| Provider | Public evidence | Integration consequence |
| --- | --- | --- |
| Pathao | Merchant-panel Developer API access is documented. The current courier page's price tables state 1% COD, while its FAQ states 0.5% within Dhaka Metro and 1% outside. A July 2025 announcement describes automatic delivery-area resolution from the full address for API merchants. | Confirm the actual contracted rate/base and supported address mode. Do not resolve the public pricing contradiction by choosing one value globally. Obtain the merchant's current API documentation and webhook/booking-recovery behavior. |
| Steadfast | Terms describe a 1% cash-handling charge after deducting delivery charges, excluded VAT/tax, customizable charges, and delivery fees for handed-over parcels including cancelled parcels. Those terms say no separate return charge, while the current business page describes a separate return charge. API order/status functionality is advertised. | Snapshot the effective agreement and quoted fee components. Confirm return treatment, fee base, serviceability, API credentials, booking lookup and status semantics with the merchant account. A readable authoritative API specification was not verified. |
| REDX | Its official service page advertises 0% COD inside Dhaka and 1% outside. Its developer entry exists but yielded no readable specification in this verification. | Obtain the current approved documentation, rate contract, zone data, label/status capabilities and recovery mechanisms. Do not infer endpoints from community wrappers. |

Sources: [Pathao API access](https://help.pathao.com/integrate-pathao-panel-with-website/), [Pathao rates and FAQ](https://pathao.com/courier/), [Pathao address announcement](https://pathao.com/bn/blog/api-merchant-auto-address-feature/); [Steadfast terms](https://www.steadfast.com.bd/terms-and-condition), [Steadfast business services](https://www.steadfast.com.bd/business); [REDX official service page](https://redx.com.bd/?from=AppAgg.com), [REDX developer entry](https://redx.com.bd/developer-api/).

**A universal 1% COD commission is incorrect.** Store effective dates, provider/account/service, charge base, commission rate, minimum/fixed fees, delivery/return charges, VAT/withholding treatment and quote provenance. Reconcile actual statement lines against the booked snapshot; discrepancies become cases, not silently rewritten charges.

**The BD four-tier address model is not universally 1:1 with courier zones.** Keep internal administrative locality identifiers separate from provider service-area identifiers. Provider/service mappings may be many-to-one or need finer address resolution. Version imported data, preserve booking snapshots and confirm serviceability at booking. Missing or ambiguous mappings need review. Nationwide marketing coverage does not guarantee every locality supports every service at a fixed price.

## NBR VAT and Mushak 6.3

The [NBR authorized English VAT Rules](https://nbr.gov.bd/uploads/rules/Authentic_English_Text_VAT_Rules_2016.pdf), published in November 2025, provide the verified legal anchor. Rule 40(c), PDF pages 28–29, identifies VAT-6.3 issuance per supply; actual issuance date/time; supplier name/address/BIN; applicable purchaser information; supply and transport details; ex-VAT value, VAT rate/amount and total; fiscal-year numbering and place-specific series where applicable; and original/customer plus retained copies. That text sets the purchaser-information threshold above ৳25,000. Rule 40(g) identifies VAT-6.7 credit notes and VAT-6.8 debit notes. Publication date is not the effective date of every included amendment.

The [official form index](https://nbr.gov.bd/form/vat/vat-2012/eng) still labels its VAT-6.3 download as published in 2019. Neither that index nor a generated PDF establishes current compliance.

Implementation must retain immutable structured invoice and rendered-document snapshots, fiscal-year/branch serial scope, issuance timestamp, required transport fields, tax classification/rule versions and links to corrections. Extend invoice attributes when the applicable official form requires additional fields. Preserve integer tax/allocation results and the approved rounding basis.

**Issuance release gate:** Finance must verify the merchant's registration/BIN, current gazetted rules/SROs, applicable rates/exemptions/duties, current prescribed form, numbering, retention, legally applicable tax point and treatment of advances, COD, split supplies and returns. Record the exact source, effective date, reviewer and approval version. This register has not established that no later 2026 amendment applies. Do not hard-code a universal VAT rate or call the schema an NBR certification.

## Social commerce and conversion tracking

The [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/), last updated September 23, 2026 when inspected, requires recipient opt-in and honoring opt-out. Business-initiated conversations use approved templates; free-form replies are allowed within the 24-hour customer-service window, while messages outside it require approved templates. Automated replies need an accessible human escalation route. Persist consent purpose/source/time/version, channel eligibility, template approval and revocation state. Operational necessity does not override WhatsApp channel consent or sending rules; choose an eligible alternate channel when needed.

Meta's [official Messenger Send API collection](https://www.postman.com/meta/messenger-platform-api/folder/7cc3gd2/send-api) describes a standard 24-hour window or an applicable permitted route outside it. Keep Messenger eligibility separate from WhatsApp templates and permissions. Verify current platform permissions and policy exceptions for the deployed API version.

Meta's [maintained server-event source](https://raw.githubusercontent.com/facebook/facebook-nodejs-business-sdk/main/src/objects/serverside/server-event.js) confirms that CAPI event identity uses `event_id` with `event_name`. Generate one stable ID per logical conversion, propagate the corresponding ID to browser/server delivery, preserve it on retries, and use the original occurrence time. Define the purchase milestone explicitly for prepaid and COD orders. Do not emit another purchase for each shipment or repeated payment callback. Marketing consent and data-sharing authorization remain separate from messaging consent; hashed identifiers are still sensitive data.

Direct Meta developer pages returned access/rate-limit errors during this review. Current event-age limits and deduplication receipt-window duration were therefore not verified from accessible primary documentation; pin and test those limits before release. This register does not prescribe a numeric window based on third-party articles.

## Adapter go-live evidence

These are architectural acceptance requirements, not claims that every provider offers every capability. Unsupported capabilities must be represented explicitly and have an approved operational fallback.

| Evidence | Required artifact or exercise | Blocking result |
| --- | --- | --- |
| Account and version | Merchant approval, approved product/API version, permitted use, sandbox/live separation, credential ownership/rotation record | Guessed endpoint/version or absent production access |
| Financial representation | Approved amount/currency mapping and fixtures for subunits, boundaries, malformed values and fee bases | Float arithmetic or unverifiable amount/currency |
| Authenticity | Official callback/signature or verification protocol; valid/tampered/replayed fixtures; raw-body handling where specified | Callback success accepted without trusted verification |
| Ambiguous payment outcome | Execute/create timeout, delayed success and retry exercise; durable merchant/provider references | New charge created while an earlier outcome is unknown |
| Refund lifecycle | Capability statement, initiation/query evidence, partial refund and unknown-outcome exercise | Acceptance treated as completion or refundable amount exceeded |
| Courier booking recovery | Stable merchant reference, supported query/dedup route, timeout exercise and manual fallback | Duplicate consignment created after an ambiguous response |
| Geography and quote | Versioned provider mapping, serviceability fixtures, quote/contract snapshot and unresolved-area route | Arbitrary default area or unverified serviceability |
| Status and reconciliation | Duplicate/out-of-order events, polling recovery, statement/report sample, bank/payout matching | Delivery assumed to prove remittance; discrepancies auto-cleared |
| Privacy and resilience | Redaction tests, restricted payload retention, request deadlines, backoff/rate limits, credential and provider outage drills | PII/secrets in telemetry or unbounded retry behavior |
| Tax and social rules | Finance-approved legal/form version; channel consent/templates/permissions; CAPI event identity fixture | Unsupported compliance claim or ineligible outbound messages |

Reverify provider contracts, fees, policies and legal rules during implementation and before launch. Preserve dated evidence and fixture versions with each adapter release. Public documentation gaps do not justify inventing APIs or assuming uniform refunds, webhook signatures, status semantics, reporting access or commission bases.
