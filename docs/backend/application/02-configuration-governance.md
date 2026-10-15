# Configuration ownership and change policy

This document defines where Aaraj configuration lives and which domain owns its validation, access, and change lifecycle. A shared admin Settings area may group links to settings, but values remain with the domain whose behavior they control.

## Configuration classes

| Class                     | Source of truth                                               | Examples                                                          |
| ------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Code and release rules    | Contracts, application code, and reviewed database migrations | Supported tax calculations, validation rules, schema invariants   |
| Deployment/runtime values | Per-deployment environment or host configuration              | Database and Redis endpoints, canonical URLs, ports               |
| Secrets                   | Protected deployment provisioning and secret-handling process | Auth and encryption keys, courier and object-storage credentials  |
| Business settings         | Database tables owned by their business domain                | Storefront display settings, tax profile and calculation behavior |
| Public settings response  | Explicit allowlisted domain projection                        | Store name, announcement, public contacts, brand assets           |

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

## Storefront settings

The single-store profile includes:

- Store display name and optional announcement banner.
- Public support phone (international E.164), support email, and business address.
- Optional logo and favicon assets.
- Allowlisted social network links and up to eight footer information links.
- Optional plain-text footer description.

`GET /api/v1/storefront/settings` returns the public allowlisted projection. `GET` and `PUT /api/v1/storefront/manage/settings` are protected by `storefront.settings.manage`. Profile edits use strict shared contracts, an optimistic version check, and an audit event in the same database transaction. The API rejects stale edits. Public settings and management responses use `Cache-Control: no-store` so new profile text appears on the next request.

Logo and favicon uploads use separate authorized multipart endpoints. The API applies a per-process upload admission limit before Multer buffers a file, caps each source at 5 MiB, inspects file signatures, and decodes only JPEG, PNG, and WebP with bounded pixel count and processing time. It re-encodes logos as bounded WebP and favicons as 64×64 PNG, then stores them in the existing private R2 bucket under immutable generated keys. The database stores the content hash, dimensions, storage key, creator, and idempotency command; active pointers on the singleton configuration determine which files are publicly readable. The public asset route validates that the requested hash and asset are active and returns a content-hashed URL with immutable caching. SVG and other active content formats are not accepted.

The migration seeds safe defaults: AARAJ as the display name, no announcement, and no optional public profile values. A failed storefront settings fetch falls back to those defaults. The app icon route resolves the configured favicon dynamically; when no configured favicon can be served, it renders a monogram. The storefront renders the configured logo and contact details in the header/footer, and plain-text descriptions and configured footer links in the footer. Social URLs are restricted to their intended HTTPS host families; footer links accept same-origin paths or HTTPS URLs. The database asset manifest is insert-only for the runtime role and configuration changes remain versioned and audited.

Changes record the actor, reason, version, and changed field names. Audit metadata excludes setting values. Existing domain-specific settings such as tax remain with their existing modules and transaction snapshots; this feature does not move them into the storefront table.

## Change verification

Configuration changes should be tested at the layer where they take effect:

- Contract tests reject malformed and unknown fields.
- API integration tests cover anonymous/public reads, authorization, origin checks, stale versions, audit attribution, and transaction rollback when auditing fails.
- API E2E verifies profile validation, authorization, image normalization, idempotency, stale writes, public image delivery, clearing, audit records, and storage cleanup after transaction failure.
- Browser-to-real-API E2E uploads a logo and favicon, publishes the public profile, and verifies the rendered header, footer, metadata, and app icon.
- Runtime database grants list only the operations each domain needs.
