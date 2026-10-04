import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import type {
  CatalogProduct,
  CatalogProductCreateInput,
  CatalogProductDetail,
  CatalogManagedProductDetail,
  CatalogProductListQuery,
  CatalogProductPage,
  CatalogProductFilterOptions,
  CatalogPublishedProductListQuery,
  CatalogPublishedProductPage,
  CatalogProductUpdateInput,
  CatalogProductVariantInput,
  CatalogCategoryReference,
} from "@aaraj/contracts";
import { MAX_LIST_OFFSET } from "@aaraj/contracts";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import {
  catalogProduct,
  catalogProductVariant,
  catalogCategory,
  catalogSizeGuide,
  catalogSizeGuideMeasurement,
  catalogSizeGuideRow,
} from "./catalog-schema.js";
import { CatalogPolicy } from "./catalog.policy.js";
import { CategoryService } from "./category.service.js";
import {
  loadCategoryReference,
  loadCategoryReferences,
  requireActiveLeafCategory,
} from "./catalog-category.helpers.js";

@Injectable()
export class CatalogService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly categories: CategoryService,
  ) {}

  async listPublished(
    query: CatalogPublishedProductListQuery,
  ): Promise<CatalogPublishedProductPage> {
    const conditions = [eq(catalogProduct.isPublished, true)];
    if (query.audience) {
      conditions.push(eq(catalogProduct.audience, query.audience));
    }
    if (query.category) {
      const categoryIds = await this.getCategorySubtreeIds(query.category);
      conditions.push(
        categoryIds.length
          ? inArray(catalogProduct.categoryId, categoryIds)
          : sql`false`,
      );
    }

    if (query.color || query.size) {
      const variantConditions = [
        eq(catalogProductVariant.productId, catalogProduct.id),
        eq(catalogProductVariant.isActive, true),
      ];
      if (query.color) {
        variantConditions.push(
          eq(
            sql<string>`lower(btrim(${catalogProductVariant.color}))`,
            normalize(query.color),
          ),
        );
      }
      if (query.size) {
        variantConditions.push(
          eq(
            sql<string>`lower(btrim(${catalogProductVariant.sizeLabel}))`,
            normalize(query.size),
          ),
        );
      }
      conditions.push(
        exists(
          this.database.db
            .select({ id: catalogProductVariant.id })
            .from(catalogProductVariant)
            .where(and(...variantConditions)),
        ),
      );
    }

    const [rows, filterOptions] = await Promise.all([
      this.database.db
        .select()
        .from(catalogProduct)
        .where(and(...conditions))
        .orderBy(desc(catalogProduct.updatedAt), desc(catalogProduct.id))
        .limit(query.limit + 1)
        .offset(query.offset),
      this.getPublishedProductFilterOptions(),
    ]);

    const categoryReferences = await loadCategoryReferences(
      this.database.db,
      rows.slice(0, query.limit).map(({ categoryId }) => categoryId),
    );
    return {
      ...toProductPage(rows, query, categoryReferences),
      filters: filterOptions,
    };
  }

  private async getCategorySubtreeIds(slug: string): Promise<string[]> {
    const categories = await this.database.db
      .select({
        id: catalogCategory.id,
        slug: catalogCategory.slug,
        parentId: catalogCategory.parentId,
      })
      .from(catalogCategory)
      .where(eq(catalogCategory.isActive, true));
    const root = categories.find((category) => category.slug === slug);
    if (!root) return [];
    const ids = new Set([root.id]);
    const categoriesById = new Map(
      categories.map((category) => [category.id, category]),
    );
    for (const category of categories) {
      let parentId = category.parentId;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        if (parentId === root.id) {
          ids.add(category.id);
          break;
        }
        visited.add(parentId);
        parentId = categoriesById.get(parentId)?.parentId ?? null;
      }
    }
    return [...ids];
  }

  private async getPublishedProductFilterOptions(): Promise<CatalogProductFilterOptions> {
    const [productValues, variantValues, categoryOptions] = await Promise.all([
      this.database.db
        .selectDistinct({
          categoryId: catalogProduct.categoryId,
        })
        .from(catalogProduct)
        .where(
          and(
            eq(catalogProduct.isPublished, true),
            isNotNull(catalogProduct.categoryId),
          ),
        ),
      this.database.db
        .selectDistinct({
          color: catalogProductVariant.color,
          size: catalogProductVariant.sizeLabel,
        })
        .from(catalogProductVariant)
        .innerJoin(
          catalogProduct,
          eq(catalogProductVariant.productId, catalogProduct.id),
        )
        .where(
          and(
            eq(catalogProduct.isPublished, true),
            eq(catalogProductVariant.isActive, true),
          ),
        ),
      this.categories.listPublic(),
    ]);

    const categoriesById = new Map(
      categoryOptions.categories.map((category) => [category.id, category]),
    );
    const visibleCategoryIds = new Set<string>();
    for (const { categoryId } of productValues) {
      let currentId = categoryId;
      while (currentId && !visibleCategoryIds.has(currentId)) {
        visibleCategoryIds.add(currentId);
        currentId = categoriesById.get(currentId)?.parentId ?? null;
      }
    }

    return {
      categories: categoryOptions.categories.filter(({ id }) =>
        visibleCategoryIds.has(id),
      ),
      colors: uniqueFilterValues(variantValues.map(({ color }) => color)),
      sizes: uniqueFilterValues(variantValues.map(({ size }) => size)),
    };
  }

  async findPublished(slug: string): Promise<CatalogProductDetail> {
    return this.database.db.transaction(async (transaction) => {
      const [product] = await transaction
        .select()
        .from(catalogProduct)
        .where(
          and(
            eq(catalogProduct.slug, slug),
            eq(catalogProduct.isPublished, true),
          ),
        )
        .limit(1);
      if (!product) throw new NotFoundException("Product not found");
      const detail = await loadProductDetail(transaction, product);
      return {
        ...detail,
        variants: detail.variants.map(({ id, color, sizeLabel }) => ({
          id,
          color,
          sizeLabel,
        })),
        sizeGuide: detail.sizeGuide,
      } satisfies CatalogProductDetail;
    });
  }

  async listForManagement(
    actor: AccessPrincipal,
    query: CatalogProductListQuery,
  ): Promise<CatalogProductPage> {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    const rows = await this.database.db
      .select()
      .from(catalogProduct)
      .orderBy(desc(catalogProduct.updatedAt), desc(catalogProduct.id))
      .limit(query.limit + 1)
      .offset(query.offset);
    const categoryReferences = await loadCategoryReferences(
      this.database.db,
      rows.slice(0, query.limit).map(({ categoryId }) => categoryId),
    );
    return toProductPage(rows, query, categoryReferences);
  }

  async findForManagement(
    actor: AccessPrincipal,
    productId: string,
  ): Promise<CatalogManagedProductDetail> {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    return this.database.db.transaction(async (transaction) => {
      const [product] = await transaction
        .select()
        .from(catalogProduct)
        .where(eq(catalogProduct.id, productId))
        .limit(1);
      if (!product) throw new NotFoundException("Product not found");
      return loadProductDetail(transaction, product);
    });
  }

  async create(actor: AccessPrincipal, input: CatalogProductCreateInput) {
    return this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      try {
        const variants = input.variants ?? [];
        const values = toProductPersistenceValues(input);
        if (values.categoryId) {
          await requireActiveLeafCategory(transaction, values.categoryId);
        }
        if (input.isPublished) {
          await validatePublishability(transaction, values, variants);
        } else if (values.sizeGuideId) {
          await requireSizeGuide(transaction, values.sizeGuideId, false);
        }

        const [product] = await transaction
          .insert(catalogProduct)
          .values({
            ...values,
            isPublished: input.isPublished ?? false,
          })
          .returning();
        if (!product) throw new Error("Product insert returned no row.");
        if (variants.length)
          await insertVariants(transaction, product.id, variants);
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "catalog.product_created",
          subjectType: "catalog_product",
          subjectId: product.id,
          reason: input.reason,
          metadata: {
            slug: product.slug,
            isPublished: product.isPublished,
            variantCount: variants.length,
          },
        });
        const category = product.categoryId
          ? await loadCategoryReference(transaction, product.categoryId)
          : null;
        return toCatalogProduct(product, category);
      } catch (error) {
        if (isUniqueViolation(error)) throw uniqueConflict(error);
        throw error;
      }
    });
  }

  async update(
    actor: AccessPrincipal,
    productId: string,
    input: CatalogProductUpdateInput,
  ) {
    return this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      const [current] = await transaction
        .select()
        .from(catalogProduct)
        .where(eq(catalogProduct.id, productId))
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundException("Product not found");

      const currentVariants = await transaction
        .select()
        .from(catalogProductVariant)
        .where(
          and(
            eq(catalogProductVariant.productId, productId),
            eq(catalogProductVariant.isActive, true),
          ),
        );
      const nextValues = {
        slug: input.slug ?? current.slug,
        name: input.name ?? current.name,
        description:
          input.description !== undefined
            ? input.description
            : current.description,
        audience:
          input.audience !== undefined ? input.audience : current.audience,
        categoryId:
          input.categoryId !== undefined
            ? input.categoryId
            : current.categoryId,
        fit: input.fit !== undefined ? input.fit : current.fit,
        fabricComposition:
          input.fabricComposition !== undefined
            ? input.fabricComposition
            : current.fabricComposition,
        careInstructions:
          input.careInstructions !== undefined
            ? input.careInstructions
            : current.careInstructions,
        sizeGuideId:
          input.sizeGuideId !== undefined
            ? input.sizeGuideId
            : current.sizeGuideId,
      };
      const nextIsPublished = input.isPublished ?? current.isPublished;
      const variants =
        input.variants ??
        currentVariants.map((variant) => ({
          sku: variant.sku,
          color: variant.color,
          sizeLabel: variant.sizeLabel,
          gtin: variant.gtin,
        }));

      try {
        if (nextValues.categoryId) {
          await requireActiveLeafCategory(transaction, nextValues.categoryId);
        }
        if (nextIsPublished) {
          await validatePublishability(transaction, nextValues, variants);
        } else if (nextValues.sizeGuideId) {
          await requireSizeGuide(transaction, nextValues.sizeGuideId, false);
        }

        const changes = {
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.audience !== undefined ? { audience: input.audience } : {}),
          ...(input.categoryId !== undefined
            ? { categoryId: input.categoryId }
            : {}),
          ...(input.fit !== undefined ? { fit: input.fit } : {}),
          ...(input.fabricComposition !== undefined
            ? { fabricComposition: input.fabricComposition }
            : {}),
          ...(input.careInstructions !== undefined
            ? { careInstructions: input.careInstructions }
            : {}),
          ...(input.sizeGuideId !== undefined
            ? { sizeGuideId: input.sizeGuideId }
            : {}),
          ...(input.isPublished !== undefined
            ? { isPublished: input.isPublished }
            : {}),
          updatedAt: new Date(),
        };
        const [product] = await transaction
          .update(catalogProduct)
          .set(changes)
          .where(eq(catalogProduct.id, productId))
          .returning();
        if (!product) throw new NotFoundException("Product not found");
        if (input.variants !== undefined) {
          await reconcileVariants(transaction, productId, input.variants);
        }
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "catalog.product_updated",
          subjectType: "catalog_product",
          subjectId: product.id,
          reason: input.reason,
          metadata: {
            changedFields: [
              ...Object.keys(changes).filter((key) => key !== "updatedAt"),
              ...(input.variants !== undefined ? ["variants"] : []),
            ],
          },
        });
        const category = product.categoryId
          ? await loadCategoryReference(transaction, product.categoryId)
          : null;
        return toCatalogProduct(product, category);
      } catch (error) {
        if (isUniqueViolation(error)) throw uniqueConflict(error);
        throw error;
      }
    });
  }
}

async function validatePublishability(
  transaction: AuditTransaction,
  product: {
    audience: "men" | "women" | "unisex" | null;
    categoryId: string | null;
    fit: string | null;
    sizeGuideId: string | null;
  },
  variants: CatalogProductVariantInput[],
) {
  if (!product.audience) {
    throw new BadRequestException(
      "Choose a product audience before publishing.",
    );
  }
  if (!product.categoryId) {
    throw new BadRequestException(
      "Choose a product category before publishing.",
    );
  }
  if (!variants.length) {
    throw new BadRequestException(
      "Add at least one sellable color and size variant before publishing.",
    );
  }
  if (!product.sizeGuideId) {
    throw new BadRequestException(
      "Assign a matching size guide before publishing this apparel product.",
    );
  }

  const guide = await requireSizeGuide(transaction, product.sizeGuideId, true);
  if (
    product.categoryId !== guide.categoryId ||
    normalizeOptional(product.fit) !== normalizeOptional(guide.fit)
  ) {
    throw new BadRequestException(
      "Select a size guide that matches the product category and fit.",
    );
  }
  const rows = await transaction
    .select({ sizeLabel: catalogSizeGuideRow.sizeLabel })
    .from(catalogSizeGuideRow)
    .where(eq(catalogSizeGuideRow.guideId, guide.id));
  const guideSizes = new Set(rows.map(({ sizeLabel }) => normalize(sizeLabel)));
  if (variants.some(({ sizeLabel }) => !guideSizes.has(normalize(sizeLabel)))) {
    throw new BadRequestException(
      "Every active variant size must appear in the assigned size guide.",
    );
  }
}

async function requireSizeGuide(
  transaction: AuditTransaction,
  guideId: string,
  lock: boolean,
) {
  const query = transaction
    .select()
    .from(catalogSizeGuide)
    .where(eq(catalogSizeGuide.id, guideId));
  const [guide] = lock
    ? await query.for("update").limit(1)
    : await query.limit(1);
  if (!guide) throw new NotFoundException("Size guide not found");
  return guide;
}

async function insertVariants(
  transaction: AuditTransaction,
  productId: string,
  variants: CatalogProductVariantInput[],
) {
  await transaction.insert(catalogProductVariant).values(
    variants.map((variant) => ({
      productId,
      sku: variant.sku,
      color: variant.color,
      sizeLabel: variant.sizeLabel,
      gtin: variant.gtin ?? null,
      isActive: true,
    })),
  );
}

async function reconcileVariants(
  transaction: AuditTransaction,
  productId: string,
  desired: CatalogProductVariantInput[],
) {
  const existing = await transaction
    .select()
    .from(catalogProductVariant)
    .where(eq(catalogProductVariant.productId, productId));
  const byCombination = new Map(
    existing.map((variant) => [
      combinationKey(variant.color, variant.sizeLabel),
      variant,
    ]),
  );
  const desiredIds = new Set<string>();

  for (const variant of desired) {
    const match = byCombination.get(
      combinationKey(variant.color, variant.sizeLabel),
    );
    if (match) {
      desiredIds.add(match.id);
      await transaction
        .update(catalogProductVariant)
        .set({
          sku: variant.sku,
          color: variant.color,
          sizeLabel: variant.sizeLabel,
          gtin: variant.gtin ?? null,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(catalogProductVariant.id, match.id));
    } else {
      const [inserted] = await transaction
        .insert(catalogProductVariant)
        .values({
          productId,
          sku: variant.sku,
          color: variant.color,
          sizeLabel: variant.sizeLabel,
          gtin: variant.gtin ?? null,
          isActive: true,
        })
        .returning({ id: catalogProductVariant.id });
      if (!inserted) throw new Error("Product variant insert returned no row.");
      desiredIds.add(inserted.id);
    }
  }

  const removed = existing.filter((variant) => !desiredIds.has(variant.id));
  if (removed.length) {
    await transaction
      .update(catalogProductVariant)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        inArray(
          catalogProductVariant.id,
          removed.map(({ id }) => id),
        ),
      );
  }
}

async function loadProductDetail(
  transaction: AuditTransaction,
  product: typeof catalogProduct.$inferSelect,
): Promise<CatalogManagedProductDetail> {
  const variants = await transaction
    .select()
    .from(catalogProductVariant)
    .where(
      and(
        eq(catalogProductVariant.productId, product.id),
        eq(catalogProductVariant.isActive, true),
      ),
    )
    .orderBy(
      asc(catalogProductVariant.color),
      asc(catalogProductVariant.sizeLabel),
    );
  const sizeGuide = product.sizeGuideId
    ? await loadSizeGuideDetail(transaction, product.sizeGuideId)
    : null;

  return {
    ...toCatalogProduct(
      product,
      product.categoryId
        ? await loadCategoryReference(transaction, product.categoryId)
        : null,
    ),
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      color: variant.color,
      sizeLabel: variant.sizeLabel,
      gtin: variant.gtin,
      isActive: variant.isActive,
    })),
    sizeGuide,
  };
}

async function loadSizeGuideDetail(
  transaction: AuditTransaction,
  guideId: string,
) {
  const [guide] = await transaction
    .select()
    .from(catalogSizeGuide)
    .where(eq(catalogSizeGuide.id, guideId))
    .limit(1);
  if (!guide) return null;
  const category = await loadCategoryReference(transaction, guide.categoryId);
  const rows = await transaction
    .select()
    .from(catalogSizeGuideRow)
    .where(eq(catalogSizeGuideRow.guideId, guideId))
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
    Array<{ key: (typeof measurements)[number]["key"]; valueMm: string }>
  >();
  for (const measurement of measurements) {
    const values = measurementsByRow.get(measurement.rowId) ?? [];
    values.push({ key: measurement.key, valueMm: measurement.valueMm });
    measurementsByRow.set(measurement.rowId, values);
  }
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

function toProductPage(
  rows: (typeof catalogProduct.$inferSelect)[],
  query: CatalogProductListQuery,
  categories: Map<string, CatalogCategoryReference>,
): CatalogProductPage {
  const hasMore = rows.length > query.limit;
  const products = rows
    .slice(0, query.limit)
    .map((product) =>
      toCatalogProduct(
        product,
        product.categoryId
          ? (categories.get(product.categoryId) ?? null)
          : null,
      ),
    );
  const candidateNextOffset = query.offset + products.length;
  return {
    products,
    hasMore,
    nextOffset:
      hasMore && candidateNextOffset <= MAX_LIST_OFFSET
        ? candidateNextOffset
        : null,
  };
}

function toCatalogProduct(
  product: typeof catalogProduct.$inferSelect,
  category: CatalogCategoryReference | null,
): CatalogProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    audience: product.audience,
    category,
    fit: product.fit,
    fabricComposition: product.fabricComposition,
    careInstructions: product.careInstructions,
    sizeGuideId: product.sizeGuideId,
    isPublished: product.isPublished,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function toProductPersistenceValues(input: CatalogProductCreateInput): {
  slug: string;
  name: string;
  description: string | null;
  audience: "men" | "women" | "unisex";
  categoryId: string | null;
  fit: string | null;
  fabricComposition: string | null;
  careInstructions: string | null;
  sizeGuideId: string | null;
} {
  return {
    slug: input.slug,
    name: input.name,
    description: input.description ?? null,
    audience: input.audience,
    categoryId: input.categoryId ?? null,
    fit: input.fit ?? null,
    fabricComposition: input.fabricComposition ?? null,
    careInstructions: input.careInstructions ?? null,
    sizeGuideId: input.sizeGuideId ?? null,
  };
}

function combinationKey(color: string, sizeLabel: string): string {
  return `${normalize(color)}\u0000${normalize(sizeLabel)}`;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function uniqueFilterValues(values: (string | null)[]): string[] {
  const unique = new Map<string, string>();
  const candidates = values
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim())
    .sort((left, right) =>
      left.localeCompare(right, "en", { sensitivity: "variant" }),
    );
  for (const displayValue of candidates) {
    const normalizedValue = normalize(displayValue);
    if (!unique.has(normalizedValue)) {
      unique.set(normalizedValue, displayValue);
    }
  }
  return [...unique.values()].sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" }),
  );
}

function normalizeOptional(value: string | null): string | null {
  return value === null ? null : normalize(value);
}

function isUniqueViolation(error: unknown): boolean {
  return postgresError(error)?.code === "23505";
}

function uniqueConflict(error: unknown): ConflictException {
  const constraint = postgresError(error)?.constraint;
  if (constraint === "product_slug_uidx") {
    return new ConflictException("A product with this slug already exists");
  }
  if (constraint === "product_variant_sku_uidx") {
    return new ConflictException("A variant with this SKU already exists");
  }
  if (constraint === "product_variant_product_color_size_uidx") {
    return new ConflictException(
      "This product already has a variant for that color and size.",
    );
  }
  return new ConflictException("A catalog value already exists.");
}

function postgresError(
  error: unknown,
): { code?: unknown; constraint?: unknown } | null {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    if ("code" in current || "constraint" in current) {
      return current;
    }
    current = "cause" in current ? current.cause : null;
  }
  return null;
}
