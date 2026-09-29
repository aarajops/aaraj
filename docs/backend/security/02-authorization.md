# 02 - Authorization

Aaraj uses Better Auth for authentication and NestJS's `@nestjs/authorization` for application permissions. The community Better Auth Nest adapter validates the session and sets `request.user`; the authorization guard runs afterward. The authorization package is pinned at `0.0.1`; upgrades require compatibility checks.

## Implemented base

The implementation lives in `apps/api/src/platform/authorization/`. `PlatformAuthorizationModule` exports `PermissionsService` for feature policies. Better Auth remains in `apps/api/src/auth/`. Organization and Admin plugins are not enabled.

The exact roles are `superadmin`, `admin`, `staff`, `moderator`, and `customer`. Roles bundle permissions; they have no implicit hierarchy. Each existing authenticated user has baseline `customer` access. Elevated assignments are additive, persisted in `access.role_assignment`, and read from PostgreSQL for each permission check. They are never trusted from a request body, client session, cookie payload, or client-side permission check. A missing identity or unknown permission denies access; a database failure cannot grant access.

Initial permissions cover the implemented access-management workflow only:

| Role       | Own effective access (`access.read_self`) | Inspect roles and another user's access (`access.read`) | Grant/revoke elevated roles (`access.manage`) |
| ---------- | ----------------------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| superadmin | Yes                                       | Yes                                                     | Yes                                           |
| admin      | Yes                                       | Yes                                                     | No                                            |
| staff      | Yes                                       | No                                                      | No                                            |
| moderator  | Yes                                       | No                                                      | No                                            |
| customer   | Yes                                       | No                                                      | No                                            |

There is no wildcard or blanket superadmin bypass. Commerce permissions are added with their actual features. `staff` and `moderator` are valid assignable roles now; their commerce capabilities are not invented ahead of those features. Permission names and request/response schemas live in `packages/contracts/src/access.ts`; server grants live in `access.permissions.ts`. Role bundles are reviewed code, not user-editable configuration.

## API

All paths below have the `/api` prefix. Authentication and `@Can(AccessPolicy, ...)` protect every access endpoint.

| Method and path                            | Requirement        | Result                                                   |
| ------------------------------------------ | ------------------ | -------------------------------------------------------- |
| `GET /access/me`                           | `access.read_self` | Current user's ID, roles, and effective permission names |
| `GET /access/roles`                        | `access.read`      | Five roles and their explicit permission bundles         |
| `GET /access/users/:userId`                | `access.read`      | Target user's effective access; 404 if missing           |
| `PUT /access/users/:userId/roles/:role`    | `access.manage`    | Grant one elevated role                                  |
| `DELETE /access/users/:userId/roles/:role` | `access.manage`    | Revoke one elevated role                                 |

Writes require JSON `{ "reason": "Staff onboarding approved" }`, an exact trusted `Origin` matching `CLIENT_URL`, and a session created by a sign-in within the last 15 minutes. A stale session receives 403 with `code: RECENT_SIGN_IN_REQUIRED`; sign in again with the existing email/password. This is a privileged-role-change requirement, not an OTP or customer sign-up requirement. Better Auth protects its own auth endpoints against CSRF; the Nest write endpoints enforce their own Origin check through `AccessMutationGuard`.

Unknown fields, unknown roles, wildcard roles, `customer` assignment, invalid user IDs, and empty/oversized reasons are rejected by Nest's `StandardSchemaValidationPipe` using the shared schemas. Customer is the baseline, so removing every elevated assignment returns the user to customer access.

Only superadmins can change assignments. Self-grants are forbidden. Self-revocation is allowed unless it would remove the last superadmin. The FK prevents deleting an account with elevated assignments; revoke those assignments through the audited workflow first. Clients cannot become privileged through ordinary sign-up.

`AccessService` repeats permission checks inside a PostgreSQL transaction after taking a shared advisory transaction lock for assignment writes. Bootstrap uses the same lock. This serializes competing role changes across API instances, checks the latest grants, and prevents concurrent removal of all superadmins. Role changes and their audit event commit or roll back together. Repeating the same grant/revoke has no additional effect and produces no duplicate audit event. Revocation takes effect on the next permission check using the same session; it does not wait for a cached permission list to expire. Requests already authorized may finish; sensitive feature mutations should recheck authorization within their transaction as this service does.

Audit events are `access.role_granted`, `access.role_revoked`, and `access.superadmin_bootstrapped`. They contain actor, subject user ID, role, action where applicable, and the operator's reason. Reasons should describe the business decision, never contain passwords or session tokens. Nest policy denials go to the existing redacted operational logger.

## Migration and first superadmin

`apps/api/drizzle/0002_pbac_role_assignments.sql` adds the `access` schema, an enum for the four assignable roles, and the assignment table. The existing Drizzle migration journal remains authoritative. Use these commands from the repository root when the earlier migrations are already recorded (or on a fresh database):

```bash
pnpm --filter @aaraj/contracts build
pnpm --filter @aaraj/api db:migrate
pnpm --filter @aaraj/api build
```

Drizzle's connection explicitly disables TLS for local development and enables certificate-verified TLS when `NODE_ENV=production`. Production migrations require the database server's trusted certificate chain.

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
3. Use `@Can(FeaturePolicy, 'ability')` on protected handlers. Policies call `permissions.has(user, 'feature.action')`; they do not compare role names at controllers.
4. Use `AuthorizationService.authorize()` in the owning service for record ownership, state, amount, or transaction-sensitive checks. Pass the current Drizzle transaction into permission resolution where the operation needs a consistent check. A generic permission never grants access to another customer's private record by itself.
5. Test an authenticated allow, authenticated denial, guest rejection, cross-customer record access, and revocation for the feature. Add trusted-origin protection to cookie-authenticated writes.

Nest's official authorization guard passes handlers without `@Can()` through. Such routes have only the Better Auth authentication check unless their services explicitly authorize. Every protected business route must declare its policy or enforce a record policy in its service, with denial tests. Public routes must be intentionally marked with the adapter's `@AllowAnonymous()` or `@OptionalAuth()` as appropriate.

## Verification

Run `pnpm --filter @aaraj/api test:e2e`. Tests create and migrate a uniquely named disposable PostgreSQL database for each test file, and use isolated Redis keys in logical database 15. They do not migrate, truncate, or create privileged accounts in the developer database. The configured PostgreSQL test user needs `CREATEDB`; CI supplies a dedicated PostgreSQL service. Test teardown drops only the generated databases and removes only that run's Redis keys.

The suite exercises real Better Auth account/session creation and HTTP sign-in, Nest guard ordering, all five role bundles, denied escalation, private access inspection, input and Origin validation, recent sign-in, concurrent bootstrap, concurrent last-superadmin protection, grant/revoke retries, immediate revocation, session sign-out, and audit-failure rollback. Unit tests also verify unknown-permission/missing-identity denial and database-error propagation.

References: [NestJS authorization](https://docs.nestjs.com/security/authorization), [NestJS validation](https://docs.nestjs.com/techniques/validation), [Better Auth NestJS integration](https://better-auth.com/docs/integrations/nestjs), [Better Auth session management](https://better-auth.com/docs/concepts/session-management).
