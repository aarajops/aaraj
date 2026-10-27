import type { CatalogMeasurementKey, CatalogSizeGuide } from "@aaraj/contracts";
import { asc, eq, inArray } from "drizzle-orm";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import {
  catalogSizeGuide,
  catalogSizeGuideMeasurement,
  catalogSizeGuideRow,
} from "./catalog-schema.js";
import { loadCategoryReference } from "./catalog-category.helpers.js";

export async function loadCatalogSizeGuide(
  transaction: AuditTransaction,
  guide: typeof catalogSizeGuide.$inferSelect,
): Promise<CatalogSizeGuide> {
  const rows = await transaction
    .select()
    .from(catalogSizeGuideRow)
    .where(eq(catalogSizeGuideRow.guideId, guide.id))
    .orderBy(asc(catalogSizeGuideRow.sortOrder));
  const measurements = rows.length
    ? await transaction
        .select()
        .from(catalogSizeGuideMeasurement)
        .where(
          inArray(
            catalogSizeGuideMeasurement.rowId,
            rows.map(({ id }) => id),
          ),
        )
        .orderBy(asc(catalogSizeGuideMeasurement.key))
    : [];
  const measurementsByRow = new Map<
    string,
    Array<{ key: CatalogMeasurementKey; valueIn: string }>
  >();
  for (const measurement of measurements) {
    const values = measurementsByRow.get(measurement.rowId) ?? [];
    values.push({ key: measurement.key, valueIn: measurement.valueIn });
    measurementsByRow.set(measurement.rowId, values);
  }
  const category = await loadCategoryReference(transaction, guide.categoryId);

  return {
    id: guide.id,
    name: guide.name,
    category,
    fit: guide.fit,
    measurementBasis: guide.measurementBasis,
    rows: rows.map((row) => ({
      id: row.id,
      sizeLabel: row.sizeLabel,
      sortOrder: row.sortOrder,
      measurements: measurementsByRow.get(row.id) ?? [],
    })),
    createdAt: guide.createdAt.toISOString(),
    updatedAt: guide.updatedAt.toISOString(),
  };
}
