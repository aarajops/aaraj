import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import type {
  CatalogCombo,
  CatalogComboConfigurationInput,
  CatalogComboManage,
} from "@aaraj/contracts";
import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { AuditService } from "../platform/audit/audit.service.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import { CatalogPolicy } from "./catalog.policy.js";
import {
  catalogCombo,
  catalogComboComponent,
  catalogProduct,
  catalogProductVariant,
} from "./catalog-schema.js";
import {
  loadCombo,
  validateComboConfiguration,
} from "./catalog-combo.helpers.js";

@Injectable()
export class CatalogComboService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async getForManagement(
    actor: AccessPrincipal,
    productId: string,
  ): Promise<CatalogComboManage | null> {
    return this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      const product = await this.requireComboProduct(transaction, productId);
      const combo = await loadCombo(transaction, productId);
      return combo ? { ...combo, productRevision: product.editRevision } : null;
    });
  }

  async configure(
    actor: AccessPrincipal,
    productId: string,
    input: CatalogComboConfigurationInput,
    expectedProductRevision: number,
  ): Promise<CatalogComboManage> {
    const result = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        CatalogPolicy,
        "manage",
        actor,
        transaction,
      );
      const product = await this.requireComboProduct(
        transaction,
        productId,
        true,
      );
      if (product.editRevision !== expectedProductRevision) {
        throw new PreconditionFailedException(
          "This combo changed after you opened it. Reload the latest version before saving.",
        );
      }
      await validateComboConfiguration(transaction, productId, input);
      const currentCombo = await loadCombo(transaction, productId);
      if (
        currentCombo &&
        currentCombo.selectionMode === input.selectionMode &&
        currentCombo.price.amountBdt === input.price.amountBdt &&
        currentCombo.components.length === input.components.length &&
        currentCombo.components.every((component, index) => {
          const next = input.components[index];
          return (
            component.productId === next?.productId &&
            component.fixedColor === next.fixedColor
          );
        })
      ) {
        return { ...currentCombo, productRevision: product.editRevision };
      }

      await transaction
        .insert(catalogCombo)
        .values({
          productId,
          selectionMode: input.selectionMode,
          priceBdt: input.price.amountBdt,
        })
        .onConflictDoUpdate({
          target: catalogCombo.productId,
          set: {
            selectionMode: input.selectionMode,
            priceBdt: input.price.amountBdt,
            revision: sql`${catalogCombo.revision} + 1`,
            updatedAt: sql`clock_timestamp()`,
          },
        });
      await transaction
        .delete(catalogComboComponent)
        .where(eq(catalogComboComponent.comboProductId, productId));
      await transaction.insert(catalogComboComponent).values(
        input.components.map((component, sortOrder) => ({
          comboProductId: productId,
          productId: component.productId,
          fixedColor: component.fixedColor,
          sortOrder,
        })),
      );
      const [updatedProduct] = await transaction
        .update(catalogProduct)
        .set({
          editRevision: product.editRevision + 1,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(catalogProduct.id, productId),
            eq(catalogProduct.editRevision, expectedProductRevision),
          ),
        )
        .returning({ editRevision: catalogProduct.editRevision });
      if (!updatedProduct) {
        throw new PreconditionFailedException(
          "This combo changed before it could be saved. Reload the latest version.",
        );
      }
      const combo = await loadCombo(transaction, productId);
      if (!combo)
        throw new Error("Combo configuration insert returned no row.");
      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "catalog.combo_configured",
        subjectType: "catalog_product",
        subjectId: productId,
        metadata: {
          selectionMode: input.selectionMode,
          componentProductIds: input.components.map(({ productId: id }) => id),
          priceBdt: input.price.amountBdt,
          productRevision: updatedProduct.editRevision,
        },
      });
      return { ...combo, productRevision: updatedProduct.editRevision };
    });
    return result;
  }

  async listCandidates(actor: AccessPrincipal, search?: string) {
    await this.authorization.authorize(CatalogPolicy, "manage", actor);
    const conditions = [eq(catalogProduct.productType, "single")];
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(ilike(catalogProduct.name, pattern));
    }
    const products = await this.database.db
      .select({ id: catalogProduct.id, name: catalogProduct.name })
      .from(catalogProduct)
      .where(
        and(
          ...conditions,
          sql`exists (
            select 1 from catalog.product_variant v
            where v.product_id = ${catalogProduct.id} and v.is_active = true
          )`,
        ),
      )
      .orderBy(asc(catalogProduct.name))
      .limit(100);
    const productIds = products.map(({ id }) => id);
    const variants = productIds.length
      ? await this.database.db
          .select({
            id: catalogProductVariant.id,
            productId: catalogProductVariant.productId,
            color: catalogProductVariant.color,
            sizeLabel: catalogProductVariant.sizeLabel,
            priceBdt: catalogProductVariant.priceBdt,
          })
          .from(catalogProductVariant)
          .where(
            and(
              inArray(catalogProductVariant.productId, productIds),
              eq(catalogProductVariant.isActive, true),
            ),
          )
          .orderBy(
            asc(catalogProductVariant.productId),
            asc(catalogProductVariant.id),
          )
      : [];
    const variantsByProduct = new Map<string, typeof variants>();
    for (const variant of variants) {
      const rows = variantsByProduct.get(variant.productId) ?? [];
      rows.push(variant);
      variantsByProduct.set(variant.productId, rows);
    }
    return products.map((product) => ({
      ...product,
      variants: (variantsByProduct.get(product.id) ?? []).map((variant) => ({
        id: variant.id,
        color: variant.color,
        sizeLabel: variant.sizeLabel,
        price:
          variant.priceBdt === null ? null : { amountBdt: variant.priceBdt },
      })),
    }));
  }

  async getPublished(productId: string): Promise<CatalogCombo> {
    return this.database.db.transaction(async (transaction) => {
      const [product] = await transaction
        .select({
          id: catalogProduct.id,
          isPublished: catalogProduct.isPublished,
        })
        .from(catalogProduct)
        .where(eq(catalogProduct.id, productId))
        .limit(1);
      if (!product?.isPublished)
        throw new NotFoundException("Combo not found.");
      const combo = await loadCombo(transaction, productId);
      if (!combo) throw new NotFoundException("Combo not found.");
      return combo;
    });
  }

  private async requireComboProduct(
    transaction: AuditTransaction,
    productId: string,
    lock = false,
  ) {
    const [product] = lock
      ? await transaction
          .select()
          .from(catalogProduct)
          .where(eq(catalogProduct.id, productId))
          .for("update")
          .limit(1)
      : await transaction
          .select()
          .from(catalogProduct)
          .where(eq(catalogProduct.id, productId))
          .limit(1);
    if (!product) throw new NotFoundException("Product not found.");
    if (product.productType !== "combo") {
      throw new BadRequestException("This product is not a combo.");
    }
    return product;
  }
}
