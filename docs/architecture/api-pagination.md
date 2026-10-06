# API pagination policy

This policy defines the shared pagination rules for Aaraj collection APIs. The
frontend may choose a smaller page size for a specific interaction, but it
must use the same API contract and cannot enforce server limits or permissions.

## Shared page-size policy

- `limit` is optional and defaults to 50.
- The API accepts `limit` values from 1 through 100. Values outside that range
  are rejected as invalid requests.
- Collection services enforce the requested limit in the database query and
  fetch at most one additional row to determine whether another page exists.
- These values are Aaraj's shared policy, not universal values prescribed by a
  standards body. The default of 50 matches the existing audit-list contract;
  the maximum of 100 matches the existing resource bound. Revisit them using
  production-like payload and query measurements, not endpoint-by-endpoint
  guesses.

The Zod schemas and constants live in `packages/contracts/src/common/pagination.ts`.
Feature contracts compose those shared schemas rather than redefining limits.

## Continuation strategies

Each list contract uses the continuation mechanism suited to that collection:

- Product and size-guide administration currently use `limit` and `offset`,
  returning named collections with `hasMore` and `nextOffset`. Their query
  order must remain deterministic and unique. The current maximum offset is
  100,000; reaching that boundary is reported to the caller rather than
  silently presented as the end of the collection. This ceiling is inherited
  from the earlier contract and has not been validated against production-scale
  query plans.
- Categories are deliberately returned as a complete tree and filtered in
  memory while the API enforces the existing 500-category cap. Keep that
  bounded approach for the tree-shaped editor. If the cap or observed payload
  size makes it unsuitable, add a server-side search/pagination contract before
  increasing the cap.
- The audit log uses `limit` and a cursor, returning `events` and
  `nextCursor`. The token is encrypted and authenticated, expires after three
  days, and binds the continuation point to the list filters. Its encryption
  key is derived from `BETTER_AUTH_SECRET`, so rotating that secret invalidates
  outstanding cursors. The API must authorize each request independently of
  the cursor.

Offset pagination supports direct page URLs and previous/next navigation, but
deep offsets can require PostgreSQL to compute many skipped rows. Treat the
current offset ceiling as provisional until it has realistic query-plan and
load measurements; do not raise it without that evidence. For new, high-volume
append-heavy collections such as orders and audit events, prefer a stable
keyset cursor from the initial API contract. Migrate existing product or
size-guide lists only if representative load tests, expected collection size,
or real deep-page usage justify the added cursor contract. A cursor must not
encode authorization.

Catalog REST endpoints are served under `/api/v1`; first-party workspace
clients use that version. Before deployment, check whether any separately
deployed consumer still depends on the former unversioned paths or array
response. Migrate such consumers or define a bounded compatibility period;
do not assume the route change is invisible to them.

## Frontend responsibilities

- Keep the requested `limit` and continuation value in the URL when users
  navigate, so reloads and browser history preserve the page.
- Render controls from API continuation metadata; do not infer that the API
  returned the whole collection from a short sample or request the maximum to
  simulate “fetch all.”
- Treat query-string values as untrusted input and validate them before making
  an API request. The API repeats validation and remains authoritative.
- Apply filtering and sorting before pagination on the server. If sortable
  columns are introduced, map an explicit contract enum to known database
  expressions; never interpolate a client-provided column name or sort only the
  currently visible page.
- Preserve staff authorization on every page request.

The numeric examples in vendor guidance are examples, not mandatory values.
Microsoft recommends bounded `limit`/`offset` pages and documented defaults;
OWASP recommends limiting records returned per request. Google AIP-158 uses a
page-token pattern and requires opaque tokens. PostgreSQL requires a unique
ordering for predictable offset pages and warns that deep offsets can be
inefficient. Next.js supports loading server-side filtered, paginated, and
sorted data from the Page `searchParams` prop. Aaraj follows the shared limits
above while using offsets for current catalog administration and a cursor for
the audit stream.

References: [Next.js Page convention](https://nextjs.org/docs/app/api-reference/file-conventions/page), [Microsoft REST API design](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design), [OWASP API4:2023](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/), [Google AIP-158](https://google.aip.dev/158), and [PostgreSQL `LIMIT` and `OFFSET`](https://www.postgresql.org/docs/current/queries-limit.html).
