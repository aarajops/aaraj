# 02 - Authorization

Aaraj uses Better Auth for authentication and NestJS's `@nestjs/authorization` for application permissions. The community Better Auth Nest adapter validates the session and sets `request.user`; the authorization guard runs afterward. The authorization package is pinned at `0.0.1`; upgrades require compatibility checks.

## Implemented base

The implementation lives in `apps/api/src/platform/authorization/`. `PlatformAuthorizationModule` exports `PermissionsService` for feature policies. Better Auth remains in `apps/api/src/auth/`. Organization and Admin plugins are not enabled.

The exact roles are `superadmin`, `admin`, `staff`, `moderator`, and `customer`. Roles bundle permissions; they have no implicit hierarchy. Each existing authenticated user has baseline `customer` access. Elevated assignments are additive, persisted in `access.role_assignment`, and read from PostgreSQL for each permission check. They are never trusted from a request body, client session, cookie payload, or client-side permission check. A missing identity or unknown permission denies access; a database failure cannot grant access.

Current permissions cover the implemented access-management, audit-review, product-catalog, and category-management workflows:

| Role       | Access management | Audit review (`audit.read`) | Product catalog (`catalog.manage`) | Category management (`catalog.categories.manage`) |
| ---------- | ----------------- | --------------------------- | ---------------------------------- | ------------------------------------------------- |
| superadmin | Yes               | Yes                         | Yes                                | Yes                                               |
| admin      | Read only         | No                          | Yes                                | Yes                                               |
| staff      | Own access only   | No                          | Yes                                | No                                                |
| moderator  | Own access only   | No                          | No                                 | No                                                |
| customer   | Own access only   | No                          | No                                 | No                                                |

There is no wildcard or blanket superadmin bypass. Product management is granted to staff/admin/superadmin; category-tree management is a separate capability granted only to admin/superadmin. Both permissions are independent of role hierarchy and can be changed in reviewed code. No warehouse/location scope exists. Permission names and request/response schemas live in `packages/contracts/src/access/index.ts`; server grants live in `access.permissions.ts`. Role bundles are reviewed code, not user-editable configuration.

## API

All paths below have the `/api` prefix. Authentication and explicit Nest policies protect access, audit, and catalog management routes. Public catalog browse routes are intentionally anonymous and return published records only.

| Method and path                            | Requirement        | Result                                                   |
| ------------------------------------------ | ------------------ | -------------------------------------------------------- |
| `GET /access/me`                           | `access.read_self` | Current user's ID, roles, and effective permission names |
| `GET /access/roles`                        | `access.read`      | Five roles and their explicit permission bundles         |
| `GET /access/users/:userId`                | `access.read`      | Target user's effective access; 404 if missing           |
| `PUT /access/users/:userId/roles/:role`    | `access.manage`    | Grant one elevated role                                  |
| `DELETE /access/users/:userId/roles/:role` | `access.manage`    | Revoke one elevated role                                 |
| `GET /catalog/categories`                 | Anonymous                    | Active public category tree                         |
| `GET /catalog/categories/manage`          | `catalog.categories.manage`  | Full tree for authorized category managers           |
| `POST /catalog/categories`                | `catalog.categories.manage`  | Create and audit a category                         |
| `PATCH /catalog/categories/:id`           | `catalog.categories.manage`  | Update and audit a category                         |

Current role and catalog writes require JSON with a reason, an exact trusted `Origin` matching `CLIENT_URL`, and a session created by a sign-in within the last 15 minutes. A stale session receives 403 with `code: RECENT_SIGN_IN_REQUIRED`; sign in again with the existing email/password. This is not an OTP or customer sign-up requirement. Better Auth protects its own auth endpoints against CSRF; Nest write routes enforce their own Origin and recent-sign-in check through `CookieMutationGuard`.

Unknown fields, unknown roles, wildcard roles, `customer` assignment, invalid user IDs, and empty/oversized reasons are rejected by Nest's `StandardSchemaValidationPipe` using the shared schemas. Customer is the baseline, so removing every elevated assignment returns the user to customer access.

Only superadmins can change role assignments. Staff/admin/superadmin may manage catalog products; only admin/superadmin may manage categories. Self-grants are forbidden. Self-revocation is allowed unless it would remove the last superadmin. The FK prevents deleting an account with elevated assignments; revoke those assignments through the audited workflow first. Clients cannot become privileged through ordinary sign-up.

`AccessService` checks permission inside a PostgreSQL transaction after taking a shared advisory transaction lock for assignment writes. Bootstrap uses the same lock. This serializes competing role changes across API instances, checks the latest grants, and prevents concurrent removal of all superadmins. Role changes and their audit event commit or roll back together. Repeating the same grant/revoke has no additional effect and produces no duplicate audit event. Revocation takes effect on the next permission check using the same session; it does not wait for a cached permission list to expire. Requests already authorized may finish. For sensitive mutations whose authorization depends on mutable state, evaluate that authorization in the transaction immediately before writing, as role changes do.

Audit events cover role grants/revocations/bootstrap, Better Auth sign-up/sign-in/sign-out outcomes, Nest authorization denials, and catalog create/update. Auth events store outcome and route only; authorization denials store policy/ability, reason, and handler; catalog writes and role changes share their business transaction with the audit insert. `GET /api/audit/events` is `audit.read`-protected and currently granted only to superadmins. It supports bounded pages, an opaque cursor, and exact event-type/actor filters. The database trigger rejects UPDATE, DELETE, and TRUNCATE. Production must use a separate migration/owner role and restricted runtime role; a database superuser can still disable the trigger. Production audit retention requires approval from the business/legal owner before launch.

## Migration and first superadmin

`apps/api/drizzle/0002_pbac_role_assignments.sql` adds the `access` schema and role-assignment table. `0003_audit_append_only.sql` blocks audit row mutation, `0004_catalog_products.sql` adds the first catalog-owned table, `0007_managed_catalog_categories.sql` migrates free-text categories to managed records, and `0008_query_aligned_indexes.sql` aligns indexes with current queries. The existing Drizzle migration journal remains authoritative. Use these commands from the repository root when the earlier migrations are already recorded (or on a fresh database):

```bash
pnpm --filter @aaraj/contracts build
pnpm --filter @aaraj/api db:migrate
pnpm --filter @aaraj/api build
```

The runtime pool and Drizzle migration connection both explicitly require certificate-verified TLS when `NODE_ENV=production`; `POSTGRES_SSL_CA_FILE` supplies a CA bundle when required. Production migrations use separate `MIGRATION_POSTGRES_USER`/`MIGRATION_POSTGRES_PASSWORD` credentials from the runtime `POSTGRES_USER`.

Create your normal email/password account first. Find its exact ID through your trusted local database connection:

```sql
SELECT id, email FROM identity."user" WHERE email = 'your-email@example.com';
```

Then run the operator-only command, substituting that account's ID:

```bash
pnpm --filter @aaraj/api access:bootstrap EXISTING_USER_ID --reason "Initial Aaraj owner setup"
```

Bootstrap requires database/operator access, selects an existing account, records an audit event, and refuses once any superadmin exists. It is not an HTTP endpoint, startup seed, email allowlist, or default password. Subsequent assignments use the protected API. Database owners can bypass application rules, so production runtime/operator credentials must be controlled separately.

If an older database had SQL applied manually without the Drizzle journal, reconcile its migration history before using `db:migrate`; do not replay existing table-creation SQL blindly. No migration grants staff privileges automatically.

## Extending the base

For each new feature:

1. Add only its real permission names to the shared contract and explicit grants to `ROLE_PERMISSIONS`.
2. Import `PlatformAuthorizationModule` in the feature module and inject `PermissionsService` into its `@Policy()` provider. Register the policy as a provider. Keep the root Better Auth module before the authorization module.
3. Give each protected operation an authorization check at the appropriate boundary: use `@Can(FeaturePolicy, 'ability')` for a handler-level capability, or `AuthorizationService.authorize()` in the owning service when the operation needs service-level enforcement or business context. Policies call `permissions.has(user, 'feature.action')`; controllers do not compare role names.
4. Keep record ownership, state, amount, and transaction-dependent checks in the service. Pass the current Drizzle transaction into permission resolution when authorization must be consistent with the write. Use route and service checks together only when they enforce distinct rules; do not repeat the same ability check. A generic permission never grants access to another customer's private record by itself.
5. Test an authenticated allow, authenticated denial, guest rejection, cross-customer record access, and revocation for the feature. Add trusted-origin protection to cookie-authenticated writes.

Nest's official authorization guard passes handlers without `@Can()` through. Such routes have only the Better Auth authentication check unless their services explicitly authorize. Every protected business operation must have a route-level `@Can()` check or a service-level `authorize()` check; record-specific and transaction-dependent rules belong in the service. Use both layers only for separate rules, and test denials. Public routes must be intentionally marked with the adapter's `@AllowAnonymous()` or `@OptionalAuth()` as appropriate.

## Verification

Run `pnpm --filter @aaraj/api test:e2e`. Tests create and migrate a uniquely named disposable PostgreSQL database for each test file, and use isolated Redis keys in logical database 15. They do not migrate, truncate, or create privileged accounts in the developer database. The configured PostgreSQL test user needs `CREATEDB`; CI supplies a dedicated PostgreSQL service. Test teardown drops only the generated databases and removes only that run's Redis keys.

The suite exercises real Better Auth account/session creation and HTTP sign-in, Nest guard ordering, all five role bundles, denied escalation, private access inspection, input and Origin validation, recent sign-in, concurrent bootstrap, concurrent last-superadmin protection, grant/revoke retries, immediate revocation, session sign-out, and audit-failure rollback. Unit tests also verify unknown-permission/missing-identity denial and database-error propagation.

References: [NestJS authorization](https://docs.nestjs.com/security/authorization), [NestJS validation](https://docs.nestjs.com/techniques/validation), [Better Auth NestJS integration](https://better-auth.com/docs/integrations/nestjs), [Better Auth session management](https://better-auth.com/docs/concepts/session-management).
