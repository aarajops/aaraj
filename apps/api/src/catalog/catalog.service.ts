import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import type {
  CatalogProductImage,
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
  CatalogPrice,
} from "@aaraj/contracts";
import {
  API_V1_BASE_PATH,
  CatalogMediaDerivativesSchema,
  MAX_CATALOG_PRODUCT_MEDIA,
} from "@aaraj/contracts";
import {
  invalidatePublishedFilterOptionsCache,
  readPublishedFilterOptionsCache,
  writePublishedFilterOptionsCache,
} from "./published-filter-cache.js";
import { MAX_LIST_OFFSET } from "@aaraj/contracts";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  ilike,
  isNotNull,
  isNull,
  not,
  or,
  sql,
} from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import {
  catalogProduct,
  catalogProductVariant,
  catalogProductMedia,
  catalogCategory,
  catalogSizeGuide,
  catalogSizeGuideMeasurement,
  catalogSizeGuideRow,
} from "./catalog-schema.js";
import { CatalogPolicy } from "./catalog.policy.js";
import type { CatalogCartVariant } from "./catalog-cart.port.js";
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

  async findPurchasableVariants(
    variantIds: readonly string[],
  ): Promise<CatalogCartVariant[]> {
    if (variantIds.length === 0) return [];

    const rows = await this.database.db
      .select({
        variantId: catalogProductVariant.id,
        slug: catalogProduct.slug,
        name: catalogProduct.name,
        color: catalogProductVariant.color,
        sizeLabel: catalogProductVariant.sizeLabel,
        unitPriceBdt: catalogProductVariant.priceBdt,
      })
      .from(catalogProductVariant)
      .innerJoin(
        catalogProduct,
        eq(catalogProduct.id, catalogProductVariant.productId),
      )
      .where(
        and(
          inArray(catalogProductVariant.id, [...new Set(variantIds)]),
          eq(catalogProductVariant.isActive, true),
          isNotNull(catalogProductVariant.priceBdt),
          ...this.publishedProductEligibilityConditions(),
        ),
      );

    return rows.flatMap((row) =>
      row.unitPriceBdt === null
        ? []
        : [
            {
              ...row,
              unitPriceBdt: safeAmountBdt(row.unitPriceBdt),
              currency: "BDT" as const,
            },
          ],
    );
  }

  async listPublished(
    query: CatalogPublishedProductListQuery,
  ): Promise<CatalogPublishedProductPage> {
    const conditions = [...this.publishedProductEligibilityConditions()];
    if (query.search) {
      const searchPattern = `%${escapeLikeWildcards(query.search)}%`;
      const searchCondition = or(
        ilike(catalogProduct.name, searchPattern),
        ilike(catalogProduct.description, searchPattern),
        ilike(catalogProduct.fit, searchPattern),
        ilike(catalogProduct.fabricComposition, searchPattern),
        ilike(catalogProduct.careInstructions, searchPattern),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
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

    const selectedRows = rows.slice(0, query.limit);
    const [categoryReferences, firstVariantPrices] = await Promise.all([
      loadCategoryReferences(
        this.database.db,
        selectedRows.map(({ categoryId }) => categoryId),
      ),
      loadFirstVariantPrices(
        this.database.db,
        selectedRows.map(({ id }) => id),
      ),
    ]);
    const imagesByProduct = await this.loadPublishedProductImages(
      selectedRows.map(({ id }) => id),
    );
    const page = toProductPage(
      rows,
      query,
      categoryReferences,
      firstVariantPrices,
    );
    return {
      ...page,
      products: page.products.map((product) => ({
        ...product,
        images: imagesByProduct.get(product.id) ?? [],
      })),
      filters: filterOptions,
    };
  }

  private async loadPublishedProductImages(
    productIds: string[],
  ): Promise<Map<string, CatalogProductImage[]>> {
    const imagesByProduct = new Map<string, CatalogProductImage[]>();
    if (!productIds.length) return imagesByProduct;

    const rows = await this.database.db
      .select({
        id: catalogProductMedia.id,
        productId: catalogProductMedia.productId,
        altText: catalogProductMedia.altText,
        derivatives: catalogProductMedia.derivatives,
      })
      .from(catalogProductMedia)
      .leftJoin(
        catalogProductVariant,
        eq(catalogProductVariant.id, catalogProductMedia.variantId),
      )
      .where(
        and(
          inArray(catalogProductMedia.productId, productIds),
          eq(catalogProductMedia.status, "ready"),
          or(
            isNull(catalogProductMedia.variantId),
            eq(catalogProductVariant.isActive, true),
          ),
        ),
      )
      .orderBy(asc(catalogProductMedia.sortOrder), asc(catalogProductMedia.id));

    for (const row of rows) {
      const parsed = CatalogMediaDerivativesSchema.safeParse(row.derivatives);
      if (!parsed.success) continue;
      const card = parsed.data.find(({ rendition }) => rendition === "card");
      const detail = parsed.data.find(
        ({ rendition }) => rendition === "detail",
      );
      if (!card || !detail) continue;

      const images = imagesByProduct.get(row.productId) ?? [];
      if (images.length >= MAX_CATALOG_PRODUCT_MEDIA) continue;
      images.push({
        id: row.id,
        altText: row.altText,
        card: {
          src: publicDerivativePath(row.id, "card", card.sha256),
          width: card.width,
          height: card.height,
        },
        detail: {
          src: publicDerivativePath(row.id, "detail", detail.sha256),
          width: detail.width,
          height: detail.height,
        },
      });
      imagesByProduct.set(row.productId, images);
    }
    return imagesByProduct;
  }

  private publishedProductEligibilityConditions() {
    const activeVariants = this.database.db
      .select({ id: catalogProductVariant.id })
      .from(catalogProductVariant)
      .where(
        and(
          eq(catalogProductVariant.productId, catalogProduct.id),
          eq(catalogProductVariant.isActive, true),
        ),
      );
    const unpricedVariants = this.database.db
      .select({ id: catalogProductVariant.id })
      .from(catalogProductVariant)
      .where(
        and(
          eq(catalogProductVariant.productId, catalogProduct.id),
          eq(catalogProductVariant.isActive, true),
          isNull(catalogProductVariant.priceBdt),
        ),
      );

    return [
      eq(catalogProduct.isPublished, true),
      exists(activeVariants),
      not(exists(unpricedVariants)),
    ];
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
    const cached = await readPublishedFilterOptionsCache();
    if (cached) return cached;

    const [productValues, variantValues, categoryOptions] = await Promise.all([
      this.database.db
        .selectDistinct({
          categoryId: catalogProduct.categoryId,
        })
        .from(catalogProduct)
        .where(
          and(
            ...this.publishedProductEligibilityConditions(),
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
            ...this.publishedProductEligibilityConditions(),
            eq(catalogProductVariant.isActive, true),
            isNotNull(catalogProductVariant.priceBdt),
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

    const options = {
      categories: categoryOptions.categories.filter(({ id }) =>
        visibleCategoryIds.has(id),
      ),
      colors: uniqueFilterValues(variantValues.map(({ color }) => color)),
      sizes: uniqueFilterValues(variantValues.map(({ size }) => size)),
    };
    await writePublishedFilterOptionsCache(options);
    return options;
  }

  async findPublished(slug: string): Promise<CatalogProductDetail> {
    const product = await this.database.db.transaction(async (transaction) => {
      const [product] = await transaction
        .select()
        .from(catalogProduct)
        .where(
          and(
            eq(catalogProduct.slug, slug),
            ...this.publishedProductEligibilityConditions(),
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
      };
    });
    const imagesByProduct = await this.loadPublishedProductImages([product.id]);
    return {
      ...product,
      images: imagesByProduct.get(product.id) ?? [],
    };
  }

  async listForManagement(
    actor: AccessPrincipal,
    query: CatalogProductListQuery,
  ): Promise<CatalogProductPage> {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    const predicates = [];
    if (query.search) {
      const searchPattern = `%${escapeLikeWildcards(query.search)}%`;
      predicates.push(
        or(
          ilike(catalogProduct.name, searchPattern),
          ilike(catalogProduct.slug, searchPattern),
          exists(
            this.database.db
              .select({ id: catalogProductVariant.id })
              .from(catalogProductVariant)
              .where(
                and(
                  eq(catalogProductVariant.productId, catalogProduct.id),
                  ilike(catalogProductVariant.sku, searchPattern),
                ),
              ),
          ),
        ),
      );
    }
    if (query.categoryId) {
      predicates.push(
        query.categoryId === "uncategorized"
          ? isNull(catalogProduct.categoryId)
          : eq(catalogProduct.categoryId, query.categoryId),
      );
    }
    if (query.status) {
      predicates.push(
        eq(catalogProduct.isPublished, query.status === "published"),
      );
    }
    const rows = await this.database.db
      .select()
      .from(catalogProduct)
      .where(predicates.length ? and(...predicates) : undefined)
      .orderBy(desc(catalogProduct.updatedAt), desc(catalogProduct.id))
      .limit(query.limit + 1)
      .offset(query.offset);
    const selectedRows = rows.slice(0, query.limit);
    const [categoryReferences, firstVariantPrices] = await Promise.all([
      loadCategoryReferences(
        this.database.db,
        selectedRows.map(({ categoryId }) => categoryId),
      ),
      loadFirstVariantPrices(
        this.database.db,
        selectedRows.map(({ id }) => id),
      ),
    ]);
    return toProductPage(rows, query, categoryReferences, firstVariantPrices);
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
    const created = await this.database.db.transaction(async (transaction) => {
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
        const insertedVariants = variants.length
          ? await insertVariants(transaction, product.id, variants)
          : [];
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
            variantPrices: insertedVariants.flatMap((variant) =>
              variant.priceBdt === null
                ? []
                : [
                    {
                      variantId: variant.id,
                      amountBdt: safeAmountBdt(variant.priceBdt),
                    },
                  ],
            ),
          },
        });
        const category = product.categoryId
          ? await loadCategoryReference(transaction, product.categoryId)
          : null;
        const firstVariantPrice = await loadFirstVariantPrice(
          transaction,
          product.id,
        );
        return toCatalogProduct(product, category, firstVariantPrice);
      } catch (error) {
        if (isUniqueViolation(error)) throw uniqueConflict(error);
        throw error;
      }
    });
    await invalidatePublishedFilterOptionsCache();
    return created;
  }

  async update(
    actor: AccessPrincipal,
    productId: string,
    input: CatalogProductUpdateInput,
  ) {
    const updated = await this.database.db.transaction(async (transaction) => {
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
          price:
            variant.priceBdt === null ? null : toCatalogPrice(variant.priceBdt),
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
        const variantPriceChanges =
          input.variants !== undefined
            ? await reconcileVariants(transaction, productId, input.variants)
            : [];
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
            ...(variantPriceChanges.length ? { variantPriceChanges } : {}),
          },
        });
        const category = product.categoryId
          ? await loadCategoryReference(transaction, product.categoryId)
          : null;
        const firstVariantPrice = await loadFirstVariantPrice(
          transaction,
          product.id,
        );
        return toCatalogProduct(product, category, firstVariantPrice);
      } catch (error) {
        if (isUniqueViolation(error)) throw uniqueConflict(error);
        throw error;
      }
    });
    await invalidatePublishedFilterOptionsCache();
    return updated;
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
  if (variants.some(({ price }) => price === null)) {
    throw new BadRequestException(
      "Set a BDT price for every active variant before publishing.",
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
  return transaction
    .insert(catalogProductVariant)
    .values(
      variants.map((variant) => ({
        productId,
        sku: variant.sku,
        color: variant.color,
        sizeLabel: variant.sizeLabel,
        priceBdt: variant.price === null ? null : variant.price.amountBdt,
        gtin: variant.gtin ?? null,
        isActive: true,
      })),
    )
    .returning({
      id: catalogProductVariant.id,
      priceBdt: catalogProductVariant.priceBdt,
    });
}

async function reconcileVariants(
  transaction: AuditTransaction,
  productId: string,
  desired: CatalogProductVariantInput[],
): Promise<
  Array<{
    variantId: string;
    previousAmountBdt: number | null;
    nextAmountBdt: number | null;
  }>
> {
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
  const priceChanges: Array<{
    variantId: string;
    previousAmountBdt: number | null;
    nextAmountBdt: number | null;
  }> = [];

  for (const variant of desired) {
    const nextPriceBdt =
      variant.price === null ? null : variant.price.amountBdt;
    const match = byCombination.get(
      combinationKey(variant.color, variant.sizeLabel),
    );
    if (match) {
      desiredIds.add(match.id);
      if (match.priceBdt !== nextPriceBdt) {
        priceChanges.push({
          variantId: match.id,
          previousAmountBdt:
            match.priceBdt === null ? null : safeAmountBdt(match.priceBdt),
          nextAmountBdt:
            nextPriceBdt === null ? null : safeAmountBdt(nextPriceBdt),
        });
      }
      await transaction
        .update(catalogProductVariant)
        .set({
          sku: variant.sku,
          color: variant.color,
          sizeLabel: variant.sizeLabel,
          priceBdt: nextPriceBdt,
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
          priceBdt: nextPriceBdt,
          gtin: variant.gtin ?? null,
          isActive: true,
        })
        .returning({ id: catalogProductVariant.id });
      if (!inserted) throw new Error("Product variant insert returned no row.");
      desiredIds.add(inserted.id);
      if (nextPriceBdt !== null) {
        priceChanges.push({
          variantId: inserted.id,
          previousAmountBdt: null,
          nextAmountBdt: safeAmountBdt(nextPriceBdt),
        });
      }
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

  return priceChanges;
}

async function loadProductDetail(
  transaction: AuditTransaction,
  product: typeof catalogProduct.$inferSelect,
): Promise<CatalogManagedProductDetail> {
  const loadedVariantRows = await transaction
    .select({ variant: catalogProductVariant })
    .from(catalogProductVariant)
    .innerJoin(
      catalogProduct,
      eq(catalogProductVariant.productId, catalogProduct.id),
    )
    .leftJoin(
      catalogSizeGuideRow,
      and(
        eq(catalogSizeGuideRow.guideId, catalogProduct.sizeGuideId),
        eq(
          sql<string>`lower(btrim(${catalogSizeGuideRow.sizeLabel}))`,
          sql<string>`lower(btrim(${catalogProductVariant.sizeLabel}))`,
        ),
      ),
    )
    .where(
      and(
        eq(catalogProductVariant.productId, product.id),
        eq(catalogProductVariant.isActive, true),
      ),
    )
    .orderBy(...variantDisplayOrder());
  const loadedVariants = loadedVariantRows.map(({ variant }) => variant);
  const sizeGuide = product.sizeGuideId
    ? await loadSizeGuideDetail(transaction, product.sizeGuideId)
    : null;
  const variants = loadedVariants;

  return {
    ...toCatalogProduct(
      product,
      product.categoryId
        ? await loadCategoryReference(transaction, product.categoryId)
        : null,
      variants[0]?.priceBdt === null || variants[0] === undefined
        ? null
        : toCatalogPrice(variants[0].priceBdt),
    ),
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      color: variant.color,
      sizeLabel: variant.sizeLabel,
      price:
        variant.priceBdt === null ? null : toCatalogPrice(variant.priceBdt),
      gtin: variant.gtin,
      isActive: variant.isActive,
    })),
    sizeGuide,
  };
}

async function loadFirstVariantPrices(
  database: DatabaseService["db"],
  productIds: string[],
): Promise<Map<string, CatalogPrice | null>> {
  if (!productIds.length) return new Map();

  const rows = await database
    .selectDistinctOn([catalogProductVariant.productId], {
      productId: catalogProductVariant.productId,
      priceBdt: catalogProductVariant.priceBdt,
    })
    .from(catalogProductVariant)
    .innerJoin(
      catalogProduct,
      eq(catalogProduct.id, catalogProductVariant.productId),
    )
    .leftJoin(
      catalogSizeGuideRow,
      and(
        eq(catalogSizeGuideRow.guideId, catalogProduct.sizeGuideId),
        eq(
          sql<string>`lower(btrim(${catalogSizeGuideRow.sizeLabel}))`,
          sql<string>`lower(btrim(${catalogProductVariant.sizeLabel}))`,
        ),
      ),
    )
    .where(
      and(
        inArray(catalogProductVariant.productId, productIds),
        eq(catalogProductVariant.isActive, true),
      ),
    )
    .orderBy(asc(catalogProductVariant.productId), ...variantDisplayOrder());

  return new Map(
    rows.map(({ productId, priceBdt }) => [
      productId,
      priceBdt === null ? null : toCatalogPrice(priceBdt),
    ]),
  );
}

async function loadFirstVariantPrice(
  database: AuditTransaction,
  productId: string,
): Promise<CatalogPrice | null> {
  const [variant] = await database
    .select({ priceBdt: catalogProductVariant.priceBdt })
    .from(catalogProductVariant)
    .innerJoin(
      catalogProduct,
      eq(catalogProduct.id, catalogProductVariant.productId),
    )
    .leftJoin(
      catalogSizeGuideRow,
      and(
        eq(catalogSizeGuideRow.guideId, catalogProduct.sizeGuideId),
        eq(
          sql<string>`lower(btrim(${catalogSizeGuideRow.sizeLabel}))`,
          sql<string>`lower(btrim(${catalogProductVariant.sizeLabel}))`,
        ),
      ),
    )
    .where(
      and(
        eq(catalogProductVariant.productId, productId),
        eq(catalogProductVariant.isActive, true),
      ),
    )
    .orderBy(...variantDisplayOrder())
    .limit(1);
  return variant?.priceBdt == null ? null : toCatalogPrice(variant.priceBdt);
}

function sizeGuideOrderExpression() {
  return sql<number>`coalesce(${catalogSizeGuideRow.sortOrder}, 2147483647)`;
}

function variantDisplayOrder() {
  return [
    asc(sql<string>`lower(btrim(${catalogProductVariant.color})) collate "C"`),
    asc(sizeGuideOrderExpression()),
    asc(
      sql<string>`lower(btrim(${catalogProductVariant.sizeLabel})) collate "C"`,
    ),
    asc(catalogProductVariant.id),
  ];
}

function toCatalogPrice(amountBdt: number): CatalogPrice {
  return { amountBdt: safeAmountBdt(amountBdt) };
}

function publicDerivativePath(
  mediaId: string,
  rendition: "card" | "detail",
  sha256: string,
): string {
  return `${API_V1_BASE_PATH}/catalog/media/${mediaId}/${rendition}/${sha256}.webp`;
}

function safeAmountBdt(amountBdt: number): number {
  if (!Number.isSafeInteger(amountBdt) || amountBdt < 0) {
    throw new Error("A stored catalog price is outside the supported range.");
  }
  return amountBdt;
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
  firstVariantPrices: Map<string, CatalogPrice | null>,
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
        firstVariantPrices.get(product.id) ?? null,
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
  price: CatalogPrice | null,
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
    price,
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

function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
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
