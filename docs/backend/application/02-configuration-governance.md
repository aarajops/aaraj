# Configuration ownership and change policy

This document defines where Aaraj configuration lives and which domain owns its validation, access, and change lifecycle. A shared admin Settings area may group links to settings, but values remain with the domain whose behavior they control.

## Configuration classes

| Class                     | Source of truth                                               | Examples                                                          |
| ------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Code and release rules    | Contracts, application code, and reviewed database migrations | Supported tax calculations, validation rules, schema invariants   |
| Deployment/runtime values | Per-deployment environment or host configuration              | Database and Redis endpoints, canonical URLs, ports               |
| Secrets                   | Protected deployment provisioning and secret-handling process | Auth and encryption keys, courier and object-storage credentials  |
| Business settings         | Database tables owned by their business domain                | Storefront display settings, tax profile and calculation behavior |
| Public settings response  | Explicit allowlisted domain projection                        | Store name, announcement, customer support phone                  |

The public settings projection must never include deployment values, secret material, audit metadata, actor identifiers, or private integration state. Secret values must not be placed in merchant-editable settings or audit metadata.

## Runtime configuration

Production values are supplied out of band through the host runtime environment file. Local-only values are loaded by `loadLocalEnvironment`. Keep secrets out of source control and public APIs. Validate required values before the consuming integration is used; malformed integration configuration should fail clearly rather than being partially accepted.

Current implementation examples:

- [Production runtime environment template](../../../infrastructure/production/host/runtime.env.example)
- [Local environment template](../../../infrastructure/local/.env.example)
- [Pathao configuration validation](../../../apps/api/src/delivery/pathao/pathao-config.ts)

The separate [application configuration guide](./01-configuration.md) shows a possible NestJS startup-validation approach. The current code does not yet use `@nestjs/config`; a future migration should update implementation and documentation together.

## Business settings ownership

Business settings are typed data owned by a domain module. Each owner defines its contracts, persistence, validation, authorization policy, API, audit events, and admin editor. Do not introduce a universal key/value table or arbitrary JSON blob for unrelated domain behavior.

- Catalog owns its category hierarchy and product rules.
- Tax owns its tax configuration and effective tax profiles.
- Storefront owns public store identity and presentation settings.
- Future payment, checkout, and fulfillment settings belong to those domains when those capabilities require merchant administration.
- Courier credentials remain deployment secrets; a public settings response must not expose them.

This is a single Aaraj storefront. Storefront configuration uses one seeded singleton row with a fixed ID. Add a site/store scope only with a real multi-store identity model and an explicit ownership boundary.

## Storefront settings v1

The first settings slice manages only:

- Store display name.
- Announcement banner visibility and plain-text message.
- Optional public customer-support phone in international E.164 format.

`GET /api/v1/storefront/settings` returns a public allowlisted projection. `GET` and `PUT /api/v1/storefront/manage/settings` are management routes protected by the `storefront.settings.manage` permission. The API validates every write, applies a version check, writes the setting and audit event in one transaction, and rejects stale edits. Management and public reads currently use `Cache-Control: no-store` so a saved header update is immediately visible.

The migration seeds safe defaults: AARAJ as the display name, no announcement, and no configured phone. A failed storefront settings fetch falls back to those non-sensitive defaults. The frontend renders announcement text as text; arbitrary HTML and arbitrary URL settings are not accepted.

Changes record the actor, reason, version, and changed field names. Audit metadata excludes setting values. Existing domain-specific settings such as tax remain with their existing modules and transaction snapshots; this feature does not move them into the storefront table.

## Change verification

Configuration changes should be tested at the layer where they take effect:

- Contract tests reject malformed and unknown fields.
- API integration tests cover anonymous/public reads, authorization, origin checks, stale versions, audit attribution, and transaction rollback when auditing fails.
- Browser-to-real-API E2E verifies an admin change renders in the storefront header.
- Runtime database grants list only the operations each domain needs.
