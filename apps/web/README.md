# Aaraj Web

The Aaraj storefront and staff catalog UI use the Next.js App Router. The NestJS API remains the source of truth for authentication, authorization, audit records, and product data.

## Organization

```text
src/                         Application source code
  app/                       Routes, layouts, and route-specific loading UI
    _components/             App-wide route-independent components
  components/ui/             shadcn/ui components used by the app
  features/auth/             Sign-in UI, Better Auth client, server session read
  features/catalog/          Catalog UI, server queries, browser API client
  lib/                       Shared application utilities
e2e/                         Playwright storefront workflow and test API
```

- Keep `src/app/**/page.tsx` focused on route behavior and composing feature code.
- Keep auth and catalog implementation in their feature folders; only create shared code when more than one feature needs it.
- Keep API contracts in `@aaraj/contracts`. Server reads use `server-only`; browser auth and catalog API modules use `client-only`.
- Send catalog mutations through the same-origin `/api` route. The Nest API enforces permissions and writes audit events; UI visibility is not an access-control check.
- Preserve the current URLs unless a product or routing requirement calls for a change.

## Commands

Run the storefront with the rest of the local stack from the repository root using `pnpm dev`, or run only this app with `pnpm --filter @aaraj/web dev`.

```bash
pnpm --filter @aaraj/web typecheck
pnpm --filter @aaraj/web lint
pnpm --filter @aaraj/web build
pnpm --filter @aaraj/web test:e2e
```

Install the Playwright browser once with `pnpm --filter @aaraj/web exec playwright install chromium`. The browser suite uses its isolated test API; API E2E tests separately cover Nest authorization, persistence, and audit behavior.
