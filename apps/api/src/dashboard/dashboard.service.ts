import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  DashboardOverviewSchema,
  type DashboardOverview,
  type DashboardRange,
} from "@aaraj/contracts";
import { sql, type SQLWrapper } from "drizzle-orm";
import { DatabaseService } from "../platform/database/database.service.js";

const RANGE_DAYS: Record<DashboardRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

@Injectable()
export class DashboardService {
  constructor(private readonly database: DatabaseService) {}

  async getOverview(range: DashboardRange): Promise<DashboardOverview> {
    const days = RANGE_DAYS[range];
    return this.database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
      );

      const summaryResult = await transaction.execute(sql`
          WITH settings AS (
            SELECT
              ${days}::integer AS days,
              date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka')::date AS local_today
          ), bounds AS (
            SELECT
              local_today - (days - 1) AS from_date,
              local_today AS through_date,
              (local_today - (days - 1))::timestamp AT TIME ZONE 'Asia/Dhaka' AS start_at,
              (local_today + 1)::timestamp AT TIME ZONE 'Asia/Dhaka' AS end_at
            FROM settings
          ), period_orders AS MATERIALIZED (
            SELECT order_row.status, order_row.fulfillment_status,
                   order_row.collection_status, order_row.cod_amount_due_bdt,
                   order_row.created_at
            FROM orders.order_header AS order_row
            CROSS JOIN bounds
            WHERE order_row.created_at >= bounds.start_at
              AND order_row.created_at < bounds.end_at
          ), collection_changes AS MATERIALIZED (
            SELECT event.occurred_at,
              ${codCollectionAmountChange(sql`event.metadata`)} AS amount_change
            FROM audit.event AS event
            CROSS JOIN bounds
            WHERE event.event_type = 'commerce.cod_collection_reconciled'
              AND event.subject_type = 'order'
              AND event.occurred_at >= bounds.start_at
              AND event.occurred_at < bounds.end_at
          ), period_summary AS (
            SELECT
              count(*) AS orders_placed,
              count(*) FILTER (WHERE status = 'cancelled') AS cancelled_orders,
              COALESCE(sum(cod_amount_due_bdt)
                FILTER (WHERE status <> 'cancelled'), 0) AS current_cod_value_bdt
            FROM period_orders
          ), collection_summary AS (
            SELECT count(*) AS reconciliation_changes,
                   COALESCE(sum(amount_change), 0) AS cod_reconciled_bdt
            FROM collection_changes
          ), operations_summary AS (
            SELECT
              count(*) FILTER (WHERE status IN ('pending', 'no_answer', 'on_hold')) AS awaiting_staff_action,
              count(*) FILTER (WHERE fulfillment_status = 'awaiting_dispatch') AS awaiting_dispatch,
              count(*) FILTER (WHERE fulfillment_status = 'dispatched') AS in_delivery,
              count(*) FILTER (WHERE fulfillment_status IN ('partially_delivered', 'delivery_failed', 'returned')) AS delivery_outcome_orders,
              count(*) FILTER (WHERE collection_status = 'discrepancy') AS collection_discrepancies
            FROM orders.order_header
          )
          SELECT
            bounds.from_date::text AS from_date,
            bounds.through_date::text AS through_date,
            period_summary.orders_placed::text AS orders_placed,
            period_summary.cancelled_orders::text AS cancelled_orders,
            period_summary.current_cod_value_bdt::text AS current_cod_value_bdt,
            collection_summary.cod_reconciled_bdt::text AS cod_reconciled_bdt,
            collection_summary.reconciliation_changes::text AS reconciliation_changes,
            operations_summary.awaiting_staff_action::text AS awaiting_staff_action,
            operations_summary.awaiting_dispatch::text AS awaiting_dispatch,
            operations_summary.in_delivery::text AS in_delivery,
            operations_summary.delivery_outcome_orders::text AS delivery_outcome_orders,
            operations_summary.collection_discrepancies::text AS collection_discrepancies
          FROM bounds
          CROSS JOIN period_summary
          CROSS JOIN collection_summary
          CROSS JOIN operations_summary
        `);
      const dailyResult = await transaction.execute(sql`
          WITH settings AS (
            SELECT
              ${days}::integer AS days,
              date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka')::date AS local_today
          ), bounds AS (
            SELECT
              local_today - (days - 1) AS from_date,
              local_today AS through_date,
              (local_today - (days - 1))::timestamp AT TIME ZONE 'Asia/Dhaka' AS start_at,
              (local_today + 1)::timestamp AT TIME ZONE 'Asia/Dhaka' AS end_at
            FROM settings
          ), daily_orders AS (
            SELECT
              (order_row.created_at AT TIME ZONE 'Asia/Dhaka')::date AS activity_date,
              count(*) AS orders_placed,
              COALESCE(sum(order_row.cod_amount_due_bdt)
                FILTER (WHERE order_row.status <> 'cancelled'), 0) AS current_cod_value_bdt
            FROM orders.order_header AS order_row
            CROSS JOIN bounds
            WHERE order_row.created_at >= bounds.start_at
              AND order_row.created_at < bounds.end_at
            GROUP BY 1
          ), daily_collections AS (
            SELECT
              (event.occurred_at AT TIME ZONE 'Asia/Dhaka')::date AS activity_date,
              sum(${codCollectionAmountChange(sql`event.metadata`)}) AS cod_reconciled_bdt
            FROM audit.event AS event
            CROSS JOIN bounds
            WHERE event.event_type = 'commerce.cod_collection_reconciled'
              AND event.subject_type = 'order'
              AND event.occurred_at >= bounds.start_at
              AND event.occurred_at < bounds.end_at
            GROUP BY 1
          )
          SELECT
            days.activity_date::date::text AS date,
            COALESCE(daily_orders.orders_placed, 0)::text AS orders_placed,
            COALESCE(daily_orders.current_cod_value_bdt, 0)::text AS current_cod_value_bdt,
            COALESCE(daily_collections.cod_reconciled_bdt, 0)::text AS cod_reconciled_bdt
          FROM bounds
          CROSS JOIN LATERAL generate_series(
            bounds.from_date::timestamp,
            bounds.through_date::timestamp,
            interval '1 day'
          ) AS days(activity_date)
          LEFT JOIN daily_orders ON daily_orders.activity_date = days.activity_date::date
          LEFT JOIN daily_collections ON daily_collections.activity_date = days.activity_date::date
          ORDER BY days.activity_date
        `);
      const productResult = await transaction.execute(sql`
          WITH bounds AS (
            SELECT
              (date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka')::date
                - (${days}::integer - 1))::timestamp AT TIME ZONE 'Asia/Dhaka' AS start_at,
              (date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka')::date
                + 1)::timestamp AT TIME ZONE 'Asia/Dhaka' AS end_at
          )
          SELECT
            line.product_snapshot->>'productName' AS product_name,
            line.product_snapshot->>'color' AS color,
            line.product_snapshot->>'sizeLabel' AS size_label,
            sum(line.quantity)::text AS ordered_units
          FROM orders.order_line AS line
          JOIN orders.order_header AS order_row ON order_row.id = line.order_id
          CROSS JOIN bounds
          WHERE order_row.created_at >= bounds.start_at
            AND order_row.created_at < bounds.end_at
            AND order_row.status <> 'cancelled'
          GROUP BY 1, 2, 3
          ORDER BY sum(line.quantity) DESC, product_name, color, size_label
          LIMIT 5
        `);

      const summary = summaryResult.rows[0] as
        Record<string, unknown> | undefined;
      if (!summary) throw dashboardUnavailable();

      const result = {
        range,
        timezone: "Asia/Dhaka",
        from: String(summary.from_date),
        through: String(summary.through_date),
        summary: {
          ordersPlaced: nonnegativeMetric(summary.orders_placed),
          cancelledOrders: nonnegativeMetric(summary.cancelled_orders),
          currentCodValueBdt: nonnegativeMetric(summary.current_cod_value_bdt),
          codReconciledBdt: metricSignedAmount(summary.cod_reconciled_bdt),
          reconciliationChanges: nonnegativeMetric(
            summary.reconciliation_changes,
          ),
        },
        operations: {
          awaitingStaffAction: nonnegativeMetric(summary.awaiting_staff_action),
          awaitingDispatch: nonnegativeMetric(summary.awaiting_dispatch),
          inDelivery: nonnegativeMetric(summary.in_delivery),
          deliveryOutcomeOrders: nonnegativeMetric(
            summary.delivery_outcome_orders,
          ),
          collectionDiscrepancies: nonnegativeMetric(
            summary.collection_discrepancies,
          ),
        },
        daily: dailyResult.rows.map((row) => {
          const day = row as Record<string, unknown>;
          return {
            date: String(day.date),
            ordersPlaced: nonnegativeMetric(day.orders_placed),
            currentCodValueBdt: nonnegativeMetric(day.current_cod_value_bdt),
            codReconciledBdt: metricSignedAmount(day.cod_reconciled_bdt),
          };
        }),
        topProducts: productResult.rows.map((row) => {
          const product = row as Record<string, unknown>;
          return {
            productName:
              typeof product.product_name === "string" &&
              product.product_name.length > 0
                ? product.product_name
                : "Product",
            color: nullableString(product.color),
            sizeLabel: nullableString(product.size_label),
            orderedUnits: nonnegativeMetric(product.ordered_units),
          };
        }),
      };
      const parsed = DashboardOverviewSchema.safeParse(result);
      if (!parsed.success) throw dashboardUnavailable();
      return parsed.data;
    });
  }
}

function nonnegativeMetric(value: unknown): number {
  return safeMetricNumber(value, true);
}

function metricSignedAmount(value: unknown): number {
  return safeMetricNumber(value, false);
}

function safeMetricNumber(value: unknown, nonnegative: boolean): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || (nonnegative && amount < 0)) {
    throw dashboardUnavailable();
  }
  return amount;
}

function codCollectionAmountChange(metadata: SQLWrapper) {
  return sql`
    CASE
      WHEN ${metadata}->>'collectedAmountBdt' ~ '^[0-9]+$'
        AND (${metadata}->>'previousCollectedAmountBdt' IS NULL
          OR ${metadata}->>'previousCollectedAmountBdt' ~ '^[0-9]+$')
      THEN (${metadata}->>'collectedAmountBdt')::numeric
        - COALESCE((${metadata}->>'previousCollectedAmountBdt')::numeric, 0)
      ELSE 0
    END
  `;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function dashboardUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "Dashboard metrics are temporarily unavailable.",
    { errorCode: "DASHBOARD_METRICS_UNAVAILABLE" },
  );
}
