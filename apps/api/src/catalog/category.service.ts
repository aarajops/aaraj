import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import type {
  CatalogCategoryImage,
  CatalogCategory,
  CatalogCategoryCreateInput,
  CatalogCategoryList,
  CatalogCategoryOptions,
  CatalogCategoryUpdateInput,
  CatalogCategoryOption,
} from "@aaraj/contracts";
import {
  API_V1_BASE_PATH,
  CATALOG_CATEGORY_SLUG_MAX_LENGTH,
  CatalogCategoryImageSchema,
  MAX_CATALOG_MEDIA_DERIVATIVE_BYTES,
} from "@aaraj/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { R2Storage } from "../platform/storage/r2-storage.js";
import { invalidatePublishedFilterOptionsCache } from "./published-filter-cache.js";
import {
  catalogProduct,
  catalogSizeGuide,
  catalogCategory,
} from "./catalog-schema.js";
import { CatalogPolicy } from "./catalog.policy.js";
import {
  processCatalogImage,
  InvalidCatalogImageError,
} from "./media/catalog-image-processor.js";
import { isCategoryOrDescendant } from "./catalog-category.helpers.js";
import { findAvailableCatalogSlug } from "./catalog-slug.js";
import {
  validateCatalogImageUpload,
  type CatalogMediaUploadFile,
} from "./media/catalog-image-upload.js";

@Injectable()
export class CategoryService {
  private readonly logger = new Logger(CategoryService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly storage: R2Storage,
  ) {}

  async uploadImage(
    actor: AccessPrincipal,
    categoryId: string,
    file: CatalogMediaUploadFile | undefined,
  ): Promise<void> {
    await this.authorization.authorize(
      CatalogPolicy,
      "manageCategories",
      actor,
    );
    const [category] = await this.database.db
      .select({ id: catalogCategory.id })
      .from(catalogCategory)
      .where(eq(catalogCategory.id, categoryId))
      .limit(1);
    if (!category) throw new NotFoundException("Category not found");
    const image = await validateCatalogImageUpload(file);
    let processed: Awaited<ReturnType<typeof processCatalogImage>>;
    try {
      processed = await processCatalogImage(image.buffer, image.contentType, [
        "card",
      ]);
    } catch (error) {
      if (error instanceof InvalidCatalogImageError) {
        throw new BadRequestException(
          "The uploaded category image could not be processed.",
        );
      }
      throw error;
    }
    const card = processed.derivatives[0];
    if (!card) throw new Error("Category image processing returned no image.");
    const objectKey = categoryImageObjectKey(categoryId, card.metadata.sha256);

    try {
      await this.storage.putDerivativeObject({
        key: objectKey,
        body: card.body,
        sha256: card.metadata.sha256,
      });
    } catch (error) {
      this.logger.error("Category image storage request failed", {
        event: "catalog.category_image_storage_failed",
        operation: "put",
        categoryId,
        errorName: error instanceof Error ? error.name : "unknown",
      });
      throw categoryImageStorageUnavailable();
    }

    const result = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manageCategories",
        actor,
        transaction,
      );
      const [current] = await transaction
        .select()
        .from(catalogCategory)
        .where(eq(catalogCategory.id, categoryId))
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundException("Category not found");
      if (current.imageSha256 === card.metadata.sha256) {
        return { changed: false };
      }

      const [next] = await transaction
        .update(catalogCategory)
        .set({
          imageObjectKey: objectKey,
          imageSha256: card.metadata.sha256,
          imageSizeBytes: card.metadata.sizeBytes,
          imageWidth: card.metadata.width,
          imageHeight: card.metadata.height,
          updatedAt: new Date(),
        })
        .where(eq(catalogCategory.id, categoryId))
        .returning();
      if (!next) throw new NotFoundException("Category not found");
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.category_image_updated",
        subjectType: "catalog_category",
        subjectId: next.id,
        metadata: { imageSha256: card.metadata.sha256 },
      });
      return { changed: true };
    });

    if (result.changed) {
      // Keep older content-addressed objects so previously rendered immutable URLs remain valid.
      await invalidatePublishedFilterOptionsCache();
    }
  }

  async getPublicImage(
    categoryId: string,
    sha256: string,
  ): Promise<{ body: Buffer; sizeBytes: number }> {
    const [category] = await this.database.db
      .select({ id: catalogCategory.id })
      .from(catalogCategory)
      .where(eq(catalogCategory.id, categoryId))
      .limit(1);
    if (!category) {
      throw new NotFoundException("Category image not found.");
    }
    try {
      const body = await this.storage.getPublishedObjectByHash({
        key: categoryImageObjectKey(categoryId, sha256),
        sha256,
        maxSizeBytes: MAX_CATALOG_MEDIA_DERIVATIVE_BYTES,
      });
      return { body, sizeBytes: body.byteLength };
    } catch (error) {
      if (isMissingStorageObject(error)) {
        throw new NotFoundException("Category image not found.");
      }
      this.logger.error("Category image storage request failed", {
        event: "catalog.category_image_storage_failed",
        operation: "get",
        categoryId,
        errorName: error instanceof Error ? error.name : "unknown",
      });
      throw categoryImageStorageUnavailable();
    }
  }

  async findActiveIds(
    categoryIds: readonly string[],
    transaction: AuditTransaction,
  ): Promise<ReadonlySet<string>> {
    if (categoryIds.length === 0) return new Set();

    const activeCategories = await transaction
      .select({ id: catalogCategory.id })
      .from(catalogCategory)
      .where(
        and(
          inArray(catalogCategory.id, [...categoryIds]),
          eq(catalogCategory.isActive, true),
        ),
      );
    return new Set(activeCategories.map(({ id }) => id));
  }

  async findActiveNavigationCategories(
    categoryIds: readonly string[],
  ): Promise<Array<Pick<CatalogCategoryOption, "id" | "name" | "slug">>> {
    if (categoryIds.length === 0) return [];

    return this.database.db
      .select({
        id: catalogCategory.id,
        name: catalogCategory.name,
        slug: catalogCategory.slug,
      })
      .from(catalogCategory)
      .where(
        and(
          inArray(catalogCategory.id, [...categoryIds]),
          eq(catalogCategory.isActive, true),
        ),
      );
  }

  async listPublic(): Promise<CatalogCategoryOptions> {
    const rows = await this.database.db.select().from(catalogCategory);
    return {
      categories: toOptions(
        rows.filter((category) => category.isActive),
        rows,
      ),
    };
  }

  async listForManagement(
    actor: AccessPrincipal,
  ): Promise<CatalogCategoryList> {
    await this.authorization.authorize(
      CatalogPolicy,
      "manageCategories",
      actor,
    );
    return this.loadCategoryList();
  }

  async listOptionsForManagement(
    actor: AccessPrincipal,
  ): Promise<CatalogCategoryList> {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    return this.loadCategoryList();
  }

  private async loadCategoryList(): Promise<CatalogCategoryList> {
    const rows = await this.database.db.select().from(catalogCategory);
    return { categories: toCategories(rows) };
  }

  async suggestSlug(actor: AccessPrincipal, name: string) {
    await this.authorization.authorize(
      CatalogPolicy,
      "manageCategories",
      actor,
    );
    const slug = await findAvailableCatalogSlug(name, {
      maxLength: CATALOG_CATEGORY_SLUG_MAX_LENGTH,
      fallback: "category",
      isTaken: async (candidate) => {
        const [existing] = await this.database.db
          .select({ id: catalogCategory.id })
          .from(catalogCategory)
          .where(eq(catalogCategory.slug, candidate))
          .limit(1);
        return Boolean(existing);
      },
    });
    return { slug };
  }

  async create(actor: AccessPrincipal, input: CatalogCategoryCreateInput) {
    const created = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manageCategories",
        actor,
        transaction,
      );
      await transaction.execute(
        sql`LOCK TABLE "catalog"."category" IN SHARE ROW EXCLUSIVE MODE`,
      );
      const categories = await transaction.select().from(catalogCategory);
      if (categories.length >= 500) {
        throw new BadRequestException("The catalog category limit is 500.");
      }
      const parentId = input.parentId ?? null;
      if (parentId) await requireActiveParent(transaction, parentId);
      const slug =
        input.slug ??
        (await findAvailableCatalogSlug(input.name, {
          maxLength: CATALOG_CATEGORY_SLUG_MAX_LENGTH,
          fallback: "category",
          isTaken: async (candidate) =>
            categories.some(
              ({ slug: existingSlug }) => existingSlug === candidate,
            ),
        }));

      try {
        const [category] = await transaction
          .insert(catalogCategory)
          .values({
            name: input.name,
            slug,
            parentId,
          })
          .returning();
        if (!category) throw new Error("Category insert returned no row.");
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "catalog.category_created",
          subjectType: "catalog_category",
          subjectId: category.id,
          reason: input.reason,
          metadata: {
            name: category.name,
            slug: category.slug,
            parentId: category.parentId,
          },
        });
        return toCategories([...categories, category]).find(
          ({ id }) => id === category.id,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException("That category slug is already in use.", {
            errorCode: "CATALOG_CATEGORY_SLUG_TAKEN",
          });
        }
        throw error;
      }
    });
    await invalidatePublishedFilterOptionsCache();
    return created;
  }

  async update(
    actor: AccessPrincipal,
    categoryId: string,
    input: CatalogCategoryUpdateInput,
  ) {
    const updated = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manageCategories",
        actor,
        transaction,
      );
      const [current] = await transaction
        .select()
        .from(catalogCategory)
        .where(eq(catalogCategory.id, categoryId))
        .for("update")
        .limit(1);
      if (!current) throw new NotFoundException("Category not found");

      const categories = await transaction.select().from(catalogCategory);
      const parentId =
        input.parentId === undefined ? current.parentId : input.parentId;
      if (parentId) {
        await requireActiveParent(transaction, parentId);
        ensureNoCycle(categories, current.id, parentId);
      }

      const next = {
        name: input.name ?? current.name,
        slug: input.slug ?? current.slug,
        parentId,
        isActive: input.isActive ?? current.isActive,
      };
      if (current.isActive && !next.isActive) {
        await ensureCategoryCanBeDeactivated(transaction, current.id);
      }
      if (!current.isActive && next.isActive && parentId) {
        await requireActiveParent(transaction, parentId);
      }

      const changed =
        next.name !== current.name ||
        next.slug !== current.slug ||
        next.parentId !== current.parentId ||
        next.isActive !== current.isActive;
      if (!changed)
        return toCategories(categories).find(({ id }) => id === current.id);
      if (next.parentId !== current.parentId) {
        await ensurePublishedSizeGuideAssignmentsRemainValid(
          transaction,
          categories,
          current.id,
          next.parentId,
        );
      }

      try {
        const [updated] = await transaction
          .update(catalogCategory)
          .set({ ...next, updatedAt: new Date() })
          .where(eq(catalogCategory.id, current.id))
          .returning();
        if (!updated) throw new NotFoundException("Category not found");
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: next.isActive
            ? "catalog.category_updated"
            : "catalog.category_deactivated",
          subjectType: "catalog_category",
          subjectId: updated.id,
          reason: input.reason,
          metadata: {
            changedFields: Object.keys(input).filter((key) => key !== "reason"),
            name: updated.name,
            slug: updated.slug,
            parentId: updated.parentId,
            isActive: updated.isActive,
          },
        });
        return toCategories(
          categories.map((category) =>
            category.id === updated.id ? updated : category,
          ),
        ).find(({ id }) => id === updated.id);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException("That category slug is already in use.", {
            errorCode: "CATALOG_CATEGORY_SLUG_TAKEN",
          });
        }
        throw error;
      }
    });
    await invalidatePublishedFilterOptionsCache();
    return updated;
  }
}

type CategoryRow = typeof catalogCategory.$inferSelect;

function toCategories(rows: CategoryRow[]): CatalogCategory[] {
  const options = toOptions(rows);
  const byId = new Map(rows.map((category) => [category.id, category]));
  return options.map((option) => {
    const row = byId.get(option.id)!;
    return {
      ...option,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

function toOptions(
  rows: CategoryRow[],
  hierarchyRows: CategoryRow[] = rows,
): CatalogCategoryOption[] {
  const orderedRows = [...rows].sort(
    (left, right) =>
      left.name.localeCompare(right.name, "en") ||
      left.id.localeCompare(right.id),
  );
  const byId = new Map(orderedRows.map((category) => [category.id, category]));
  const hasChildren = new Set(
    hierarchyRows.flatMap((category) =>
      category.parentId ? [category.parentId] : [],
    ),
  );
  const children = new Map<string | null, CategoryRow[]>();
  for (const row of orderedRows) {
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(row);
    children.set(row.parentId, siblings);
  }

  const options: CatalogCategoryOption[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, parentPath: string[]) => {
    for (const row of children.get(parentId) ?? []) {
      if (visited.has(row.id)) continue;
      visited.add(row.id);
      const path = [...parentPath, row.name];
      options.push({
        id: row.id,
        name: row.name,
        slug: row.slug,
        parentId: row.parentId,
        path: path.join(" / "),
        isLeaf: !hasChildren.has(row.id),
        image: toCategoryImage(row),
      });
      visit(row.id, path);
    }
  };
  visit(null, []);
  for (const row of orderedRows) {
    if (visited.has(row.id)) continue;
    const ancestors: string[] = [];
    const seen = new Set<string>();
    let current: CategoryRow | undefined = row;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      ancestors.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    visited.add(row.id);
    options.push({
      id: row.id,
      name: row.name,
      slug: row.slug,
      parentId: row.parentId,
      path: ancestors.join(" / "),
      isLeaf: !hasChildren.has(row.id),
      image: toCategoryImage(row),
    });
  }
  return options;
}

function toCategoryImage(row: CategoryRow): CatalogCategoryImage | null {
  if (!row.imageSha256 || !row.imageWidth || !row.imageHeight) return null;
  return CatalogCategoryImageSchema.parse({
    src: `${API_V1_BASE_PATH}/catalog/categories/${row.id}/image/${row.imageSha256}.webp`,
    width: row.imageWidth,
    height: row.imageHeight,
  });
}

function categoryImageObjectKey(categoryId: string, sha256: string): string {
  return `published/catalog/categories/${categoryId}/${sha256}.webp`;
}

function categoryImageStorageUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "Category image storage is temporarily unavailable.",
  );
}

function isMissingStorageObject(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "NoSuchKey" || error.name === "NotFound") return true;
  if (!Object.hasOwn(error, "$metadata")) return false;
  const metadata = (
    error as Error & {
      $metadata?: { httpStatusCode?: number };
    }
  ).$metadata;
  return metadata?.httpStatusCode === 404;
}

async function requireActiveParent(
  transaction: AuditTransaction,
  parentId: string,
) {
  const [parent] = await transaction
    .select({ id: catalogCategory.id, isActive: catalogCategory.isActive })
    .from(catalogCategory)
    .where(eq(catalogCategory.id, parentId))
    // Serialize parent changes with product category assignments. Products
    // must remain assigned to leaf categories.
    .for("update")
    .limit(1);
  if (!parent) throw new NotFoundException("Parent category not found");
  if (!parent.isActive) {
    throw new BadRequestException("A category parent must be active.");
  }
  await ensureCategoryCanBeParent(transaction, parentId);
}

function ensureNoCycle(
  categories: CategoryRow[],
  categoryId: string,
  parentId: string,
) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const seen = new Set<string>();
  let currentId: string | null = parentId;
  while (currentId) {
    if (currentId === categoryId) {
      throw new BadRequestException("A category cannot be its own ancestor.");
    }
    if (seen.has(currentId)) {
      throw new BadRequestException("The category hierarchy contains a cycle.");
    }
    seen.add(currentId);
    currentId = byId.get(currentId)?.parentId ?? null;
  }
}

async function ensureCategoryCanBeDeactivated(
  transaction: AuditTransaction,
  categoryId: string,
) {
  const [product] = await transaction
    .select({ id: catalogProduct.id })
    .from(catalogProduct)
    .where(eq(catalogProduct.categoryId, categoryId))
    .limit(1);
  const [guide] = await transaction
    .select({ id: catalogSizeGuide.id })
    .from(catalogSizeGuide)
    .where(eq(catalogSizeGuide.categoryId, categoryId))
    .limit(1);
  const [child] = await transaction
    .select({ id: catalogCategory.id })
    .from(catalogCategory)
    .where(
      and(
        eq(catalogCategory.parentId, categoryId),
        eq(catalogCategory.isActive, true),
      ),
    )
    .limit(1);
  if (product || guide || child) {
    throw new ConflictException(
      "Move its products, size guides, and active child categories before deactivating this category.",
    );
  }
}

async function ensureCategoryCanBeParent(
  transaction: AuditTransaction,
  categoryId: string,
) {
  const [product] = await transaction
    .select({ id: catalogProduct.id })
    .from(catalogProduct)
    .where(eq(catalogProduct.categoryId, categoryId))
    .limit(1);
  if (product) {
    throw new ConflictException(
      "Move its products before adding a child category.",
    );
  }
}

async function ensurePublishedSizeGuideAssignmentsRemainValid(
  transaction: AuditTransaction,
  categories: CategoryRow[],
  movedCategoryId: string,
  nextParentId: string | null,
) {
  const publishedProducts = await transaction
    .select({
      categoryId: catalogProduct.categoryId,
      guideCategoryId: catalogSizeGuide.categoryId,
    })
    .from(catalogProduct)
    .innerJoin(
      catalogSizeGuide,
      eq(catalogSizeGuide.id, catalogProduct.sizeGuideId),
    )
    .where(eq(catalogProduct.isPublished, true));
  const currentParentIds = new Map(
    categories.map(({ id, parentId }) => [id, parentId]),
  );
  const nextParentIds = new Map(currentParentIds);
  nextParentIds.set(movedCategoryId, nextParentId);
  const invalidatesGuide = publishedProducts.some(
    ({ categoryId, guideCategoryId }) =>
      isCategoryOrDescendant(categoryId, movedCategoryId, currentParentIds) &&
      !isCategoryOrDescendant(categoryId, guideCategoryId, nextParentIds),
  );
  if (invalidatesGuide) {
    throw new ConflictException(
      "Move published products to matching size guides before changing this category hierarchy.",
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
