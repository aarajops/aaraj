import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import type {
  CatalogProductDetailImage,
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
  CatalogProductContentBlock,
  CatalogCategoryReference,
  CatalogPrice,
  CatalogPriceRange,
} from "@aaraj/contracts";
import {
  API_V1_BASE_PATH,
  CATALOG_PRODUCT_SLUG_MAX_LENGTH,
  CatalogProductUpdateSchema,
  CatalogMediaDerivativesSchema,
  MAX_CATALOG_PRODUCT_MEDIA,
  CURRENCY,
} from "@aaraj/contracts";
import {
  invalidatePublishedFilterOptionsCache,
  readPublishedFilterOptionsCache,
  writePublishedFilterOptionsCache,
  type PublishedFilterOptionsCache,
} from "./published-filter-cache.js";
import { MAX_LIST_OFFSET } from "@aaraj/contracts";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  ilike,
  lte,
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
  catalogSizeGuideRow,
} from "./catalog-schema.js";
import { CatalogPolicy } from "./catalog.policy.js";
import type {
  CatalogCartVariant,
  PurchasableCatalogVariant,
} from "./catalog-cart.port.js";
import { CategoryService } from "./category.service.js";
import {
  isCategoryOrDescendant,
  loadCategoryParentMap,
  loadCategoryReference,
  loadCategoryReferences,
  requireActiveLeafCategory,
} from "./catalog-category.helpers.js";
import { loadCatalogSizeGuide } from "./catalog-size-guide.helpers.js";
import {
  catalogSlugBase,
  catalogSlugCandidate,
  findAvailableCatalogSlug,
} from "./catalog-slug.js";

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
    options: { includeImages?: boolean } = {},
  ): Promise<CatalogCartVariant[]> {
    if (variantIds.length === 0) return [];

    const rows = await this.database.db
      .select({
        variantId: catalogProductVariant.id,
        productId: catalogProduct.id,
        slug: catalogProduct.slug,
        sku: catalogProductVariant.sku,
        name: catalogProduct.name,
        description: catalogProduct.description,
        contentBlocks: catalogProduct.contentBlocks,
        color: catalogProductVariant.color,
        sizeLabel: catalogProductVariant.sizeLabel,
        unitPriceBdt: catalogProductVariant.priceBdt,
        compareAtPriceBdt: catalogProductVariant.compareAtPriceBdt,
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

    const imagesByProduct = options.includeImages
      ? await this.loadPublishedProductImages([
          ...new Set(rows.map(({ productId }) => productId)),
        ])
      : new Map<string, CatalogProductDetailImage[]>();

    return rows.flatMap((row) => {
      if (row.unitPriceBdt === null) return [];
      const productImages = imagesByProduct.get(row.productId) ?? [];
      const image =
        productImages.find(({ variantId }) => variantId === row.variantId) ??
        productImages.find(
          ({ variantId, variantColor }) =>
            variantId === null &&
            variantColor !== null &&
            normalize(variantColor) === normalize(row.color),
        ) ??
        productImages.find(
          ({ variantColor }) =>
            variantColor !== null &&
            normalize(variantColor) === normalize(row.color),
        ) ??
        productImages.find(({ variantId }) => variantId === null);
      return [
        {
          variantId: row.variantId,
          slug: row.slug,
          sku: row.sku,
          name: row.name,
          description: row.description,
          contentBlocks: row.contentBlocks,
          color: row.color,
          sizeLabel: row.sizeLabel,
          unitPriceBdt: safeAmountBdt(row.unitPriceBdt),
          compareAtPriceBdt:
            row.compareAtPriceBdt === null
              ? null
              : safeAmountBdt(row.compareAtPriceBdt),
          currency: CURRENCY,
          image: image ? { ...image.card, altText: image.altText } : null,
        },
      ];
    });
  }

  async findPurchasableVariantsWithinTransaction(
    transaction: AuditTransaction,
    variantIds: readonly string[],
  ): Promise<PurchasableCatalogVariant[]> {
    if (variantIds.length === 0) return [];

    const rows = await transaction
      .select({
        variantId: catalogProductVariant.id,
        slug: catalogProduct.slug,
        sku: catalogProductVariant.sku,
        name: catalogProduct.name,
        description: catalogProduct.description,
        contentBlocks: catalogProduct.contentBlocks,
        color: catalogProductVariant.color,
        sizeLabel: catalogProductVariant.sizeLabel,
        unitPriceBdt: catalogProductVariant.priceBdt,
        compareAtPriceBdt: catalogProductVariant.compareAtPriceBdt,
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
      )
      .for("share");

    return rows.flatMap((row) => {
      if (row.unitPriceBdt === null) return [];
      return [
        {
          variantId: row.variantId,
          slug: row.slug,
          sku: row.sku,
          name: row.name,
          description: row.description,
          contentBlocks: row.contentBlocks,
          color: row.color,
          sizeLabel: row.sizeLabel,
          unitPriceBdt: safeAmountBdt(row.unitPriceBdt),
          compareAtPriceBdt:
            row.compareAtPriceBdt === null
              ? null
              : safeAmountBdt(row.compareAtPriceBdt),
        },
      ];
    });
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

    if (
      query.color?.length ||
      query.size?.length ||
      query.minPriceBdt !== undefined ||
      query.maxPriceBdt !== undefined
    ) {
      const variantConditions = [
        eq(catalogProductVariant.productId, catalogProduct.id),
        eq(catalogProductVariant.isActive, true),
      ];
      if (query.color?.length) {
        variantConditions.push(
          inArray(
            sql<string>`lower(btrim(${catalogProductVariant.color}))`,
            query.color.map(normalize),
          ),
        );
      }
      if (query.size?.length) {
        variantConditions.push(
          inArray(
            sql<string>`lower(btrim(${catalogProductVariant.sizeLabel}))`,
            query.size.map(normalize),
          ),
        );
      }
      if (query.minPriceBdt !== undefined) {
        variantConditions.push(
          gte(catalogProductVariant.priceBdt, query.minPriceBdt),
        );
      }
      if (query.maxPriceBdt !== undefined) {
        variantConditions.push(
          lte(catalogProductVariant.priceBdt, query.maxPriceBdt),
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

    const lowestVariantPrice = sql<number>`(
      select min(${catalogProductVariant.priceBdt})
      from ${catalogProductVariant}
      where ${catalogProductVariant.productId} = ${catalogProduct.id}
        and ${catalogProductVariant.isActive} = true
    )`;
    const productOrder =
      query.sort === "price-ascending"
        ? [
            asc(lowestVariantPrice),
            desc(catalogProduct.createdAt),
            desc(catalogProduct.id),
          ]
        : query.sort === "price-descending"
          ? [
              desc(lowestVariantPrice),
              desc(catalogProduct.createdAt),
              desc(catalogProduct.id),
            ]
          : [desc(catalogProduct.createdAt), desc(catalogProduct.id)];
    const [rows, filterOptions] = await Promise.all([
      this.database.db
        .select()
        .from(catalogProduct)
        .where(and(...conditions))
        .orderBy(...productOrder)
        .limit(query.limit + 1)
        .offset(query.offset),
      this.getPublishedProductFilterOptions(query.category),
    ]);

    const selectedRows = rows.slice(0, query.limit);
    const [categoryReferences, lowestVariantPricing] = await Promise.all([
      loadCategoryReferences(
        this.database.db,
        selectedRows.map(({ categoryId }) => categoryId),
      ),
      loadLowestVariantPricing(
        this.database.db,
        selectedRows.map(({ id }) => id),
      ),
    ]);
    const productIds = selectedRows.map(({ id }) => id);
    const [imagesByProduct, variantSummariesByProduct] = await Promise.all([
      this.loadPublishedProductImages(productIds),
      this.loadPublishedProductVariantSummaries(productIds),
    ]);
    const page = toProductPage(
      rows,
      query,
      categoryReferences,
      lowestVariantPricing,
    );
    return {
      ...page,
      products: page.products.map((product) => ({
        ...product,
        images: (imagesByProduct.get(product.id) ?? []).map(
          ({ id, altText, card, detail }) => ({ id, altText, card, detail }),
        ),
        videos: [],
        priceVaries:
          variantSummariesByProduct.get(product.id)?.priceVaries ?? false,
      })),
      filters: filterOptions,
    };
  }

  private async loadPublishedProductVariantSummaries(
    productIds: string[],
  ): Promise<Map<string, { priceVaries: boolean }>> {
    const summariesByProduct = new Map<string, Set<number>>();
    if (!productIds.length) return new Map();

    const rows = await this.database.db
      .select({
        productId: catalogProductVariant.productId,
        priceBdt: catalogProductVariant.priceBdt,
      })
      .from(catalogProductVariant)
      .where(
        and(
          inArray(catalogProductVariant.productId, productIds),
          eq(catalogProductVariant.isActive, true),
          isNotNull(catalogProductVariant.priceBdt),
        ),
      );

    for (const { productId, priceBdt } of rows) {
      if (priceBdt === null) continue;
      const prices = summariesByProduct.get(productId) ?? new Set<number>();
      prices.add(priceBdt);
      summariesByProduct.set(productId, prices);
    }

    return new Map(
      [...summariesByProduct].map(([productId, prices]) => [
        productId,
        {
          priceVaries: prices.size > 1,
        },
      ]),
    );
  }

  private async loadPublishedProductImages(
    productIds: string[],
  ): Promise<Map<string, CatalogProductDetailImage[]>> {
    const imagesByProduct = new Map<string, CatalogProductDetailImage[]>();
    if (!productIds.length) return imagesByProduct;

    const rows = await this.database.db
      .select({
        id: catalogProductMedia.id,
        productId: catalogProductMedia.productId,
        variantId: catalogProductMedia.variantId,
        variantColor: catalogProductMedia.variantColor,
        skuColor: catalogProductVariant.color,
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
            isNotNull(catalogProductMedia.variantColor),
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
        variantId: row.variantId,
        variantColor: row.variantColor ?? row.skuColor ?? null,
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

  async getPublishedProductFilterOptions(
    categorySlug?: string,
  ): Promise<CatalogProductFilterOptions> {
    const cached = await readPublishedFilterOptionsCache();
    if (cached) return filterOptionsForCategory(cached, categorySlug);

    const [productCounts, variantValues, categoryOptions] = await Promise.all([
      this.database.db
        .select({
          categoryId: catalogProduct.categoryId,
          publishedProductCount: count(),
        })
        .from(catalogProduct)
        .where(
          and(
            ...this.publishedProductEligibilityConditions(),
            isNotNull(catalogProduct.categoryId),
          ),
        )
        .groupBy(catalogProduct.categoryId),
      this.database.db
        .select({
          categoryId: catalogProduct.categoryId,
          color: catalogProductVariant.color,
          size: catalogProductVariant.sizeLabel,
          minPriceBdt: sql<number>`min(${catalogProductVariant.priceBdt})`,
          maxPriceBdt: sql<number>`max(${catalogProductVariant.priceBdt})`,
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
        )
        .groupBy(
          catalogProduct.categoryId,
          catalogProductVariant.color,
          catalogProductVariant.sizeLabel,
        ),
      this.categories.listPublic(),
    ]);

    const categoriesById = new Map(
      categoryOptions.categories.map((category) => [category.id, category]),
    );
    const categoryFacetValues = new Map<
      string,
      {
        colors: Set<string>;
        sizes: Set<string>;
        priceRange: CatalogPriceRange | null;
      }
    >();
    let priceRange: CatalogPriceRange | null = null;
    for (const row of variantValues) {
      const range = {
        minPriceBdt: row.minPriceBdt,
        maxPriceBdt: row.maxPriceBdt,
      };
      priceRange = mergePriceRanges(priceRange, range);

      let currentId: string | null = row.categoryId;
      const visited = new Set<string>();
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const category = categoriesById.get(currentId);
        if (!category) break;
        let values = categoryFacetValues.get(category.slug);
        if (!values) {
          values = { colors: new Set(), sizes: new Set(), priceRange: null };
          categoryFacetValues.set(category.slug, values);
        }
        values.priceRange = mergePriceRanges(values.priceRange, range);
        values.colors.add(row.color);
        values.sizes.add(row.size);
        currentId = category.parentId;
      }
    }

    const visibleCategoryIds = new Set<string>();
    const publishedProductCounts = new Map<string, number>();
    for (const { categoryId, publishedProductCount } of productCounts) {
      let currentId = categoryId;
      while (currentId) {
        visibleCategoryIds.add(currentId);
        publishedProductCounts.set(
          currentId,
          (publishedProductCounts.get(currentId) ?? 0) + publishedProductCount,
        );
        currentId = categoriesById.get(currentId)?.parentId ?? null;
      }
    }

    const options: CatalogProductFilterOptions = {
      categories: categoryOptions.categories
        .filter(({ id }) => visibleCategoryIds.has(id))
        .map((category) => ({
          ...category,
          publishedProductCount: publishedProductCounts.get(category.id) ?? 0,
        })),
      colors: uniqueFilterValues(variantValues.map(({ color }) => color)),
      sizes: uniqueFilterValues(variantValues.map(({ size }) => size)),
      priceRange,
    };
    const cache: PublishedFilterOptionsCache = {
      options,
      categories: Object.fromEntries(
        [...categoryFacetValues].map(([slug, values]) => [
          slug,
          {
            colors: uniqueFilterValues([...values.colors]),
            sizes: uniqueFilterValues([...values.sizes]),
            priceRange: values.priceRange,
          },
        ]),
      ),
    };
    await writePublishedFilterOptionsCache(cache);
    return filterOptionsForCategory(cache, categorySlug);
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
      const variants = detail.variants.map(
        ({ id, color, sizeLabel, price, compareAtPrice }) => {
          if (!price) {
            throw new Error("Published product variant is missing its price.");
          }
          return { id, color, sizeLabel, price, compareAtPrice };
        },
      );
      return {
        ...detail,
        variants,
        sizeGuide: detail.sizeGuide,
      };
    });
    const imagesByProduct = await this.loadPublishedProductImages([product.id]);
    return {
      ...product,
      images: imagesByProduct.get(product.id) ?? [],
      videos: [],
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
    const [categoryReferences, lowestVariantPricing] = await Promise.all([
      loadCategoryReferences(
        this.database.db,
        selectedRows.map(({ categoryId }) => categoryId),
      ),
      loadLowestVariantPricing(
        this.database.db,
        selectedRows.map(({ id }) => id),
      ),
    ]);
    return toProductPage(rows, query, categoryReferences, lowestVariantPricing);
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

  async suggestSlug(actor: AccessPrincipal, name: string) {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    const slug = await findAvailableCatalogSlug(name, {
      maxLength: CATALOG_PRODUCT_SLUG_MAX_LENGTH,
      fallback: "product",
      isTaken: async (candidate) => {
        const [existing] = await this.database.db
          .select({ id: catalogProduct.id })
          .from(catalogProduct)
          .where(eq(catalogProduct.slug, candidate))
          .limit(1);
        return Boolean(existing);
      },
    });
    return { slug };
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
          throw new BadRequestException(
            "Create the product as a draft, add processed images for every color, then publish it.",
          );
        } else if (values.sizeGuideId) {
          await requireSizeGuide(transaction, values.sizeGuideId, false);
        }

        const productValues = {
          ...values,
          isPublished: input.isPublished ?? false,
        };
        const [product] = input.slug
          ? await transaction
              .insert(catalogProduct)
              .values({ ...productValues, slug: input.slug })
              .returning()
          : [
              await insertProductWithGeneratedSlug(
                transaction,
                productValues,
                input.name,
              ),
            ];
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
              variant.priceBdt === null && variant.compareAtPriceBdt === null
                ? []
                : [
                    {
                      variantId: variant.id,
                      amountBdt:
                        variant.priceBdt === null
                          ? null
                          : safeAmountBdt(variant.priceBdt),
                      compareAtAmountBdt:
                        variant.compareAtPriceBdt === null
                          ? null
                          : safeAmountBdt(variant.compareAtPriceBdt),
                    },
                  ],
            ),
          },
        });
        const category = product.categoryId
          ? await loadCategoryReference(transaction, product.categoryId)
          : null;
        const lowestVariantPricing = await loadProductVariantPricing(
          transaction,
          product.id,
        );
        return toCatalogProduct(product, category, lowestVariantPricing);
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
        contentBlocks:
          input.contentBlocks !== undefined
            ? input.contentBlocks
            : current.contentBlocks,
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
      const currentVariantsByCombination = new Map(
        currentVariants.map((variant) => [
          combinationKey(variant.color, variant.sizeLabel),
          variant,
        ]),
      );
      const variants = input.variants
        ? input.variants.map((variant) => {
            const currentVariant = currentVariantsByCombination.get(
              combinationKey(variant.color, variant.sizeLabel),
            );
            const compareAtPrice =
              variant.compareAtPrice === undefined
                ? currentVariant?.compareAtPriceBdt == null
                  ? null
                  : toCatalogPrice(currentVariant.compareAtPriceBdt)
                : variant.compareAtPrice;
            return { ...variant, compareAtPrice };
          })
        : currentVariants.map((variant) => ({
            sku: variant.sku,
            color: variant.color,
            sizeLabel: variant.sizeLabel,
            gtin: variant.gtin,
            price:
              variant.priceBdt === null
                ? null
                : toCatalogPrice(variant.priceBdt),
            compareAtPrice:
              variant.compareAtPriceBdt === null
                ? null
                : toCatalogPrice(variant.compareAtPriceBdt),
          }));
      const pricingValidation = CatalogProductUpdateSchema.safeParse({
        variants,
      });
      if (!pricingValidation.success) {
        throw new BadRequestException(
          pricingValidation.error.issues[0]?.message ??
            "The product variant prices are invalid.",
        );
      }

      try {
        if (nextValues.categoryId) {
          await requireActiveLeafCategory(transaction, nextValues.categoryId);
        }
        if (nextIsPublished) {
          await validatePublishability(
            transaction,
            productId,
            nextValues,
            variants,
          );
        } else if (nextValues.sizeGuideId) {
          await requireSizeGuide(transaction, nextValues.sizeGuideId, false);
        }

        const changes = {
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.contentBlocks !== undefined
            ? { contentBlocks: input.contentBlocks }
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
        const variantPricingChanges =
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
            ...(variantPricingChanges.length
              ? { variantPriceChanges: variantPricingChanges }
              : {}),
          },
        });
        const category = product.categoryId
          ? await loadCategoryReference(transaction, product.categoryId)
          : null;
        const lowestVariantPricing = await loadProductVariantPricing(
          transaction,
          product.id,
        );
        return toCatalogProduct(product, category, lowestVariantPricing);
      } catch (error) {
        if (isUniqueViolation(error)) throw uniqueConflict(error);
        throw error;
      }
    });
    await invalidatePublishedFilterOptionsCache();
    return updated;
  }
}

function filterOptionsForCategory(
  cache: PublishedFilterOptionsCache,
  categorySlug?: string,
): CatalogProductFilterOptions {
  if (!categorySlug) return cache.options;
  const facets = cache.categories[categorySlug];
  return {
    ...cache.options,
    colors: facets?.colors ?? [],
    sizes: facets?.sizes ?? [],
    priceRange: facets?.priceRange ?? null,
  };
}

function mergePriceRanges(
  current: CatalogPriceRange | null,
  next: CatalogPriceRange,
): CatalogPriceRange {
  return current
    ? {
        minPriceBdt: Math.min(current.minPriceBdt, next.minPriceBdt),
        maxPriceBdt: Math.max(current.maxPriceBdt, next.maxPriceBdt),
      }
    : next;
}

async function validatePublishability(
  transaction: AuditTransaction,
  productId: string,
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
  const categoryMatches =
    product.categoryId === guide.categoryId ||
    isCategoryOrDescendant(
      product.categoryId,
      guide.categoryId,
      await loadCategoryParentMap(transaction),
    );
  if (
    !categoryMatches ||
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

  await validateProductMediaCoverage(transaction, productId, variants);
}

export async function validateProductMediaCoverage(
  transaction: AuditTransaction,
  productId: string,
  variants: Pick<CatalogProductVariantInput, "color">[],
  excludedMediaId?: string,
): Promise<void> {
  const activeColors = new Set(variants.map(({ color }) => normalize(color)));
  const readyMedia = await transaction
    .select({
      variantColor: catalogProductMedia.variantColor,
      skuColor: catalogProductVariant.color,
      derivatives: catalogProductMedia.derivatives,
    })
    .from(catalogProductMedia)
    .leftJoin(
      catalogProductVariant,
      and(
        eq(catalogProductVariant.id, catalogProductMedia.variantId),
        eq(catalogProductVariant.isActive, true),
      ),
    )
    .where(
      and(
        eq(catalogProductMedia.productId, productId),
        eq(catalogProductMedia.status, "ready"),
        excludedMediaId
          ? sql`${catalogProductMedia.id} <> ${excludedMediaId}::uuid`
          : undefined,
      ),
    );

  const coveredColors = new Set<string>();
  for (const media of readyMedia) {
    const derivatives = CatalogMediaDerivativesSchema.safeParse(
      media.derivatives,
    );
    if (
      !derivatives.success ||
      !derivatives.data.some(({ rendition }) => rendition === "card") ||
      !derivatives.data.some(({ rendition }) => rendition === "detail")
    ) {
      continue;
    }
    const color = media.variantColor ?? media.skuColor;
    if (color) coveredColors.add(normalize(color));
  }

  if (coveredColors.size === 0) {
    throw new BadRequestException(
      "Add a processed, color-assigned image before publishing this product.",
    );
  }

  const missingColors = [...activeColors].filter(
    (color) => !coveredColors.has(color),
  );
  if (missingColors.length > 0) {
    throw new BadRequestException(
      "Add at least one processed image for every active product color before publishing.",
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
        compareAtPriceBdt: variant.compareAtPrice?.amountBdt ?? null,
        gtin: variant.gtin ?? null,
        isActive: true,
      })),
    )
    .returning({
      id: catalogProductVariant.id,
      priceBdt: catalogProductVariant.priceBdt,
      compareAtPriceBdt: catalogProductVariant.compareAtPriceBdt,
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
    previousCompareAtAmountBdt: number | null;
    nextCompareAtAmountBdt: number | null;
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
  const pricingChanges: Array<{
    variantId: string;
    previousAmountBdt: number | null;
    nextAmountBdt: number | null;
    previousCompareAtAmountBdt: number | null;
    nextCompareAtAmountBdt: number | null;
  }> = [];

  for (const variant of desired) {
    const nextPriceBdt =
      variant.price === null ? null : variant.price.amountBdt;
    const match = byCombination.get(
      combinationKey(variant.color, variant.sizeLabel),
    );
    const nextCompareAtPriceBdt =
      variant.compareAtPrice === undefined
        ? (match?.compareAtPriceBdt ?? null)
        : (variant.compareAtPrice?.amountBdt ?? null);
    if (match) {
      desiredIds.add(match.id);
      if (
        match.priceBdt !== nextPriceBdt ||
        match.compareAtPriceBdt !== nextCompareAtPriceBdt
      ) {
        pricingChanges.push({
          variantId: match.id,
          previousAmountBdt:
            match.priceBdt === null ? null : safeAmountBdt(match.priceBdt),
          nextAmountBdt:
            nextPriceBdt === null ? null : safeAmountBdt(nextPriceBdt),
          previousCompareAtAmountBdt:
            match.compareAtPriceBdt === null
              ? null
              : safeAmountBdt(match.compareAtPriceBdt),
          nextCompareAtAmountBdt:
            nextCompareAtPriceBdt === null
              ? null
              : safeAmountBdt(nextCompareAtPriceBdt),
        });
      }
      await transaction
        .update(catalogProductVariant)
        .set({
          sku: variant.sku,
          color: variant.color,
          sizeLabel: variant.sizeLabel,
          priceBdt: nextPriceBdt,
          compareAtPriceBdt: nextCompareAtPriceBdt,
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
          compareAtPriceBdt: nextCompareAtPriceBdt,
          gtin: variant.gtin ?? null,
          isActive: true,
        })
        .returning({ id: catalogProductVariant.id });
      if (!inserted) throw new Error("Product variant insert returned no row.");
      desiredIds.add(inserted.id);
      if (nextPriceBdt !== null || nextCompareAtPriceBdt !== null) {
        pricingChanges.push({
          variantId: inserted.id,
          previousAmountBdt: null,
          nextAmountBdt:
            nextPriceBdt === null ? null : safeAmountBdt(nextPriceBdt),
          previousCompareAtAmountBdt: null,
          nextCompareAtAmountBdt:
            nextCompareAtPriceBdt === null
              ? null
              : safeAmountBdt(nextCompareAtPriceBdt),
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

  return pricingChanges;
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
  const startingPricing = lowestActiveVariantPricing(variants);

  return {
    ...toCatalogProduct(
      product,
      product.categoryId
        ? await loadCategoryReference(transaction, product.categoryId)
        : null,
      startingPricing,
    ),
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      color: variant.color,
      sizeLabel: variant.sizeLabel,
      price:
        variant.priceBdt === null ? null : toCatalogPrice(variant.priceBdt),
      compareAtPrice:
        variant.compareAtPriceBdt === null
          ? null
          : toCatalogPrice(variant.compareAtPriceBdt),
      gtin: variant.gtin,
      isActive: variant.isActive,
    })),
    sizeGuide,
  };
}

type CatalogProductPricing = {
  price: CatalogPrice | null;
  compareAtPrice: CatalogPrice | null;
};

async function loadLowestVariantPricing(
  database: DatabaseService["db"],
  productIds: string[],
): Promise<Map<string, CatalogProductPricing>> {
  if (!productIds.length) return new Map();

  const rows = await database
    .select({
      productId: catalogProductVariant.productId,
      priceBdt: catalogProductVariant.priceBdt,
      compareAtPriceBdt: catalogProductVariant.compareAtPriceBdt,
    })
    .from(catalogProductVariant)
    .where(
      and(
        inArray(catalogProductVariant.productId, productIds),
        eq(catalogProductVariant.isActive, true),
        isNotNull(catalogProductVariant.priceBdt),
      ),
    );
  const variantsByProduct = new Map<
    string,
    Array<{ priceBdt: number | null; compareAtPriceBdt: number | null }>
  >();
  for (const { productId, priceBdt, compareAtPriceBdt } of rows) {
    const variants = variantsByProduct.get(productId) ?? [];
    variants.push({ priceBdt, compareAtPriceBdt });
    variantsByProduct.set(productId, variants);
  }
  return new Map(
    productIds.map((productId) => [
      productId,
      lowestVariantPricing(variantsByProduct.get(productId) ?? []),
    ]),
  );
}

async function loadProductVariantPricing(
  database: AuditTransaction,
  productId: string,
): Promise<CatalogProductPricing> {
  const variants = await database
    .select({
      priceBdt: catalogProductVariant.priceBdt,
      compareAtPriceBdt: catalogProductVariant.compareAtPriceBdt,
    })
    .from(catalogProductVariant)
    .where(
      and(
        eq(catalogProductVariant.productId, productId),
        eq(catalogProductVariant.isActive, true),
        isNotNull(catalogProductVariant.priceBdt),
      ),
    );
  return lowestVariantPricing(variants);
}

function lowestActiveVariantPricing(
  variants: readonly (typeof catalogProductVariant.$inferSelect)[],
): CatalogProductPricing {
  return lowestVariantPricing(variants);
}

function lowestVariantPricing(
  variants: readonly {
    priceBdt: number | null;
    compareAtPriceBdt: number | null;
  }[],
): CatalogProductPricing {
  const priced = variants.filter(
    (
      variant,
    ): variant is { priceBdt: number; compareAtPriceBdt: number | null } =>
      variant.priceBdt !== null,
  );
  if (!priced.length) return { price: null, compareAtPrice: null };
  const amountBdt = Math.min(...priced.map(({ priceBdt }) => priceBdt));
  const lowestVariants = priced.filter(
    ({ priceBdt }) => priceBdt === amountBdt,
  );
  const compareAtAmounts = new Set(
    lowestVariants.map(({ compareAtPriceBdt }) => compareAtPriceBdt),
  );
  const firstLowestVariant = lowestVariants[0];
  const compareAtAmountBdt =
    compareAtAmounts.size === 1 && firstLowestVariant
      ? firstLowestVariant.compareAtPriceBdt
      : null;
  return {
    price: toCatalogPrice(amountBdt),
    compareAtPrice:
      compareAtAmountBdt !== null && compareAtAmountBdt > amountBdt
        ? toCatalogPrice(compareAtAmountBdt)
        : null,
  };
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
  return loadCatalogSizeGuide(transaction, guide);
}

function toProductPage(
  rows: (typeof catalogProduct.$inferSelect)[],
  query: CatalogProductListQuery,
  categories: Map<string, CatalogCategoryReference>,
  lowestVariantPricing: Map<string, CatalogProductPricing>,
): CatalogProductPage {
  const hasMore = rows.length > query.limit;
  const products = rows.slice(0, query.limit).map((product) =>
    toCatalogProduct(
      product,
      product.categoryId ? (categories.get(product.categoryId) ?? null) : null,
      lowestVariantPricing.get(product.id) ?? {
        price: null,
        compareAtPrice: null,
      },
    ),
  );
  const candidateNextOffset = query.offset + products.length;
  return {
    products,
    limit: query.limit,
    offset: query.offset,
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
  pricing: CatalogProductPricing,
): CatalogProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    contentBlocks: product.contentBlocks,
    audience: product.audience,
    category,
    fit: product.fit,
    fabricComposition: product.fabricComposition,
    careInstructions: product.careInstructions,
    sizeGuideId: product.sizeGuideId,
    ...pricing,
    isPublished: product.isPublished,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function toProductPersistenceValues(input: CatalogProductCreateInput): {
  name: string;
  description: string | null;
  contentBlocks: CatalogProductContentBlock[];
  audience: "men" | "women" | "unisex";
  categoryId: string | null;
  fit: string | null;
  fabricComposition: string | null;
  careInstructions: string | null;
  sizeGuideId: string | null;
} {
  return {
    name: input.name,
    description: input.description ?? null,
    contentBlocks: input.contentBlocks ?? [],
    audience: input.audience,
    categoryId: input.categoryId ?? null,
    fit: input.fit ?? null,
    fabricComposition: input.fabricComposition ?? null,
    careInstructions: input.careInstructions ?? null,
    sizeGuideId: input.sizeGuideId ?? null,
  };
}

async function insertProductWithGeneratedSlug(
  transaction: AuditTransaction,
  values: Omit<typeof catalogProduct.$inferInsert, "slug">,
  name: string,
): Promise<typeof catalogProduct.$inferSelect> {
  const base = catalogSlugBase(
    name,
    CATALOG_PRODUCT_SLUG_MAX_LENGTH,
    "product",
  );
  for (let suffix = 1; ; suffix += 1) {
    const slug = catalogSlugCandidate(
      base,
      suffix,
      CATALOG_PRODUCT_SLUG_MAX_LENGTH,
    );
    const [product] = await transaction
      .insert(catalogProduct)
      .values({ ...values, slug })
      .onConflictDoNothing({ target: catalogProduct.slug })
      .returning();
    if (product) return product;
  }
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
    return new ConflictException("A product with this slug already exists", {
      errorCode: "CATALOG_PRODUCT_SLUG_TAKEN",
    });
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
