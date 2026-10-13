import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLocalEnvironment } from "../src/platform/config/local-environment.js";

process.env.NODE_ENV = "test";
loadLocalEnvironment();

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const operatorId = "migration-review-operator";
const databasePrefix = "aaraj_migration_0023_";
const databases: { name: string; pool: Pool }[] = [];
const migrationFolders: string[] = [];
let admin: Pool;
let upgradePool: Pool;
let freshPool: Pool;
let prior23Pool: Pool;
let invalidHistoryPool: Pool;
let historical: HistoricalFixtures;
let beforeOrders: Record<string, unknown>[];
let beforeInventory: Record<string, unknown>[];
let beforeAuditCount: number;

interface HistoricalOrder {
  id: string;
  reference: string;
  reservationId: string;
  variantId: string;
  bookingStatus: "booked" | "outcome_unknown" | null;
}

interface HistoricalFixtures {
  pathaoDispatched: HistoricalOrder;
  manualDispatched: HistoricalOrder;
  confirmedUndispatched: HistoricalOrder;
  uncertainBooking: HistoricalOrder;
}

describe("migration 0023 historical upgrade", () => {
  beforeAll(async () => {
    const host =
      process.env.E2E_POSTGRES_HOST ?? process.env.POSTGRES_HOST ?? "127.0.0.1";
    if (!isLoopbackHost(host)) {
      throw new Error(
        "Migration tests require a literal loopback PostgreSQL host.",
      );
    }

    const connection = {
      host,
      port: Number(
        process.env.E2E_POSTGRES_PORT ?? process.env.POSTGRES_PORT ?? 5432,
      ),
      user:
        process.env.E2E_POSTGRES_ADMIN_USER ??
        process.env.POSTGRES_USER ??
        "aaraj_test",
      password:
        process.env.E2E_POSTGRES_ADMIN_PASSWORD ??
        process.env.POSTGRES_PASSWORD ??
        "aaraj_test",
      max: 1,
      connectionTimeoutMillis: 5_000,
    };
    admin = new Pool({
      ...connection,
      database: process.env.E2E_POSTGRES_ADMIN_DATABASE ?? "postgres",
    });

    const through22Folder = await migrationPrefix(22);
    const through23Folder = await migrationPrefix(23);
    freshPool = await createDatabase(connection);
    upgradePool = await createDatabase(connection);
    prior23Pool = await createDatabase(connection);
    invalidHistoryPool = await createDatabase(connection);

    await migrate(drizzle(freshPool), { migrationsFolder });

    await migrate(drizzle(upgradePool), { migrationsFolder: through22Folder });
    historical = await seedHistoricalFixture(upgradePool);
    beforeOrders = await readHistoricalOrders(upgradePool);
    beforeInventory = await readInventory(upgradePool);
    beforeAuditCount = Number(
      (
        await upgradePool.query(
          `SELECT count(*)::int AS count FROM audit.event WHERE subject_type = 'order'`,
        )
      ).rows[0].count,
    );
    await migrate(drizzle(upgradePool), { migrationsFolder });

    await migrate(drizzle(prior23Pool), { migrationsFolder: through23Folder });
    await prior23Pool.query(`
      ALTER TABLE orders.order_header
        DROP CONSTRAINT order_delivery_provider_check;
      ALTER TABLE orders.order_header
        ADD CONSTRAINT order_delivery_provider_check CHECK (
          (fulfillment_status = 'dispatched'
            AND delivery_provider IS NOT NULL
            AND delivery_provider IN ('manual', 'pathao'))
          OR (fulfillment_status <> 'dispatched' AND delivery_provider IS NULL)
        );
    `);
    await migrate(drizzle(prior23Pool), { migrationsFolder });

    await migrate(drizzle(invalidHistoryPool), {
      migrationsFolder: through22Folder,
    });
    await seedHistoricalFixture(invalidHistoryPool);
    const collisionA = await seedOrder(invalidHistoryPool, "AA-000000000005", {
      bookingStatus: "booked",
    });
    const collisionB = await seedOrder(invalidHistoryPool, "AA-000000000006", {
      bookingStatus: "booked",
    });
    const secondCommand = (
      await invalidHistoryPool.query(
        `SELECT command_id FROM delivery.pathao_booking WHERE order_id = $1`,
        [collisionB.id],
      )
    ).rows[0].command_id as string;
    await invalidHistoryPool.query(
      `UPDATE delivery.pathao_booking
       SET reconciliation_command_id = $2,
           reconciliation_fingerprint = $3,
           reconciliation_reason = 'Valid rows with a cross-column command collision',
           reconciled_by = $4,
           reconciled_at = clock_timestamp()
       WHERE order_id = $1`,
      [
        collisionA.id,
        secondCommand,
        hash("reconciliation-collision"),
        operatorId,
      ],
    );
  }, 120_000);

  afterAll(async () => {
    for (const database of databases) await database.pool.end();
    if (admin) {
      for (const database of databases) {
        await admin.query(`DROP DATABASE IF EXISTS "${database.name}"`);
      }
      await admin.end();
    }
    await Promise.all(
      migrationFolders.map((folder) =>
        rm(folder, { recursive: true, force: true }),
      ),
    );
  });

  it("applies a fresh migration sequence and preserves the Orders/Delivery boundary", async () => {
    const state = await freshPool.query(`
      SELECT
        to_regclass('orders.pathao_booking_claim') AS claim_table,
        to_regclass('delivery.pathao_webhook_resolution') AS resolution_table,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'pathao_booking_claim_order_id_order_header_id_fk'
        ) AS orders_owned_claim_fk,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'pathao_booking_order_id_order_header_id_fk'
        ) AS delivery_to_orders_fk,
        EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'order_header_protect_update' AND NOT tgisinternal
        ) AS lifecycle_trigger,
        EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'order_header_pathao_dispatch_guard' AND NOT tgisinternal
        ) AS pathao_dispatch_trigger,
        (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations
    `);

    expect(state.rows[0]).toMatchObject({
      claim_table: "orders.pathao_booking_claim",
      resolution_table: "delivery.pathao_webhook_resolution",
      orders_owned_claim_fk: true,
      delivery_to_orders_fk: false,
      lifecycle_trigger: true,
      pathao_dispatch_trigger: true,
      migrations: await currentMigrationCount(),
    });
  });

  it("upgrades valid pre-0023 COD and Pathao history without changing Orders or Inventory", async () => {
    const afterOrders = await readHistoricalOrders(upgradePool);
    const afterInventory = await readInventory(upgradePool);
    const afterAuditCount = Number(
      (
        await upgradePool.query(
          `SELECT count(*)::int AS count FROM audit.event WHERE subject_type = 'order'`,
        )
      ).rows[0].count,
    );
    const claimRows = await upgradePool.query(
      `SELECT order_id, command_id, request_fingerprint, status
       FROM orders.pathao_booking_claim ORDER BY order_id`,
    );
    const pathaoRows = await upgradePool.query(
      `SELECT order_id, command_id, request_fingerprint, status, consignment_id
       FROM delivery.pathao_booking ORDER BY order_id`,
    );

    expect(afterOrders).toEqual(beforeOrders);
    expect(afterInventory).toEqual(beforeInventory);
    expect(afterAuditCount).toBe(beforeAuditCount);
    expect(claimRows.rowCount).toBe(2);
    const bookedEvidence = pathaoRows.rows.find(
      (row) => row.order_id === historical.pathaoDispatched.id,
    );
    const uncertainEvidence = pathaoRows.rows.find(
      (row) => row.order_id === historical.uncertainBooking.id,
    );
    if (!bookedEvidence || !uncertainEvidence) {
      throw new Error("Expected Pathao evidence was not seeded.");
    }
    expect(claimRows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          order_id: historical.pathaoDispatched.id,
          command_id: bookedEvidence.command_id,
          request_fingerprint: bookedEvidence.request_fingerprint,
          status: "booked",
        }),
        expect.objectContaining({
          order_id: historical.uncertainBooking.id,
          command_id: uncertainEvidence.command_id,
          request_fingerprint: uncertainEvidence.request_fingerprint,
          status: "outcome_unknown",
        }),
      ]),
    );
    expect(
      claimRows.rows.some(
        (row) => row.order_id === historical.manualDispatched.id,
      ),
    ).toBe(false);
    expect(
      claimRows.rows.some(
        (row) => row.order_id === historical.confirmedUndispatched.id,
      ),
    ).toBe(false);
    expect(bookedEvidence).toMatchObject({
      status: "booked",
      consignment_id: "PATHAO-CONSIGNMENT-001",
    });
    expect(uncertainEvidence).toMatchObject({
      status: "outcome_unknown",
      consignment_id: null,
    });
    const providerValues = await upgradePool.query(
      `SELECT delivery_provider FROM orders.order_header ORDER BY reference`,
    );
    expect(
      providerValues.rows.every((row) => row.delivery_provider === null),
    ).toBe(true);
  });

  it("keeps old lifecycle protections and rejects a new dispatch without provider evidence", async () => {
    await expect(
      upgradePool.query(
        `UPDATE orders.order_header
         SET delivery_operator = 'invalid lifecycle mutation'
         WHERE id = $1`,
        [historical.pathaoDispatched.id],
      ),
    ).rejects.toMatchObject({
      code: "P0001",
      message:
        "Only a pending manual serviceability review or confirmed dispatch may transition",
    });

    await expect(
      upgradePool.query(
        `UPDATE orders.order_header
         SET fulfillment_status = 'dispatched',
             dispatch_command_id = $2,
             dispatch_request_fingerprint = $3,
             delivery_operator = 'AARAJ Dispatch Desk',
             dispatched_by = $4,
             dispatched_at = clock_timestamp()
         WHERE id = $1`,
        [
          historical.confirmedUndispatched.id,
          randomUUID(),
          hash("dispatch-without-provider"),
          operatorId,
        ],
      ),
    ).rejects.toMatchObject({
      code: "P0001",
      message:
        "Dispatch provider must match the confirmed Pathao booking claim",
    });
  });

  it("applies the additive provider-check compatibility migration after an older 0023 state", async () => {
    const result = await prior23Pool.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conname = 'order_delivery_provider_check'
    `);
    expect(result.rows[0].definition.toLowerCase()).not.toContain(
      "delivery_provider is not null",
    );
    expect(
      Number(
        (
          await prior23Pool.query(
            `SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
          )
        ).rows[0].count,
      ),
    ).toBe(await currentMigrationCount());
  });

  it("rolls back the migration when existing Pathao command evidence conflicts", async () => {
    await expect(
      migrate(drizzle(invalidHistoryPool), { migrationsFolder }),
    ).rejects.toThrow();

    const state = await invalidHistoryPool.query(`
      SELECT
        to_regclass('orders.pathao_booking_claim') AS claim_table,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'orders' AND table_name = 'order_header'
            AND column_name = 'delivery_provider'
        ) AS provider_column,
        (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations,
        (SELECT count(*)::int FROM delivery.pathao_booking) AS bookings
    `);
    expect(state.rows[0]).toMatchObject({
      claim_table: null,
      provider_column: false,
      migrations: 23,
      bookings: 4,
    });
  });
});

async function createDatabase(connection: {
  host: string;
  port: number;
  user: string;
  password: string;
  max: number;
  connectionTimeoutMillis: number;
}): Promise<Pool> {
  const name = `${databasePrefix}${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const pool = new Pool({ ...connection, database: name });
  databases.push({ name, pool });
  return pool;
}

async function migrationPrefix(lastIndex: number): Promise<string> {
  const folder = await mkdtemp(
    join(tmpdir(), `aaraj-0023-through-${lastIndex}-`),
  );
  const journalPath = join(migrationsFolder, "meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
  await mkdir(join(folder, "meta"));
  migrationFolders.push(folder);
  await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) {
    await cp(
      join(migrationsFolder, `${entry.tag}.sql`),
      join(folder, `${entry.tag}.sql`),
    );
  }
  return folder;
}

async function currentMigrationCount(): Promise<number> {
  const journalPath = join(migrationsFolder, "meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

async function seedHistoricalFixture(pool: Pool): Promise<HistoricalFixtures> {
  await pool.query(`
    INSERT INTO tax.profile (
      version, effective_from, legal_merchant_reference, registration_status,
      operating_model, price_presentation, product_treatment,
      product_rate_numerator, product_rate_denominator, delivery_treatment,
      rounding_rule, source_reference, source_version, approval_reference,
      approved, test_only
    ) VALUES (
      'TEST_ONLY_BD_RETAIL_TAX_RULE_V1', '2020-01-01',
      'TEST_ONLY synthetic merchant fixture', 'not_required', 'direct_retailer',
      'vat_inclusive', 'taxable', 3, 17, 'exempt', 'half_up_bdt_v1',
      'TEST_ONLY synthetic fixture; not legal guidance', 'TEST_ONLY_V1',
      'TEST_ONLY_AUTOMATED_FIXTURE', true, true
    )
  `);
  await pool.query(
    `INSERT INTO identity.user (id, name, email, email_verified)
     VALUES ($1, 'Migration Review Operator', 'migration-review@example.test', true)`,
    [operatorId],
  );

  const pathaoDispatched = await seedOrder(pool, "AA-000000000001", {
    dispatch: true,
    bookingStatus: "booked",
  });
  const manualDispatched = await seedOrder(pool, "AA-000000000002", {
    dispatch: true,
  });
  const confirmedUndispatched = await seedOrder(pool, "AA-000000000003", {});
  const uncertainBooking = await seedOrder(pool, "AA-000000000004", {
    bookingStatus: "outcome_unknown",
  });
  return {
    pathaoDispatched,
    manualDispatched,
    confirmedUndispatched,
    uncertainBooking,
  };
}

async function seedOrder(
  pool: Pool,
  reference: string,
  options: { dispatch?: boolean; bookingStatus?: "booked" | "outcome_unknown" },
): Promise<HistoricalOrder> {
  const client = await pool.connect();
  const orderId = randomUUID();
  const quoteId = randomUUID();
  const reservationId = randomUUID();
  const variantId = randomUUID();
  const consumeCommandId = randomUUID();
  const reserveCommandId = randomUUID();
  const dispatchFingerprint = hash(`dispatch:${reference}`);
  const guestHash = hash(`guest:${reference}`);
  const guestTokenHash = hash(`token:${reference}`);
  const bookingStatus = options.bookingStatus ?? null;

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO inventory.stock_balance (variant_id, quantity_on_hand, quantity_reserved)
       VALUES ($1, 3, 1)`,
      [variantId],
    );
    await client.query(
      `INSERT INTO inventory.stock_reservation (id, status) VALUES ($1, 'held')`,
      [reservationId],
    );
    await client.query(
      `INSERT INTO inventory.stock_reservation_line (reservation_id, variant_id, quantity)
       VALUES ($1, $2, 1)`,
      [reservationId, variantId],
    );
    await client.query(
      `INSERT INTO inventory.reservation_command
         (command_id, reservation_id, operation, request_fingerprint)
       VALUES ($1, $2, 'reserve', $3)`,
      [reserveCommandId, reservationId, hash(`reserve:${reference}`)],
    );

    const geography = (
      await client.query(`
        SELECT snapshot.version, division.id AS division_id,
               division.name AS division_name, district.id AS district_id,
               district.name AS district_name
        FROM geography.snapshot AS snapshot
        JOIN geography.location AS division
          ON division.snapshot_version = snapshot.version
         AND division.level = 'division'
        JOIN geography.location AS district
          ON district.snapshot_version = snapshot.version
         AND district.level = 'district'
         AND district.parent_id = division.id
        WHERE snapshot.active
        LIMIT 1
      `)
    ).rows[0];
    const tariff = (
      await client.query(
        `SELECT version, effective_from FROM delivery.tariff
         ORDER BY effective_from DESC LIMIT 1`,
      )
    ).rows[0];

    await client.query(
      `INSERT INTO quote.snapshot (
         id, schema_version, guest_cart_hash, cart_revision, geography_version,
         division_id, division_name, district_id, district_name,
         delivery_tariff_version, delivery_tariff_effective_from,
         delivery_amount_bdt, tax_profile_version, tax_source_reference,
         tax_source_version, tax_rounding_rule, tax_profile_snapshot,
         merchandise_tax_snapshot, delivery_tax_snapshot, lines,
         merchandise_gross_bdt, total_tax_amount_bdt, total_bdt,
         validity_policy_version, created_at, expires_at
       ) VALUES (
         $1, 1, $2, 0, $3, $4, $5, $6, $7, $8, $9, 80,
         'TEST_ONLY_BD_RETAIL_TAX_RULE_V1',
         'TEST_ONLY synthetic fixture; not legal guidance', 'TEST_ONLY_V1',
         'half_up_bdt_v1', $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
         1000, 0, 1080, 'AARAJ_QUOTE_VALIDITY_2026_10_07_V1',
         now() - interval '1 hour', now() - interval '45 minutes'
       )`,
      [
        quoteId,
        guestHash,
        geography.version,
        geography.division_id,
        geography.division_name,
        geography.district_id,
        geography.district_name,
        tariff.version,
        tariff.effective_from,
        JSON.stringify({ version: "TEST_ONLY_BD_RETAIL_TAX_RULE_V1" }),
        JSON.stringify({
          treatment: "taxable",
          grossAmountBdt: 1000,
          taxAmountBdt: 0,
        }),
        JSON.stringify({
          treatment: "exempt",
          grossAmountBdt: 80,
          taxAmountBdt: 0,
        }),
        JSON.stringify([{ variantId, quantity: 1 }]),
      ],
    );
    await client.query(
      `INSERT INTO orders.order_header (
         id, reference, guest_cart_hash, guest_access_token_hash,
         guest_access_expires_at, quote_id, cart_revision, reservation_id,
         address_ciphertext, status, serviceability, fulfillment_status,
         merchandise_gross_bdt, delivery_amount_bdt, total_bdt,
         cod_amount_due_bdt, tax_snapshot, delivery_snapshot, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, now() + interval '30 days', $5, 0, $6,
         'v1.migration-fixture', 'awaiting_confirmation',
         'pending_manual_review', 'not_started', 1000, 80, 1080, 1080,
         '{}'::jsonb, '{}'::jsonb, now(), now()
       )`,
      [orderId, reference, guestHash, guestTokenHash, quoteId, reservationId],
    );
    await client.query(
      `INSERT INTO orders.order_line
         (order_id, variant_id, quantity, unit_price_bdt, gross_amount_bdt, product_snapshot)
       VALUES ($1, $2, 1, 1000, 1000, '{}'::jsonb)`,
      [orderId, variantId],
    );
    await client.query(
      `UPDATE orders.order_header
       SET status = 'confirmed', serviceability = 'serviceable',
           fulfillment_status = 'awaiting_dispatch', updated_at = clock_timestamp()
       WHERE id = $1`,
      [orderId],
    );
    await client.query(
      `INSERT INTO audit.event
         (actor_type, actor_id, event_type, subject_type, subject_id, reason, metadata)
       VALUES ('user', $1, 'commerce.cod_order_serviceability_reviewed',
         'order', $2, 'TEST_ONLY migration fixture', '{"outcome":"serviceable"}'::jsonb)`,
      [operatorId, orderId],
    );

    if (bookingStatus) {
      await client.query(
        `INSERT INTO delivery.pathao_booking (
           order_id, environment, store_id, delivery_type, parcel_quantity,
           parcel_weight_kg, merchant_order_id, command_id, request_fingerprint,
           status, consignment_id, provider_order_status, delivery_fee_bdt,
           tracking_progress, submitted_at, created_by, last_error_code
         ) VALUES (
           $1, 'sandbox', 101, 48, 1, 0.5, $2, $3, $4, $5, $6, $7, 80,
           'booked', now(), $8, $9
         )`,
        [
          orderId,
          reference,
          randomUUID(),
          hash(`booking:${reference}`),
          bookingStatus,
          bookingStatus === "booked"
            ? `PATHAO-CONSIGNMENT-${reference.slice(-3)}`
            : null,
          bookingStatus === "booked" ? "Pending" : null,
          operatorId,
          bookingStatus === "booked" ? null : "PATHAO_OUTCOME_UNKNOWN",
        ],
      );
    }

    if (options.dispatch) {
      await client.query(
        `UPDATE inventory.stock_balance
         SET quantity_on_hand = quantity_on_hand - 1,
             quantity_reserved = quantity_reserved - 1,
             updated_at = clock_timestamp()
         WHERE variant_id = $1`,
        [variantId],
      );
      await client.query(
        `UPDATE inventory.stock_reservation
         SET status = 'consumed', updated_at = clock_timestamp()
         WHERE id = $1`,
        [reservationId],
      );
      await client.query(
        `INSERT INTO inventory.reservation_command
           (command_id, reservation_id, operation, request_fingerprint)
         VALUES ($1, $2, 'consume', $3)`,
        [consumeCommandId, reservationId, dispatchFingerprint],
      );
      await client.query(
        `INSERT INTO inventory.stock_movement
           (variant_id, quantity_delta, quantity_after, reason, actor_id, command_id)
         VALUES ($1, -1, 2, 'Order dispatch migration fixture', $2, $3)`,
        [variantId, operatorId, consumeCommandId],
      );
      await client.query(
        `UPDATE orders.order_header
         SET fulfillment_status = 'dispatched', dispatch_command_id = $2,
             dispatch_request_fingerprint = $3, delivery_operator = 'AARAJ Dispatch Desk',
             handoff_reference = 'HISTORICAL-HANDOFF', dispatched_by = $4,
             dispatched_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE id = $1`,
        [orderId, consumeCommandId, dispatchFingerprint, operatorId],
      );
      await client.query(
        `INSERT INTO audit.event
           (actor_type, actor_id, event_type, subject_type, subject_id, reason, metadata)
         VALUES ('user', $1, 'commerce.cod_order_dispatched', 'order', $2,
           'TEST_ONLY migration fixture', $3::jsonb)`,
        [
          operatorId,
          orderId,
          JSON.stringify({
            commandId: consumeCommandId,
            reservationId,
            deliveryProvider: bookingStatus === "booked" ? "pathao" : "manual",
          }),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { id: orderId, reference, reservationId, variantId, bookingStatus };
}

async function readHistoricalOrders(
  pool: Pool,
): Promise<Record<string, unknown>[]> {
  return (
    await pool.query(`
      SELECT id, reference, status, serviceability, fulfillment_status,
             dispatch_command_id, dispatch_request_fingerprint, delivery_operator,
             handoff_reference, dispatched_by, dispatched_at, collection_status
      FROM orders.order_header ORDER BY reference
    `)
  ).rows;
}

async function readInventory(pool: Pool): Promise<Record<string, unknown>[]> {
  return (
    await pool.query(`
      SELECT order_header.reference, reservation.id AS reservation_id,
             reservation.status, balance.quantity_on_hand, balance.quantity_reserved
      FROM inventory.stock_reservation AS reservation
      JOIN orders.order_header AS order_header
        ON order_header.reservation_id = reservation.id
      JOIN inventory.stock_reservation_line AS line
        ON line.reservation_id = reservation.id
      JOIN inventory.stock_balance AS balance ON balance.variant_id = line.variant_id
      ORDER BY order_header.reference
    `)
  ).rows;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    (isIP(normalized) === 4 && Number(normalized.split(".")[0]) === 127)
  );
}
