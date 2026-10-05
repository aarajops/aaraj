import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import type {
  CatalogCategory,
  CatalogCategoryCreateInput,
  CatalogCategoryList,
  CatalogCategoryOptions,
  CatalogCategoryUpdateInput,
  CatalogCategoryOption,
} from "@aaraj/contracts";
import { and, asc, eq } from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { invalidatePublishedFilterOptionsCache } from "./published-filter-cache.js";
import {
  catalogProduct,
  catalogSizeGuide,
  catalogCategory,
} from "./catalog-schema.js";
import { CatalogPolicy } from "./catalog.policy.js";

@Injectable()
export class CategoryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async listPublic(): Promise<CatalogCategoryOptions> {
    const rows = await this.database.db
      .select()
      .from(catalogCategory)
      .orderBy(asc(catalogCategory.sortOrder), asc(catalogCategory.name));
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
    const rows = await this.database.db
      .select()
      .from(catalogCategory)
      .orderBy(asc(catalogCategory.sortOrder), asc(catalogCategory.name));
    return { categories: toCategories(rows) };
  }

  async create(actor: AccessPrincipal, input: CatalogCategoryCreateInput) {
    const created = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manageCategories",
        actor,
        transaction,
      );
      const categories = await transaction.select().from(catalogCategory);
      if (categories.length >= 500) {
        throw new BadRequestException("The catalog category limit is 500.");
      }
      const parentId = input.parentId ?? null;
      if (parentId) await requireActiveParent(transaction, parentId);

      try {
        const [category] = await transaction
          .insert(catalogCategory)
          .values({
            name: input.name,
            slug: input.slug,
            parentId,
            sortOrder: input.sortOrder ?? 0,
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
          throw new ConflictException("That category slug is already in use.");
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
        sortOrder: input.sortOrder ?? current.sortOrder,
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
        next.sortOrder !== current.sortOrder ||
        next.isActive !== current.isActive;
      if (!changed)
        return toCategories(categories).find(({ id }) => id === current.id);

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
          throw new ConflictException("That category slug is already in use.");
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
  const byId = new Map(rows.map((category) => [category.id, category]));
  const hasChildren = new Set(
    hierarchyRows.flatMap((category) =>
      category.parentId ? [category.parentId] : [],
    ),
  );
  const children = new Map<string | null, CategoryRow[]>();
  for (const row of rows) {
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(row);
    children.set(row.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.name.localeCompare(right.name, "en") ||
        left.id.localeCompare(right.id),
    );
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
        sortOrder: row.sortOrder,
        path: path.join(" / "),
        isLeaf: !hasChildren.has(row.id),
      });
      visit(row.id, path);
    }
  };
  visit(null, []);
  // A corrupted legacy cycle should remain visible to operators rather than disappear.
  for (const row of rows) {
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
      sortOrder: row.sortOrder,
      path: ancestors.join(" / "),
      isLeaf: !hasChildren.has(row.id),
    });
  }
  return options;
}

async function requireActiveParent(
  transaction: AuditTransaction,
  parentId: string,
) {
  const [parent] = await transaction
    .select({ id: catalogCategory.id, isActive: catalogCategory.isActive })
    .from(catalogCategory)
    .where(eq(catalogCategory.id, parentId))
    // This conflicts with the row lock taken while assigning products and
    // size guides, keeping the leaf-only assignment rule consistent.
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
  const [guide] = await transaction
    .select({ id: catalogSizeGuide.id })
    .from(catalogSizeGuide)
    .where(eq(catalogSizeGuide.categoryId, categoryId))
    .limit(1);
  if (product || guide) {
    throw new ConflictException(
      "Move its products and size guides before adding a child category.",
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
