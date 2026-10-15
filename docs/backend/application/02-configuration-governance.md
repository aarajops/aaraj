# Configuration ownership and change policy

This document defines where Aaraj configuration lives and which domain owns its validation, access, and change lifecycle. A shared admin Settings area may group links to settings, but values remain with the domain whose behavior they control.

## Configuration classes

| Class                     | Source of truth                                               | Examples                                                          |
| ------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Code and release rules    | Contracts, application code, and reviewed database migrations | Supported tax calculations, validation rules, schema invariants   |
| Deployment/runtime values | Per-deployment environment or host configuration              | Database and Redis endpoints, public canonical origin, ports      |
| Secrets                   | Protected deployment provisioning and secret-handling process | Auth and encryption keys, courier and object-storage credentials  |
| Business settings         | Database tables owned by their business domain                | Storefront display settings, tax profile and calculation behavior |
| Public settings response  | Explicit allowlisted domain projection                        | Store name, SEO defaults, announcement, public contacts, assets   |

The public settings projection must never include deployment values, secret material, audit metadata, actor identifiers, or private integration state. Secret values must not be placed in merchant-editable settings or audit metadata.

## Runtime configuration

Production API credentials are supplied out of band through the protected host runtime environment file. The public, non-secret `CLIENT_URL` is supplied through the separate site environment file and is shared with the API and storefront. Local-only values are loaded by `loadLocalEnvironment`. Keep secrets out of source control and public APIs. Validate required values before the consuming integration is used; malformed integration configuration should fail clearly rather than being partially accepted.

Current implementation examples:

- [Production runtime environment template](../../../infrastructure/production/host/runtime.env.example)
- [Production site environment template](../../../infrastructure/production/host/site.env.example)
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
- Storefront brand color, shared by the CSS brand accent and app manifest theme color.
- Storefront background color, shared by the storefront CSS theme, app manifest, and generated app icons.
- Optional SEO title and description defaults for the storefront home page and metadata defaults for routes without page-specific content.
- Optional social sharing image and descriptive alt text, used for Open Graph and X cards. Product pages use product copy and imagery when available; without a dedicated share image, the storefront uses the configured logo, then its bundled public AARAJ logo.
- Public support phone (international E.164), support email, and business address.
- Optional horizontal store logo, square brand icon, and small browser-favicon override.
- Allowlisted social network links and up to eight footer information links.
- Optional plain-text footer description.

`GET /api/v1/storefront/settings` returns the public allowlisted projection. `GET` and `PUT /api/v1/storefront/manage/settings` are protected by `storefront.settings.manage`. Profile edits use strict shared contracts, an optimistic version check, and an audit event in the same database transaction. The API rejects stale edits. Public settings and management responses use `Cache-Control: no-store` so new profile text appears on the next request.

Logo, brand icon, favicon, and social image uploads use the authorized multipart asset endpoint. The API applies a per-process upload admission limit before Multer buffers a file, caps each source at 5 MiB, inspects file signatures, and decodes only JPEG, PNG, and WebP with bounded pixel count and processing time. It normalizes logos to bounded WebP, square brand icons to 1024×1024 PNG, favicons to 64×64 PNG, and social images to 1200×630 JPEG, then stores them in the existing private R2 bucket under immutable generated keys. Brand icons accept PNG or WebP sources to preserve transparent padding. The database stores the content hash, dimensions, storage key, creator, and idempotency command; active pointers on the singleton configuration determine which files are publicly readable. The public asset route validates that the requested hash and asset are active and returns a content-hashed URL with immutable caching. SVG and other active content formats are not accepted.

The migration leaves the SEO fields and images optional. Open Graph and X metadata prefers the dedicated social image, then the configured store logo, then the bundled `/public/aaraj-social.png` share image, which is composed from the actual `/public/aaraj-logo.svg` logo lockup. The storefront header and footer use the configured horizontal logo, with `/public/aaraj-logo.svg` as the fallback. Generated 192×192, 512×512, and Apple touch icons use the configured square brand icon, falling back to `/public/aaraj-icon.svg`; the 64×64 browser icon prefers the optional favicon override, then the square brand icon, then that same square fallback. Logo artwork is never used as the app-icon source. Next.js generates these icons through its metadata file conventions. It resolves page metadata on the server from the public settings response, uses the configured canonical origin (never the request `Host` header) as `metadataBase`, and emits canonical URLs for the home and product pages. Open Graph and X card images include descriptive alt text. Product detail metadata is specific to the published product; account, checkout, order, cart, and admin routes are marked noindex. `robots.txt` allows crawlers to read those page-level noindex directives and advertises the dynamic sitemap. `sitemap.xml` lists the home page and published product URLs with product update timestamps and each product's primary image. The generated `manifest.webmanifest` follows the Next.js metadata file convention, uses the public store name and description, takes `background_color` and `theme_color` from validated storefront settings, and references generated 192×192 and 512×512 square brand icons. The background setting is applied to the storefront CSS theme and generated PNG icons; the brand setting is applied to the CSS brand accent. The storefront renders configured contact details in the header/footer, and plain-text descriptions and configured footer links in the footer. Social URLs are restricted to their intended HTTPS host families; footer links accept same-origin paths or HTTPS URLs. The database asset manifest is insert-only for the runtime role and configuration changes remain versioned and audited.

Changes record the actor, reason, version, and changed field names. Audit metadata excludes setting values. Existing domain-specific settings such as tax remain with their existing modules and transaction snapshots; this feature does not move them into the storefront table.

## Change verification

Configuration changes should be tested at the layer where they take effect:

- Contract tests reject malformed colors, malformed settings, and unknown fields.
- API integration tests cover anonymous/public reads, persisted storefront colors, authorization, origin checks, stale versions, audit attribution, and transaction rollback when auditing fails.
- API E2E verifies profile validation, authorization, image normalization, idempotency, stale writes, public image delivery, clearing, audit records, and storage cleanup after transaction failure.
- Browser-to-real-API E2E uploads a horizontal logo, square brand icon, favicon override, and social image, publishes the storefront colors and SEO defaults, and verifies the rendered CSS theme, header/footer, home and product metadata, canonical origin, robots directives, manifest values, icon routes, social image delivery, and app icon.
- Runtime database grants list only the operations each domain needs.
