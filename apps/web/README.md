# Aaraj Web

The Aaraj storefront and catalog administration UI use the Next.js App Router. The NestJS API remains the source of truth for authentication, authorization, audit records, and product data.

## Organization

```text
src/                         Application source code
  app/                       Routes, layouts, and route-specific loading UI
    (admin)/admin/           Catalog administration routes under /admin
    (storefront)/            Public home, product, and account routes
    _components/             App-wide route-independent components
  components/ui/             shadcn/ui components used by the app
  features/auth/             Sign-in UI, Better Auth client, server session read
  features/catalog/          Catalog UI, server queries, browser API client
  features/inventory/        Staff on-hand stock management
  lib/                       Shared application utilities
e2e/                         Playwright storefront workflow and test API
```

- Keep `src/app/**/page.tsx` focused on route behavior and composing feature code.
- Parenthesized `(storefront)` and `(admin)` groups are omitted from URLs; `/admin` remains a real URL segment.
- Route groups do not enforce authorization. Admin pages and Nest API operations enforce their specific catalog permissions, including staff access where granted.
- Keep auth and catalog implementation in their feature folders; only create shared code when more than one feature needs it.
- `components/ui/data-table.tsx` owns shared table rendering; each feature owns its typed columns, row actions, query state, and pagination controls.
- Keep large admin lists server-paginated. Do not sort or filter one loaded page as though it represented the full collection; use the API and route search parameters for collection-wide operations.
- Keep API contracts in `@aaraj/contracts`. Server reads use `server-only`; browser auth and catalog API modules use `client-only`.
- The per-request nonce CSP requires request-time rendering so Next.js can attach the matching nonce to generated scripts. Keep the root `connection()` call aligned with `src/proxy.ts`.
- Send catalog mutations through the same-origin `/api` route. The Nest API enforces permissions and writes audit events; UI visibility is not an access-control check.
- Preserve the current URLs unless a product or routing requirement calls for a change.

## First catalog setup

A fresh database has no business categories or product records. For a new local workspace, configure `infrastructure/local/.env.local` from `.env.example`, then run `pnpm dev` from the repository root to start PostgreSQL/Redis, apply migrations, and launch the API and web app.

1. Create the operator account at `/account`. Promote the intended owner to the first superadmin with the audited bootstrap procedure in [the authorization guide](../../docs/backend/security/02-authorization.md#migration-and-first-superadmin); do not assign roles by editing the database directly.
2. As an admin or superadmin, manage the category hierarchy at `/admin/catalog/categories` and create categories at `/admin/catalog/categories/create`. Products and size guides must use an active leaf category.
3. Manage size guides at `/admin/catalog/size-guides` and create a chart at `/admin/catalog/size-guides/create` for the exact category and fit combination. Add the size labels and garment/body measurements from the supplier's chart; choose cm or inches as the input unit.
4. Manage products at `/admin/catalog` and create a product style at `/admin/catalog/create`. Select its matching category, fit, and size guide, then add one variant for each sellable color/size combination. Give every active variant a unique SKU and a whole-number BDT price; a valid GTIN is optional. Add an audit reason for each write.
5. Publish only after the product has an audience, active leaf category, matching size guide, at least one active variant, a price for every active variant, and a guide row for every variant size. Verify the listing at `/` and its detail page at `/products/<slug>`.
6. Record received stock or physical count corrections at `/admin/inventory`. Each adjustment requires a reason and is retry-safe and audited. Checkout reservations are not enabled until the checkout and payment lifecycle is implemented.

Users with `catalog.manage` (staff, admins, and superadmins) can manage products and size guides. Category management additionally requires `catalog.categories.manage` (admin or superadmin). Inventory adjustments require `inventory.manage` (staff, admins, and superadmins). Product images, cart, checkout, and payments are not implemented yet.

## Commands

Run the storefront with the rest of the local stack from the repository root using `pnpm dev`, or run only this app with `pnpm --filter @aaraj/web dev`.

```bash
pnpm --filter @aaraj/web typecheck
pnpm --filter @aaraj/web lint
pnpm --filter @aaraj/web build
pnpm --filter @aaraj/web test:e2e
pnpm --filter @aaraj/web test:e2e:integration
pnpm --filter @aaraj/web test:e2e:production
```

Install the Playwright browser once with `pnpm --filter @aaraj/web exec playwright install chromium`. The standard browser suite uses its mock API. The integration journey creates categories, a size guide, and a product, then checks publishing and storefront visibility against an isolated real API/database. The production smoke suite runs the existing production build against the mock API. Build and run both production commands with the same `API_INTERNAL_URL` value. API E2E tests separately cover Nest authorization, persistence, and audit behavior.
