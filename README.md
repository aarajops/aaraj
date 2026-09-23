# Araz - Enterprise E-Commerce Platform

Enterprise-grade full-stack TypeScript monorepo powered by **pnpm workspaces** and **Node.js 24 LTS**.

---

## Workspace Architecture

```text
araz/
├── apps/
│   ├── api/                   # NestJS 12 backend service (@araz/api) -> Port 3001
│   └── web/                   # Next.js 16 storefront (@araz/web) -> Port 3000
│
├── packages/
│   └── contracts/             # Shared domain schemas & DTOs (@araz/contracts)
│
├── pnpm-workspace.yaml        # Workspace definition
├── pnpm-lock.yaml             # Authoritative lockfile
├── package.json               # Root task orchestrator
├── tsconfig.base.json         # Shared TypeScript compiler options
├── .editorconfig
└── .gitignore
```

---

## Architectural Rules

1. **Responsibility Boundaries**:
   * `apps/*`: Independently deployable applications only.
   * `packages/*`: Reusable internal domain libraries only.
2. **Dependency Direction**:
   * `apps -> packages` (allowed)
   * `packages -> packages` (allowed)
   * `packages -> apps` (strictly forbidden)
3. **Clean Exports**:
   * External consumers import from `@araz/contracts` using its public exports.
   * Deep imports into `packages/*/src/...` are strictly prohibited.
4. **Toolchain & Runtime**:
   * **Package Manager**: `pnpm@12.5.1`
   * **Application Runtime**: `Node.js 24 LTS` (`>=24.15.0 <25`)

---

## Development Quickstart

### Prerequisites
* Node.js `>=24.15.0 <25`
* pnpm `12.5.1`

### Installation
```bash
pnpm install
```

### Common Commands
All workspaces expose a standardized task interface:

```bash
# Start all deployable applications in development mode
pnpm dev

# Start specific applications
pnpm dev:web    # Next.js storefront on http://localhost:3000
pnpm dev:api    # NestJS backend on http://localhost:3001

# Run build across all workspaces (contracts build first, then apps)
pnpm build

# Typecheck all TypeScript code
pnpm typecheck

# Lint all code
pnpm lint

# Run all test suites
pnpm test
```

---

## Port & Proxy Configuration

* **Storefront (`@araz/web`)**: Runs on `http://localhost:3000`
* **API (`@araz/api`)**: Runs on `http://localhost:3001` with global `/api` prefix
* **Development Rewrites**: In development, Next.js rewrites `/api/:path*` to the internal API URL (`process.env.API_INTERNAL_URL ?? 'http://localhost:3001'`), preventing browser CORS friction.
