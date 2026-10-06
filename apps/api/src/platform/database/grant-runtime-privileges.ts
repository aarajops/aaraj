import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Pool } from "pg";
import { getPostgresSslOptions } from "./postgres-ssl.js";

const applicationSchemas = [
  "identity",
  "audit",
  "access",
  "catalog",
  "inventory",
] as const;

const runtimeTableGrants = [
  ["identity", "user", ["SELECT", "INSERT", "UPDATE"]],
  ["identity", "account", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
  ["identity", "session", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
  ["identity", "verification", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
  ["audit", "event", ["SELECT", "INSERT"]],
  ["access", "role_assignment", ["SELECT", "INSERT", "DELETE"]],
  ["catalog", "category", ["SELECT", "INSERT", "UPDATE"]],
  ["catalog", "product", ["SELECT", "INSERT", "UPDATE"]],
  ["catalog", "product_variant", ["SELECT", "INSERT", "UPDATE"]],
  ["catalog", "size_guide", ["SELECT", "INSERT", "UPDATE"]],
  ["catalog", "size_guide_row", ["SELECT", "INSERT", "DELETE"]],
  ["catalog", "size_guide_measurement", ["SELECT", "INSERT"]],
  ["inventory", "stock_balance", ["SELECT", "INSERT", "UPDATE"]],
  ["inventory", "stock_movement", ["SELECT", "INSERT"]],
] as const;
const runtimeTablePrivilegeMap: ReadonlyMap<string, readonly string[]> =
  new Map(
    runtimeTableGrants.map(
      ([schema, table, privileges]) =>
        [`${schema}.${table}`, privileges] as const,
    ),
  );

export async function grantRuntimePrivileges(
  pool: Pool,
  database: string,
  runtimeRole: string,
): Promise<void> {
  const quotedDatabase = quoteIdentifier(database);
  const quotedRuntimeRole = quoteIdentifier(runtimeRole);
  const databaseResult = await pool.query<{ current_database: string }>(
    "SELECT current_database() AS current_database",
  );
  if (databaseResult.rows[0]?.current_database !== database) {
    throw new Error(
      "The migration connection must be connected to the target database.",
    );
  }

  const roleResult = await pool.query<{
    oid: number;
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
  }>(
    `SELECT oid, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname = $1`,
    [runtimeRole],
  );
  const runtime = roleResult.rows[0];
  if (!runtime) throw new Error("The runtime PostgreSQL role does not exist.");
  if (
    !runtime.rolcanlogin ||
    runtime.rolsuper ||
    runtime.rolcreatedb ||
    runtime.rolcreaterole ||
    runtime.rolreplication ||
    runtime.rolbypassrls
  ) {
    throw new Error(
      "The runtime role must be a login without elevated attributes.",
    );
  }

  const membership = await pool.query(
    "SELECT 1 FROM pg_auth_members WHERE member = $1 LIMIT 1",
    [runtime.oid],
  );
  if (membership.rowCount) {
    throw new Error(
      "The runtime PostgreSQL role must not be a member of other roles.",
    );
  }

  const ownership = await pool.query(
    `SELECT 1
       FROM pg_database
       WHERE datname = $1 AND datdba = $2
     UNION ALL
     SELECT 1
       FROM pg_namespace
       WHERE nspname = ANY($3::text[])
         AND nspowner = $2
     UNION ALL
     SELECT 1
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ANY($3::text[])
         AND c.relowner = $2
     UNION ALL
     SELECT 1
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = ANY($3::text[])
         AND t.typowner = $2
     UNION ALL
     SELECT 1
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = ANY($3::text[])
         AND p.proowner = $2
     LIMIT 1`,
    [database, runtime.oid, [...applicationSchemas]],
  );
  if (ownership.rowCount) {
    throw new Error(
      "The runtime PostgreSQL role must not own application data.",
    );
  }

  const databaseOrSchemaCreate = await pool.query<{
    database_create: boolean;
    schema_create: boolean;
  }>(
    `SELECT has_database_privilege($1::oid, d.oid, 'CREATE') AS database_create,
            EXISTS (
              SELECT 1
              FROM pg_namespace n
              WHERE n.nspname = ANY($3::text[])
                AND has_schema_privilege($1::oid, n.oid, 'CREATE')
            ) AS schema_create
       FROM pg_database d
       WHERE d.datname = $2`,
    [runtime.oid, database, [...applicationSchemas]],
  );
  if (
    databaseOrSchemaCreate.rows[0]?.database_create ||
    databaseOrSchemaCreate.rows[0]?.schema_create
  ) {
    throw new Error(
      "The runtime PostgreSQL role must not have database or application-schema CREATE privileges.",
    );
  }

  const relationResult = await pool.query<{
    schema_name: string;
    object_name: string;
  }>(
    `SELECT n.nspname AS schema_name, c.relname AS object_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ANY($1::text[])
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')`,
    [[...applicationSchemas]],
  );
  const actualRelations = new Set(
    relationResult.rows.map(
      ({ schema_name, object_name }) => `${schema_name}.${object_name}`,
    ),
  );
  const unlistedRelations = [...actualRelations].filter(
    (relation) => !runtimeTablePrivilegeMap.has(relation),
  );
  const missingRelations = [...runtimeTablePrivilegeMap.keys()].filter(
    (relation) => !actualRelations.has(relation),
  );
  if (unlistedRelations.length || missingRelations.length) {
    throw new Error(
      `The runtime table grant policy must match application relations. Unlisted: ${unlistedRelations.join(", ") || "none"}; missing: ${missingRelations.join(", ") || "none"}.`,
    );
  }

  const existingPrivileges = await pool.query<{
    schema_name: string;
    object_name: string;
    privilege: string;
  }>(
    `SELECT n.nspname AS schema_name,
            c.relname AS object_name,
            p.privilege
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL unnest(
         CASE WHEN c.relkind = 'S'
           THEN ARRAY['SELECT', 'UPDATE', 'USAGE']::text[]
           ELSE ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']::text[]
         END
       ) AS p(privilege)
       WHERE n.nspname = ANY($2::text[])
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
         AND CASE WHEN c.relkind = 'S'
           THEN has_sequence_privilege($1::oid, c.oid, p.privilege)
           ELSE has_table_privilege($1::oid, c.oid, p.privilege)
             OR (
               p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
               AND has_any_column_privilege($1::oid, c.oid, p.privilege)
             )
         END`,
    [runtime.oid, [...applicationSchemas]],
  );
  const unexpectedPrivileges = existingPrivileges.rows.filter(
    ({ schema_name, object_name, privilege }) =>
      !runtimeTablePrivilegeMap
        .get(`${schema_name}.${object_name}`)
        ?.some((allowed) => allowed === privilege),
  );
  if (unexpectedPrivileges.length) {
    const details = unexpectedPrivileges
      .map(
        ({ schema_name, object_name, privilege }) =>
          `${schema_name}.${object_name}:${privilege}`,
      )
      .join(", ");
    throw new Error(
      `The runtime PostgreSQL role already has application privileges outside the grant policy: ${details}. Use a clean runtime role or remove those grants.`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${quotedRuntimeRole}`,
    );
    for (const schema of applicationSchemas) {
      await client.query(
        `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quotedRuntimeRole}`,
      );
    }
    for (const [schema, table, privileges] of runtimeTableGrants) {
      await client.query(
        `GRANT ${privileges.join(", ")} ON TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(table)} TO ${quotedRuntimeRole}`,
      );
    }
    await client.query(
      `GRANT USAGE ON TYPE "access"."assigned_role" TO ${quotedRuntimeRole}`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    throw new Error(
      "Runtime database grants may only be applied in production.",
    );
  }
  const database = requiredEnvironment("POSTGRES_DB");
  const runtimeRole = requiredEnvironment("POSTGRES_USER");
  const runtimePassword = requiredEnvironment("POSTGRES_PASSWORD");
  const migrationRole = requiredEnvironment("MIGRATION_POSTGRES_USER");
  const migrationPassword = requiredEnvironment("MIGRATION_POSTGRES_PASSWORD");
  const host = requiredEnvironment("POSTGRES_HOST");
  if (runtimeRole === migrationRole) {
    throw new Error(
      "Migration and runtime PostgreSQL roles must be different.",
    );
  }

  const pool = new Pool({
    host,
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database,
    user: migrationRole,
    password: migrationPassword,
    ssl: getPostgresSslOptions(),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  const runtimePool = new Pool({
    host,
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database,
    user: runtimeRole,
    password: runtimePassword,
    ssl: getPostgresSslOptions(),
    options: "-c search_path=pg_catalog",
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  try {
    await grantRuntimePrivileges(pool, database, runtimeRole);
    await runtimePool.query('SELECT 1 FROM "identity"."user" LIMIT 0');
    await runtimePool.query('SELECT 1 FROM "audit"."event" LIMIT 0');
    await runtimePool.query('SELECT 1 FROM "access"."role_assignment" LIMIT 0');
    await runtimePool.query('SELECT 1 FROM "catalog"."product" LIMIT 0');
    console.log("Runtime PostgreSQL privileges applied.");
  } finally {
    await Promise.all([pool.end(), runtimePool.end()]);
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}

function quoteIdentifier(value: string): string {
  if (!value || value.includes("\0")) {
    throw new Error("PostgreSQL identifiers must not be empty or contain NUL.");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
