# Section 2: Relational Data Schema and Entity Blueprint

This is the schema and ERD companion to the [enterprise architecture](ecommerce-blueprint.md). The diagrams describe logical relationships; complete PostgreSQL columns and constraints are in [ecommerce-schema.sql](ecommerce-schema.sql). Both are proposed design artifacts, not applied migrations.

A relationship between bounded contexts means a public application call or event-fed local projection. It never authorizes a cross-schema foreign key, SQL join, ORM relation, or shared transaction.

## Ownership

| Schema | Owning aggregates and authoritative facts |
| --- | --- |
| identity | Better Auth users, sessions, accounts, and verification records; roles/scoped permissions, staff MFA, saved addresses, consent |
| geography | Versioned Division → District → Upazila/Thana → Area/Union hierarchy and effective courier-zone maps |
| catalog | Products, SKU variants, brands, categories, typed attributes, media and search documents |
| inventory | Warehouses, physical/reserved/available balances, movements, reservations and adjustments |
| cart | Anonymous/customer carts, lines, one-time merge receipts |
| pricing | Effective price books, promotions, quotes, quotas, tax rules and immutable quote allocations |
| ordering | Orders/lines, checkout saga, risk review, address/price/tax snapshots and issued invoice/correction facts |
| payment | MFS intents/attempts/captures, verified COD funding receipts, refunds/payouts, reconciliation and optional wallet |
| fulfillment | Split warehouse allocation, courier bookings, shipments, returns and inspection/disposition |
| courier_ledger | Effective courier contracts/fees, COD receivables, statements, remittances, discrepancies and balanced journals |
| notification | Provider channels/webhook ingress, message consent/delivery, retries/DLQ, CAPI and GA4 dispatch |
| audit | Redacted audit stream, source IDs, hash chain and independent anchors |
| moderation | Event-fed purchase eligibility, reviews, abuse reports and decisions |
| support | Tickets/timeline, operator sessions, address correction, conversations, social messages and draft commands |
| every owner schema | Its own command receipts, event-ID registry, partitioned outbox and consumer inbox; identical shape does not mean shared ownership |

Identity owns user facts; commerce schemas hold opaque customer/actor IDs. Geography validates address ancestry through its port. Order and Fulfillment preserve encrypted delivery and zone snapshots. Notification verifies and transports social messages; Support owns conversation and draft-order state. Payment receives a verified collection event and records the refundable COD source; no context reads another's tables.

## Physical table inventory

The following inventory is derived from CREATE TABLE statements in the companion DDL. Owner-local command receipt/outbox/inbox tables are created by its SQL helper.

### identity (13 tables)

user, session, account, verification, roles, permissions, role_permissions, user_roles, mfa_factors, mfa_recovery_codes, step_up_grants, addresses, consents

### geography (6 tables)

datasets, divisions, districts, upazilas, areas, provider_zone_mappings

### catalog (9 tables)

brands, categories, products, product_categories, variants, media_assets, media_derivatives, product_media, search_projection_jobs

### inventory (5 tables)

warehouses, stock_items, reservations, stock_movements, stock_adjustment_requests

### cart (3 tables)

carts, cart_lines, merge_receipts

### pricing (12 tables)

price_lists, prices, tax_rules, exchange_rates, promotions, coupons, promotion_counters, customer_promotion_counters, quotes, quote_lines, discount_allocations, promotion_redemptions

### ordering (14 tables)

order_ids, orders, order_lines, line_discount_allocations, order_address_revisions, order_state_history, checkout_sagas, risk_assessments, fraud_reviews, customer_risk_projections, tax_invoices, tax_invoice_lines, tax_exports, tax_export_invoices

### payment (19 tables)

intents, attempts, webhook_inbox, cod_collections, cod_collection_allocations, captures, capture_allocations, refunds, refund_allocations, refund_disbursements, reconciliation_runs, reconciliation_items, settlement_batches, settlement_items, wallet_accounts, wallet_ledger_accounts, wallet_ledger_journals, wallet_ledger_postings, wallet_entries

### fulfillment (11 tables)

fulfillment_orders, fulfillment_lines, courier_accounts, booking_attempts, shipments, shipment_lines, courier_webhook_inbox, shipment_events, return_authorizations, return_lines, return_inspections

### courier_ledger (9 tables)

courier_contracts, accounts, journals, postings, receivables, remittances, remittance_lines, remittance_allocations, discrepancies

### notification (9 tables)

social_channels, social_webhook_inbox, templates, preferences, messages, delivery_attempts, dead_letters, delivery_receipts, analytics_dispatches

### audit (5 tables)

streams, audit_ids, audit_logs, chain_positions, external_anchors

### moderation (6 tables)

purchase_eligibility, reviews, cases, decisions, bulk_jobs, bulk_job_items

### support (8 tables)

tickets, ticket_messages, customer_timeline, impersonation_sessions, address_correction_requests, conversations, social_messages, social_order_commands

## ERDs

### Identity and Bangladesh geography

~~~mermaid
erDiagram
  USER ||--o{ SESSION : authenticates
  USER ||--o{ MFA_FACTOR : enrolls
  USER ||--o{ USER_ROLE : receives
  ROLE ||--o{ ROLE_PERMISSION : grants
  PERMISSION ||--o{ ROLE_PERMISSION : names
  USER ||--o{ ADDRESS : saves
  ADDRESS }o--|| AREA : resolves
  DIVISION ||--|{ DISTRICT : contains
  DISTRICT ||--|{ UPAZILA_THANA : contains
  UPAZILA_THANA ||--|{ AREA_UNION : contains
  AREA_UNION ||--o{ COURIER_ZONE_MAPPING : maps
~~~

A saved address contains an area identifier and geography version. Historical orders keep hierarchy names/IDs and provider-zone snapshots after reference data changes.

### Catalog, inventory, cart, and pricing

~~~mermaid
erDiagram
  PRODUCT ||--|{ VARIANT : defines
  PRODUCT ||--o{ PRODUCT_MEDIA : displays
  PRODUCT ||--o{ PRODUCT_CATEGORY : classified_as
  CATEGORY ||--o{ PRODUCT_CATEGORY : groups
  WAREHOUSE ||--o{ STOCK_BALANCE : holds
  VARIANT ||--o{ STOCK_BALANCE : stocked_as
  STOCK_BALANCE ||--o{ RESERVATION_ITEM : protects
  RESERVATION ||--|{ RESERVATION_ITEM : reserves
  CART ||--|{ CART_LINE : contains
  QUOTE ||--|{ QUOTE_LINE : prices
  PROMOTION ||--o{ PROMOTION_REDEMPTION : limits
~~~

Available stock is physical minus reserved, constrained nonnegative. Cart and quote lines hold opaque SKU IDs; checkout calls Catalog, Pricing and Inventory ports to revalidate.

### Order, payment source, fulfillment, return and tax

~~~mermaid
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ORDER_LINE : snapshots
  ORDER ||--o{ CHECKOUT_SAGA : coordinates
  ORDER ||--o{ TAX_INVOICE : documents
  TAX_INVOICE ||--|{ TAX_INVOICE_LINE : details
  ORDER_LINE ||--o{ DISCOUNT_ALLOCATION : apportions
  ORDER ||--o{ PAYMENT_INTENT : funds
  PAYMENT_INTENT ||--o{ PAYMENT_ATTEMPT : tries
  PAYMENT_ATTEMPT ||--o| PAYMENT_CAPTURE : verifies
  SHIPMENT ||--o{ VERIFIED_COD_COLLECTION : reports
  VERIFIED_COD_COLLECTION ||--o{ COD_COLLECTION_ALLOCATION : assigns
  PAYMENT_CAPTURE ||--o{ REFUND : funds
  VERIFIED_COD_COLLECTION ||--o{ REFUND : funds
  ORDER ||--o{ FULFILLMENT_ORDER : splits
  FULFILLMENT_ORDER ||--|{ SHIPMENT : books
  SHIPMENT ||--o{ SHIPMENT_LINE : delivers
  SHIPMENT ||--o{ RETURN_AUTHORIZATION : returns
  RETURN_AUTHORIZATION ||--|{ RETURN_LINE : selects
  RETURN_LINE ||--o{ RETURN_INSPECTION : grades
~~~

Cross-context customer/order/shipment links above are opaque IDs, not SQL FKs. A payment intent is an attempt; only a verified capture or courier COD collection is refundable. MFS/bank payout may differ from the incoming COD collection rail.

### Courier settlement

~~~mermaid
erDiagram
  COURIER_CONTRACT ||--o{ RECEIVABLE : prices
  SHIPMENT ||--o| RECEIVABLE : earns_on_collection
  RECEIVABLE ||--o{ REMITTANCE_ALLOCATION : matches
  REMITTANCE ||--|{ REMITTANCE_LINE : contains
  REMITTANCE_LINE ||--o{ REMITTANCE_ALLOCATION : settles
  JOURNAL ||--|{ POSTING : contains
  ACCOUNT ||--o{ POSTING : posts
~~~

A verified collection becomes an event-fed CourierLedger receivable and a separate Payment funding source. Fee rate and base are effective-dated merchant facts. Posted journals have at least two currency-matched entries and balance to zero; corrections are reversals.

### Durable events, audit, social commerce and support

~~~mermaid
erDiagram
  COMMAND_RECEIPT ||--o{ OUTBOX_EVENT : commits_with
  OUTBOX_EVENT ||--o{ CONSUMER_INBOX : deduplicates
  OUTBOX_EVENT ||--o| AUDIT_LOG : projects_to
  CUSTOMER ||--o{ TICKET : contacts
  TICKET ||--o{ TICKET_EVENT : records
  SOCIAL_CHANNEL ||--o{ SOCIAL_WEBHOOK_INBOX : receives
  SOCIAL_CHANNEL ||--o{ CONVERSATION : routes
  CONVERSATION ||--o{ SOCIAL_MESSAGE : contains
  SOCIAL_MESSAGE ||--o{ SOCIAL_ORDER_COMMAND : requests
  TEMPLATE ||--o{ NOTIFICATION_MESSAGE : renders
  NOTIFICATION_MESSAGE ||--o{ DELIVERY_ATTEMPT : sends
  NOTIFICATION_MESSAGE ||--o| DEAD_LETTER : isolates
  CUSTOMER ||--o{ MODERATION_REVIEW : authors
  MODERATION_REVIEW ||--o{ MODERATION_DECISION : adjudicates
~~~

Provider transport and verified inbox belong to Notification; human conversation and order drafting belong to Support. Versioned event IDs and one local inbox transaction make duplicate/reordered delivery safe.

## Atomic operations and constraints

| Operation | Database owner and transaction | Required invariant |
| --- | --- | --- |
| Stock reserve/release/deduct | Inventory | Sorted row locks; balance, movement, reservation, receipt and outbox commit together |
| Cart merge | Cart | Unique merge receipt and optimistic cart version |
| Quote/promotion | Pricing | Integer subunits, rule snapshot and serialized quota holds |
| Checkout | Order orchestration; participant writes stay owner-local | Durable saga, idempotent local commands and compensations |
| MFS capture/refund | Payment | Provider verification; query ambiguous outcome before retry |
| COD collection/refund | Payment | Verified event source, remaining-collection cap, line allocation and payout attempt |
| Courier payout | CourierLedger | Matched statement, receivable allocation and balanced immutable journal |
| Shipment/return | Fulfillment; stock stays Inventory-owned | Booking dedup and inspection before stock adjustment |
| Audit | Source context then Audit projection | Source state and redacted audit outbox fact commit together |
| Social message/order | Notification transport then Support conversation | Verified inbox; link identity only after proof |
| Optional wallet credit | Payment | Customer liability and balancing account post together |

A row CHECK cannot prove sums over multiple rows. Lock aggregates or use guarded posting functions for order totals, promotion quotas, cumulative capture/refund, COD partial refunds, payout allocations and journal balance. These SQL constraints supplement transaction and concurrency tests.

## Partitioning and referential-integrity rules

- orders, audit logs and each context's outbox are UTC range-partitioned. Partition keys participate in partitioned primary keys: orders use (id, created_at), audit uses (id, occurred_at).
- Each owner has an unpartitioned local event-ID registry. Retain it through downstream replay, financial lookup and legal retention.
- Foreign keys stay inside their owner schema. A line FK to a partitioned order includes ID and creation timestamp; Payment keeps only an opaque order UUID.
- Provision future partitions and alert on coverage. The reference SQL has no default partition that could conceal a scheduler failure.
- Runtime roles have DML only in their schema and cannot run DDL or disable audit/ledger guards. Migration and break-glass credentials are separate.

PostgreSQL 16+ uses bigint subunits, and TypeScript uses bigint calculations. Public JSON integer amounts are bounded by JavaScript's safe integer range. Currency exponent is explicit: BDT exponent two means ৳19.99 is 1999 paisa.
