import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import type {
  CatalogProductCreateInput,
  CatalogProductPage,
  CatalogProductListQuery,
  CatalogProductUpdateInput,
} from "@aaraj/contracts";
import { MAX_LIST_OFFSET } from "@aaraj/contracts";
import { and, desc, eq } from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { CatalogPolicy } from "./catalog.policy.js";
import { catalogProduct } from "./catalog-schema.js";

@Injectable()
export class CatalogService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async listPublished(query: CatalogProductListQuery) {
    const rows = await this.database.db
      .select()
      .from(catalogProduct)
      .where(eq(catalogProduct.isPublished, true))
      .orderBy(desc(catalogProduct.updatedAt), desc(catalogProduct.id))
      .limit(query.limit + 1)
      .offset(query.offset);
    return toProductPage(rows, query);
  }

  async findPublished(slug: string) {
    const [product] = await this.database.db
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
    return toProduct(product);
  }

  async listForManagement(
    actor: AccessPrincipal,
    query: CatalogProductListQuery,
  ) {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    const rows = await this.database.db
      .select()
      .from(catalogProduct)
      .orderBy(desc(catalogProduct.updatedAt), desc(catalogProduct.id))
      .limit(query.limit + 1)
      .offset(query.offset);
    return toProductPage(rows, query);
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
        const [product] = await transaction
          .insert(catalogProduct)
          .values({
            slug: input.slug,
            name: input.name,
            description: input.description ?? null,
            isPublished: input.isPublished ?? false,
          })
          .returning();
        if (!product) throw new Error("Product insert returned no row.");
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "catalog.product_created",
          subjectType: "catalog_product",
          subjectId: product.id,
          reason: input.reason,
          metadata: { slug: product.slug, isPublished: product.isPublished },
        });
        return toProduct(product);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            "A product with this slug already exists",
          );
        }
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
        .limit(1);
      if (!current) throw new NotFoundException("Product not found");

      const changes = {
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.isPublished !== undefined
          ? { isPublished: input.isPublished }
          : {}),
        updatedAt: new Date(),
      };
      try {
        const [product] = await transaction
          .update(catalogProduct)
          .set(changes)
          .where(eq(catalogProduct.id, productId))
          .returning();
        if (!product) throw new NotFoundException("Product not found");
        await this.audit.append(transaction, {
          actorType: "user",
          actorId: actor.id,
          eventType: "catalog.product_updated",
          subjectType: "catalog_product",
          subjectId: product.id,
          reason: input.reason,
          metadata: {
            changedFields: Object.keys(changes).filter(
              (key) => key !== "updatedAt",
            ),
          },
        });
        return toProduct(product);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            "A product with this slug already exists",
          );
        }
        throw error;
      }
    });
  }
}

function toProductPage(
  rows: Parameters<typeof toProduct>[0][],
  query: CatalogProductListQuery,
): CatalogProductPage {
  const hasMore = rows.length > query.limit;
  const products = rows.slice(0, query.limit).map(toProduct);
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

function toProduct(product: typeof catalogProduct.$inferSelect) {
  return {
    ...product,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
