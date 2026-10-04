# Aaraj - Enterprise E-Commerce Platform

Enterprise-grade full-stack TypeScript monorepo powered by **pnpm workspaces** and **Node.js 24 LTS**.

---

## Workspace Architecture

```text
aaraj/
├── apps/
│   ├── api/                   # NestJS 12 backend service (@aaraj/api) -> Port 3001
│   └── web/                   # Next.js 16 storefront (@aaraj/web) -> Port 3000
│
├── packages/
│   └── contracts/             # Shared domain schemas & DTOs (@aaraj/contracts)
│
├── docs/                      # Architectural standards & official engineering documentation
│   ├── README.md              # Documentation portal
│   └── backend/               # NestJS core fundamentals & architectural reference
│
├── pnpm-workspace.yaml        # Workspace definition
├── pnpm-lock.yaml             # Authoritative lockfile
├── package.json               # Root task orchestrator
├── tsconfig.base.json         # Shared TypeScript compiler options
├── .editorconfig
└── .gitignore
```

---

## Engineering Documentation

The repository maintains an authoritative, durable documentation portal under `/docs`:

- **[Engineering Documentation Portal](docs/README.md)**: Monorepo architecture, boundaries, and standards.
- **[Enterprise E-Commerce Blueprint & Roadmap](docs/architecture/ecommerce-blueprint.md)**: All 36 enterprise and Bangladesh localization pillars, relational schema, implementation phases, and exact Day 1 setup checklist.
- **[NestJS Backend Standards & Reference](docs/backend/README.md)**: Deep architectural guide covering First Steps, Controllers, Providers, Modules, Middleware, Exception Filters, Pipes, Guards, Interceptors, Custom Decorators, and the Request Lifecycle.

---

## Architectural Rules

1. **Responsibility Boundaries**:
   - `apps/*`: Independently deployable applications only.
   - `packages/*`: Reusable internal domain libraries only.
2. **Dependency Direction**:
   - `apps -> packages` (allowed)
   - `packages -> packages` (allowed)
   - `packages -> apps` (strictly forbidden)
3. **Clean Exports**:
   - External consumers import from `@aaraj/contracts` using its public exports.
   - Deep imports into `packages/*/src/...` are strictly prohibited.
4. **Toolchain & Runtime**:
   - **Package Manager**: `pnpm@12.5.1`
   - **Application Runtime**: `Node.js 24 LTS` (`>=24.15.0 <25`)

---

## Development Quickstart

### Code formatting

Use double quotes in TypeScript/JavaScript strings and JSX attributes across all workspaces. The root Prettier configuration is shared by the API, storefront, and contracts. Run `pnpm format` to apply it or `pnpm format:check` to verify it; CI checks formatting too. Prettier may choose single quotes to avoid escaping embedded double quotes. Preserve template literals, SQL string literals, and shell quoting where their syntax or behavior requires them.

### Prerequisites

- Node.js `>=24.15.0 <25` with `node` available on `PATH` (`node --version` should work)
- pnpm `12.5.1`
- Docker Engine with Docker Compose, running and accessible without `sudo`.
- `infrastructure/local/.env.local` configured from `.env.example` (keep your existing file).

Set `BETTER_AUTH_SECRET` in `.env.local` to at least 32 random bytes. Generate a value with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

On Linux, if Docker reports permission denied, add your user to the Docker group once:

```bash
sudo usermod -aG docker "$USER"
```

Log out of your desktop session and log back in, then reopen VS Code. Verify access with `docker info`. Docker group membership grants root-level Docker access; never run `pnpm dev` with `sudo`.

### Installation

Install the package manager version pinned in `package.json`, then install the workspace dependencies:

```bash
npm install --global pnpm@12.5.1
pnpm --version
pnpm install
```

The project needs Node.js before installing pnpm this way. The pnpm installation guide recommends npm on Windows; on other systems, use its platform-specific installer if npm's global install is not available.

### Common Commands

All workspaces expose a standardized task interface:

```bash
# Start PostgreSQL and Redis, wait for health checks, build contracts, apply local migrations, then start applications
pnpm dev

# Stop local database containers when finished (preserves their data)
pnpm dev:infra:stop

# Start specific applications
pnpm dev:web    # Next.js storefront on http://localhost:3000
pnpm dev:api    # NestJS backend on http://localhost:3001

# Run build across all workspaces (contracts build first, then apps)
pnpm build

# Typecheck all TypeScript code
pnpm typecheck

# Lint all code
pnpm lint

# Run package unit tests
pnpm test

# Run database-backed API tests with a disposable PostgreSQL database
pnpm --filter @aaraj/api test:e2e

# Run browser tests with a mock API
pnpm --filter @aaraj/web test:e2e

# Run a real browser-to-API smoke test with disposable PostgreSQL and Redis data
pnpm --filter @aaraj/web test:e2e:integration
```

Wait for Nest to report successful startup before opening `http://localhost:3000`. Pressing `Ctrl+C` stops the development applications; database containers remain running for the next start. Individual `dev:web` and `dev:api` commands assume infrastructure is already running; use `pnpm dev:infra` if needed.

These Compose commands are local-development helpers only. Production deployment manages its own database, Redis, and built application processes; it does not use `pnpm dev`.

---

## Port & Proxy Configuration

- **Storefront (`@aaraj/web`)**: Runs on `http://localhost:3000`
- **API (`@aaraj/api`)**: Runs on `http://localhost:3001` with global `/api` prefix
- **Same-origin API rewrite**: Next.js rewrites `/api/:path*` to the server-only `API_INTERNAL_URL` in every environment. Development defaults to `http://localhost:3001`; production builds and servers require an explicit HTTP(S) origin reachable from the Next.js server.
- **Production database roles**: Use a dedicated login role with no role memberships or extra application-table privileges; keep it separate from the migration owner. Run migrations with `MIGRATION_POSTGRES_USER` and `MIGRATION_POSTGRES_PASSWORD`, then run `pnpm --filter @aaraj/api db:grant-runtime` with those credentials and the runtime `POSTGRES_USER` and `POSTGRES_PASSWORD`. The command rejects elevated, owning, or overprivileged runtime roles and checks that its table grant policy matches the application relations. When migrations add or remove app tables, update `runtimeTableGrants` in `apps/api/src/platform/database/grant-runtime-privileges.ts`. If the schema introduces sequences or user-defined types, extend and review the corresponding policy. For new `SECURITY DEFINER` routines, revoke `PUBLIC` execution and grant it only to the roles that need it.
- **Security headers**: The web app uses a per-request nonce Content Security Policy and both apps set baseline browser security headers. Nonce-based CSP requires dynamic rendering for matched pages, so those pages do not get static optimization or default CDN caching. HSTS is sent only in production; terminate HTTPS before the application. Nest's default HSTS includes subdomains, so enable it only when the affected subdomains also support HTTPS.
