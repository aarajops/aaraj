# Aaraj Web

The Aaraj storefront and catalog administration UI use the Next.js App Router. The NestJS API remains the source of truth for authentication, authorization, audit records, and product data.

## Organization

```text
src/                         Application source code
  app/                       Routes, layouts, and route-specific loading UI
    (private)/admin/         Catalog administration routes under /admin
    (storefront)/            Public home, product, and account routes
    _components/             App-wide route-independent components
  components/ui/             shadcn/ui components used by the app
  features/auth/             Sign-in UI, Better Auth client, server session read
  features/catalog/          Catalog UI, server queries, browser API client
  lib/                       Shared application utilities
e2e/                         Playwright storefront workflow and test API
```

- Keep `src/app/**/page.tsx` focused on route behavior and composing feature code.
- Parenthesized `(storefront)` and `(private)` groups are omitted from URLs; `/admin` remains a real URL segment.
- Route groups do not enforce authorization. Admin pages and Nest API operations enforce their specific catalog permissions, including staff access where granted.
- Keep auth and catalog implementation in their feature folders; only create shared code when more than one feature needs it.
- Keep API contracts in `@aaraj/contracts`. Server reads use `server-only`; browser auth and catalog API modules use `client-only`.
- The per-request nonce CSP requires request-time rendering so Next.js can attach the matching nonce to generated scripts. Keep the root `connection()` call aligned with `src/proxy.ts`.
- Send catalog mutations through the same-origin `/api` route. The Nest API enforces permissions and writes audit events; UI visibility is not an access-control check.
- Preserve the current URLs unless a product or routing requirement calls for a change.

## Commands

Run the storefront with the rest of the local stack from the repository root using `pnpm dev`, or run only this app with `pnpm --filter @aaraj/web dev`.

```bash
pnpm --filter @aaraj/web typecheck
pnpm --filter @aaraj/web lint
pnpm --filter @aaraj/web build
pnpm --filter @aaraj/web test:e2e
pnpm --filter @aaraj/web test:e2e:production
```

Install the Playwright browser once with `pnpm --filter @aaraj/web exec playwright install chromium`. The standard browser suite uses its isolated test API, and the production smoke suite runs the existing production build against that API. Build and run both production commands with the same `API_INTERNAL_URL` value. API E2E tests separately cover Nest authorization, persistence, and audit behavior.
