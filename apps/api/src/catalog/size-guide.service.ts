import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import type {
  CatalogMeasurementKey,
  CatalogMeasurementUnit,
  CatalogSizeGuide,
  CatalogSizeGuideCreateInput,
  CatalogSizeGuideListQuery,
  CatalogSizeGuidePage,
  CatalogSizeGuideUpdateInput,
} from "@aaraj/contracts";
import { MAX_LIST_OFFSET } from "@aaraj/contracts";
import { and, asc, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import {
  catalogProduct,
  catalogProductVariant,
  catalogCategory,
  catalogSizeGuide,
  catalogSizeGuideMeasurement,
  catalogSizeGuideRow,
} from "./catalog-schema.js";
import { CatalogPolicy } from "./catalog.policy.js";
import {
  loadCategoryReference,
  loadCategoryReferences,
  requireActiveLeafCategory,
} from "./catalog-category.helpers.js";

@Injectable()
export class SizeGuideService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async listForManagement(
    actor: AccessPrincipal,
    query: CatalogSizeGuideListQuery,
  ): Promise<CatalogSizeGuidePage> {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    const predicates = [];
    if (query.categoryId) {
      predicates.push(eq(catalogSizeGuide.categoryId, query.categoryId));
    }
    if (query.fit) {
      predicates.push(
        sql`lower(${catalogSizeGuide.fit}) = lower(${query.fit})`,
      );
    }
    if (query.measurementBasis) {
      predicates.push(
        eq(catalogSizeGuide.measurementBasis, query.measurementBasis),
      );
    }
    if (query.search) {
      const searchPattern = `%${escapeLikeWildcards(query.search)}%`;
      predicates.push(
        or(
          ilike(catalogSizeGuide.name, searchPattern),
          ilike(catalogSizeGuide.fit, searchPattern),
          exists(
            this.database.db
              .select({ id: catalogCategory.id })
              .from(catalogCategory)
              .where(
                and(
                  eq(catalogCategory.id, catalogSizeGuide.categoryId),
                  ilike(catalogCategory.name, searchPattern),
                ),
              ),
          ),
          exists(
            this.database.db
              .select({ id: catalogSizeGuideRow.id })
              .from(catalogSizeGuideRow)
              .where(
                and(
                  eq(catalogSizeGuideRow.guideId, catalogSizeGuide.id),
                  ilike(catalogSizeGuideRow.sizeLabel, searchPattern),
                ),
              ),
          ),
        ),
      );
    }

    const rows = await this.database.db
      .select()
      .from(catalogSizeGuide)
      .where(predicates.length ? and(...predicates) : undefined)
      .orderBy(desc(catalogSizeGuide.updatedAt), desc(catalogSizeGuide.id))
      .limit(query.limit + 1)
      .offset(query.offset);
    const hasMore = rows.length > query.limit;
    const selected = rows.slice(0, query.limit);
    const rowIds = selected.map(({ id }) => id);
    const sizeRows = rowIds.length
      ? await this.database.db
          .select()
          .from(catalogSizeGuideRow)
          .where(inArray(catalogSizeGuideRow.guideId, rowIds))
          .orderBy(asc(catalogSizeGuideRow.sortOrder))
      : [];
    const rowsByGuide = new Map<string, string[]>();
    for (const sizeRow of sizeRows) {
      const labels = rowsByGuide.get(sizeRow.guideId) ?? [];
      labels.push(sizeRow.sizeLabel);
      rowsByGuide.set(sizeRow.guideId, labels);
    }
    const categoryReferences = await loadCategoryReferences(
      this.database.db,
      selected.map(({ categoryId }) => categoryId),
    );
    const candidateNextOffset = query.offset + selected.length;

    return {
      guides: selected.map((guide) => ({
        id: guide.id,
        name: guide.name,
        category: categoryReferences.get(guide.categoryId)!,
        fit: guide.fit,
        measurementBasis: guide.measurementBasis,
        sizeLabels: rowsByGuide.get(guide.id) ?? [],
        updatedAt: guide.updatedAt.toISOString(),
      })),
      hasMore,
      nextOffset:
        hasMore && candidateNextOffset <= MAX_LIST_OFFSET
          ? candidateNextOffset
          : null,
    };
  }

  async findForManagement(
    actor: AccessPrincipal,
    guideId: string,
  ): Promise<CatalogSizeGuide> {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    return this.database.db.transaction(async (transaction) => {
      const [guide] = await transaction
        .select()
        .from(catalogSizeGuide)
        .where(eq(catalogSizeGuide.id, guideId))
        .limit(1);
      if (!guide) throw new NotFoundException("Size guide not found");
      return loadSizeGuide(transaction, guide);
    });
  }

  async create(actor: AccessPrincipal, input: CatalogSizeGuideCreateInput) {
    const measurements = normalizeMeasurements(input.inputUnit, input.rows);
    return this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      try {
        await requireActiveLeafCategory(transaction, input.categoryId);
        const [guide] = await transaction
          .insert(catalogSizeGuide)
          .values({
            name: input.name,
            categoryId: input.categoryId,
            fit: input.fit ?? null,
            measurementBasis: input.measurementBasis,
          })
          .returning();
        if (!guide) throw new Error("Size guide insert returned no row.");
        await replaceSizeGuideRows(
          transaction,
          guide.id,
          input.rows,
          measurements,
        );
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "catalog.size_guide_created",
          subjectType: "catalog_size_guide",
          subjectId: guide.id,
          reason: input.reason,
          metadata: {
            categoryId: guide.categoryId,
            measurementBasis: guide.measurementBasis,
            sizeCount: input.rows.length,
          },
        });
        return loadSizeGuide(transaction, guide);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            "The size guide contains duplicate labels.",
          );
        }
        throw error;
      }
    });
  }

  async update(
    actor: AccessPrincipal,
    guideId: string,
    input: CatalogSizeGuideUpdateInput,
  ) {
    const measurements = normalizeMeasurements(input.inputUnit, input.rows);
    return this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      const [current] = await transaction
        .select()
        .from(catalogSizeGuide)
        .where(eq(catalogSizeGuide.id, guideId))
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundException("Size guide not found");
      await requireActiveLeafCategory(transaction, input.categoryId);

      const [updated] = await transaction
        .update(catalogSizeGuide)
        .set({
          name: input.name,
          categoryId: input.categoryId,
          fit: input.fit ?? null,
          measurementBasis: input.measurementBasis,
          updatedAt: new Date(),
        })
        .where(eq(catalogSizeGuide.id, guideId))
        .returning();
      if (!updated) throw new NotFoundException("Size guide not found");

      try {
        await replaceSizeGuideRows(
          transaction,
          guideId,
          input.rows,
          measurements,
        );
        await ensurePublishedProductsRemainValid(
          transaction,
          updated,
          input.rows,
        );
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "catalog.size_guide_updated",
          subjectType: "catalog_size_guide",
          subjectId: guideId,
          reason: input.reason,
          metadata: {
            categoryId: updated.categoryId,
            measurementBasis: updated.measurementBasis,
            sizeCount: input.rows.length,
          },
        });
        return loadSizeGuide(transaction, updated);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            "The size guide contains duplicate labels.",
          );
        }
        throw error;
      }
    });
  }
}

async function replaceSizeGuideRows(
  transaction: AuditTransaction,
  guideId: string,
  inputRows: CatalogSizeGuideCreateInput["rows"],
  values: string[][],
) {
  await transaction
    .delete(catalogSizeGuideRow)
    .where(eq(catalogSizeGuideRow.guideId, guideId));
  const insertedRows = await transaction
    .insert(catalogSizeGuideRow)
    .values(
      inputRows.map((row, sortOrder) => ({
        guideId,
        sizeLabel: row.sizeLabel,
        sortOrder,
      })),
    )
    .returning({
      id: catalogSizeGuideRow.id,
      sortOrder: catalogSizeGuideRow.sortOrder,
    });
  if (insertedRows.length !== inputRows.length) {
    throw new Error("Size guide rows did not all insert.");
  }
  const measurements = insertedRows.flatMap(({ id, sortOrder }) =>
    (inputRows[sortOrder]?.measurements ?? []).map((measurement, index) => ({
      rowId: id,
      key: measurement.key,
      valueMm: values[sortOrder]?.[index] ?? "0.00",
    })),
  );
  if (measurements.length) {
    await transaction.insert(catalogSizeGuideMeasurement).values(measurements);
  }
}

async function loadSizeGuide(
  database: AuditTransaction,
  guide: typeof catalogSizeGuide.$inferSelect,
): Promise<CatalogSizeGuide> {
  const rows = await database
    .select()
    .from(catalogSizeGuideRow)
    .where(eq(catalogSizeGuideRow.guideId, guide.id))
    .orderBy(asc(catalogSizeGuideRow.sortOrder));
  const measurements = rows.length
    ? await database
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
    Array<{ key: CatalogMeasurementKey; valueMm: string }>
  >();
  for (const measurement of measurements) {
    const values = measurementsByRow.get(measurement.rowId) ?? [];
    values.push({ key: measurement.key, valueMm: measurement.valueMm });
    measurementsByRow.set(measurement.rowId, values);
  }
  const category = await loadCategoryReference(database, guide.categoryId);

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

async function ensurePublishedProductsRemainValid(
  transaction: AuditTransaction,
  guide: typeof catalogSizeGuide.$inferSelect,
  guideRows: CatalogSizeGuideCreateInput["rows"],
) {
  const products = await transaction
    .select()
    .from(catalogProduct)
    .where(
      and(
        eq(catalogProduct.sizeGuideId, guide.id),
        eq(catalogProduct.isPublished, true),
      ),
    );
  const allowedSizes = new Set(
    guideRows.map(({ sizeLabel }) => normalize(sizeLabel)),
  );
  for (const product of products) {
    if (
      product.categoryId !== guide.categoryId ||
      normalizeOptional(product.fit) !== normalizeOptional(guide.fit)
    ) {
      throw new BadRequestException(
        `The updated guide no longer matches published product ${product.slug}.`,
      );
    }
    const variants = await transaction
      .select({ sizeLabel: catalogProductVariant.sizeLabel })
      .from(catalogProductVariant)
      .where(
        and(
          eq(catalogProductVariant.productId, product.id),
          eq(catalogProductVariant.isActive, true),
        ),
      );
    if (
      variants.some(({ sizeLabel }) => !allowedSizes.has(normalize(sizeLabel)))
    ) {
      throw new BadRequestException(
        `The updated guide must include every active size on published product ${product.slug}.`,
      );
    }
  }
}

function normalizeMeasurements(
  unit: CatalogMeasurementUnit,
  rows: CatalogSizeGuideCreateInput["rows"],
): string[][] {
  return rows.map((row) =>
    row.measurements.map(({ value }) => toMillimeters(unit, value)),
  );
}

function toMillimeters(unit: CatalogMeasurementUnit, value: string): string {
  const [wholePart, fractionPart = ""] = value.split(".");
  const valueThousandths =
    BigInt(wholePart ?? "0") * 1000n + BigInt(fractionPart.padEnd(3, "0"));
  const millimeterHundredths =
    unit === "cm" ? valueThousandths : (valueThousandths * 254n + 50n) / 100n;
  if (millimeterHundredths <= 0n || millimeterHundredths > 99_999_999n) {
    throw new BadRequestException(
      "Measurements must fit a positive numeric(8,2) millimetre value.",
    );
  }
  const whole = millimeterHundredths / 100n;
  const fraction = String(millimeterHundredths % 100n).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function normalizeOptional(value: string | null): string | null {
  return value === null ? null : normalize(value);
}

function isUniqueViolation(error: unknown): boolean {
  return postgresError(error)?.code === "23505";
}

function postgresError(error: unknown): { code?: unknown } | null {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    if ("code" in current) return current;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}
