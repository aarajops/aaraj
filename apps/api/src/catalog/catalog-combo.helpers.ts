import {
  BadRequestException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  CatalogCombo,
  CatalogComboConfigurationInput,
} from "@aaraj/contracts";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import {
  catalogCombo,
  catalogComboComponent,
  catalogProduct,
  catalogProductVariant,
} from "./catalog-schema.js";
import { inventoryStockBalance } from "../inventory/inventory-schema.js";

export async function validateComboConfiguration(
  transaction: AuditTransaction,
  comboProductId: string,
  input: CatalogComboConfigurationInput,
): Promise<void> {
  const productIds = input.components.map(({ productId }) => productId);
  const products = await transaction
    .select({
      id: catalogProduct.id,
      name: catalogProduct.name,
      productType: catalogProduct.productType,
    })
    .from(catalogProduct)
    .where(inArray(catalogProduct.id, productIds));
  const productById = new Map(products.map((product) => [product.id, product]));
  const variantsByProduct = await loadComponentVariantRows(
    transaction,
    productIds,
  );

  for (const [index, component] of input.components.entries()) {
    if (component.productId === comboProductId) {
      throw new BadRequestException("A combo cannot contain itself.");
    }
    const product = productById.get(component.productId);
    const variants = variantsByProduct.get(component.productId) ?? [];
    if (!product || product.productType !== "single") {
      throw new BadRequestException(
        `Component ${index + 1} must be an existing single product.`,
      );
    }
    if (variants.length === 0) {
      throw new BadRequestException(
        `${product.name} must have at least one active, priced variant.`,
      );
    }
    if (
      input.selectionMode === "fixed_combo" &&
      !variants.some(
        ({ color }) => normalize(color) === normalize(component.fixedColor!),
      )
    ) {
      throw new BadRequestException(
        `The fixed color for ${product.name} has no active variants.`,
      );
    }
  }

  if (input.selectionMode !== "mix_sizes_and_colors") {
    const sharedSizes = input.components.reduce<Set<string> | null>(
      (current, component) => {
        const variants = variantsByProduct
          .get(component.productId)!
          .filter(
            ({ color }) =>
              input.selectionMode !== "fixed_combo" ||
              normalize(color) === normalize(component.fixedColor!),
          );
        const sizes = new Set(
          variants.map(({ sizeLabel }) => normalize(sizeLabel)),
        );
        return current === null
          ? sizes
          : new Set([...current].filter((size) => sizes.has(size)));
      },
      null,
    );
    if (!sharedSizes?.size) {
      throw new BadRequestException(
        "Every combo component must have at least one compatible shared size.",
      );
    }
  }
}

export async function loadCombo(
  transaction: AuditTransaction,
  productId: string,
): Promise<CatalogCombo | null> {
  const combos = await loadCombos(transaction, [productId]);
  return combos.get(productId) ?? null;
}

export async function loadCombos(
  transaction: AuditTransaction,
  productIds: readonly string[],
): Promise<Map<string, CatalogCombo>> {
  if (productIds.length === 0) return new Map();
  const combos = await transaction
    .select({
      productId: catalogCombo.productId,
      revision: catalogCombo.revision,
      selectionMode: catalogCombo.selectionMode,
      priceBdt: catalogCombo.priceBdt,
    })
    .from(catalogCombo)
    .innerJoin(catalogProduct, eq(catalogProduct.id, catalogCombo.productId))
    .where(inArray(catalogCombo.productId, [...productIds]));
  if (combos.length === 0) return new Map();

  const componentRows = await transaction
    .select({
      id: catalogComboComponent.id,
      comboProductId: catalogComboComponent.comboProductId,
      productId: catalogComboComponent.productId,
      productName: catalogProduct.name,
      fixedColor: catalogComboComponent.fixedColor,
      sortOrder: catalogComboComponent.sortOrder,
    })
    .from(catalogComboComponent)
    .innerJoin(
      catalogProduct,
      eq(catalogProduct.id, catalogComboComponent.productId),
    )
    .where(inArray(catalogComboComponent.comboProductId, [...productIds]))
    .orderBy(
      asc(catalogComboComponent.comboProductId),
      asc(catalogComboComponent.sortOrder),
    );
  const variantsByProduct = await loadComponentVariantRows(transaction, [
    ...new Set(componentRows.map(({ productId }) => productId)),
  ]);
  const componentsByCombo = new Map<string, typeof componentRows>();
  for (const component of componentRows) {
    const rows = componentsByCombo.get(component.comboProductId) ?? [];
    rows.push(component);
    componentsByCombo.set(component.comboProductId, rows);
  }
  return new Map(
    combos.map((combo) => [
      combo.productId,
      {
        selectionMode: combo.selectionMode,
        price: { amountBdt: combo.priceBdt },
        revision: combo.revision,
        components: (componentsByCombo.get(combo.productId) ?? []).map(
          (component) => ({
            id: component.id,
            productId: component.productId,
            productName: component.productName,
            fixedColor: component.fixedColor,
            variants: (variantsByProduct.get(component.productId) ?? []).map(
              (variant) => ({
                variantId: variant.id,
                color: variant.color,
                sizeLabel: variant.sizeLabel,
                price: { amountBdt: variant.priceBdt },
                compareAtPrice:
                  variant.compareAtPriceBdt === null
                    ? null
                    : { amountBdt: variant.compareAtPriceBdt },
                inStock: variant.inStock,
              }),
            ),
          }),
        ),
      },
    ]),
  );
}

export function comboHasAvailableSet(combo: CatalogCombo): boolean {
  if (combo.components.some((component) => component.variants.length === 0)) {
    return false;
  }
  if (combo.selectionMode === "mix_sizes_and_colors") {
    return combo.components.every((component) =>
      component.variants.some(({ inStock }) => inStock),
    );
  }
  const sharedSizes = new Set(
    combo.components[0]!.variants.filter(
      (variant) =>
        variant.inStock &&
        (combo.selectionMode !== "fixed_combo" ||
          normalize(variant.color) ===
            normalize(combo.components[0]!.fixedColor!)),
    ).map(({ sizeLabel }) => normalize(sizeLabel)),
  );
  return [...sharedSizes].some((size) =>
    combo.components.every((component) =>
      component.variants.some(
        (variant) =>
          variant.inStock &&
          normalize(variant.sizeLabel) === size &&
          (combo.selectionMode !== "fixed_combo" ||
            normalize(variant.color) === normalize(component.fixedColor!)),
      ),
    ),
  );
}

export function assertComboSelections(
  combo: CatalogCombo,
  selections: readonly { componentId: string; variantId: string }[],
): Array<{ componentId: string; variantId: string }> {
  if (selections.length !== combo.components.length) {
    throw new UnprocessableEntityException(
      "Choose one available variant for every combo component.",
      { errorCode: "COMBO_SELECTION_INCOMPLETE" },
    );
  }
  const selectionByComponent = new Map<string, string>();
  for (const selection of selections) {
    if (selectionByComponent.has(selection.componentId)) {
      throw new UnprocessableEntityException(
        "A combo component can only be selected once.",
        { errorCode: "COMBO_SELECTION_INVALID" },
      );
    }
    selectionByComponent.set(selection.componentId, selection.variantId);
  }
  const selected = combo.components.map((component) => {
    const variantId = selectionByComponent.get(component.id);
    const variant = component.variants.find(
      (candidate) => candidate.variantId === variantId,
    );
    if (!variant || !variant.inStock) {
      throw new UnprocessableEntityException(
        "A selected combo variant is no longer available.",
        { errorCode: "COMBO_VARIANT_UNAVAILABLE" },
      );
    }
    if (
      combo.selectionMode === "fixed_combo" &&
      normalize(variant.color) !== normalize(component.fixedColor!)
    ) {
      throw new UnprocessableEntityException(
        "This combo component has a fixed color.",
        { errorCode: "COMBO_SELECTION_INVALID" },
      );
    }
    return { component, variant };
  });
  if (selectionByComponent.size !== combo.components.length) {
    throw new UnprocessableEntityException(
      "A combo selection contains an unknown component.",
      { errorCode: "COMBO_SELECTION_INVALID" },
    );
  }
  if (combo.selectionMode !== "mix_sizes_and_colors") {
    const sizes = new Set(
      selected.map(({ variant }) => normalize(variant.sizeLabel)),
    );
    if (sizes.size !== 1) {
      throw new UnprocessableEntityException(
        "Choose the same size for every combo component.",
        { errorCode: "COMBO_SIZE_MISMATCH" },
      );
    }
  }
  return combo.components.map((component) => ({
    componentId: component.id,
    variantId: selectionByComponent.get(component.id)!,
  }));
}

async function loadComponentVariantRows(
  transaction: AuditTransaction,
  productIds: string[],
) {
  if (productIds.length === 0) return new Map<string, ComponentVariantRow[]>();
  const rows = await transaction
    .select({
      id: catalogProductVariant.id,
      productId: catalogProductVariant.productId,
      color: catalogProductVariant.color,
      sizeLabel: catalogProductVariant.sizeLabel,
      priceBdt: catalogProductVariant.priceBdt,
      compareAtPriceBdt: catalogProductVariant.compareAtPriceBdt,
      inStock: sql<boolean>`coalesce(${inventoryStockBalance.quantityOnHand}, 0) > coalesce(${inventoryStockBalance.quantityReserved}, 0)`,
    })
    .from(catalogProductVariant)
    .leftJoin(
      inventoryStockBalance,
      eq(inventoryStockBalance.variantId, catalogProductVariant.id),
    )
    .where(
      and(
        inArray(catalogProductVariant.productId, productIds),
        eq(catalogProductVariant.isActive, true),
        sql`${catalogProductVariant.priceBdt} is not null`,
      ),
    )
    .orderBy(
      asc(catalogProductVariant.productId),
      asc(catalogProductVariant.id),
    );
  const byProduct = new Map<string, ComponentVariantRow[]>();
  for (const row of rows) {
    const variants = byProduct.get(row.productId) ?? [];
    variants.push({ ...row, priceBdt: row.priceBdt! });
    byProduct.set(row.productId, variants);
  }
  return byProduct;
}

type ComponentVariantRow = {
  id: string;
  productId: string;
  color: string;
  sizeLabel: string;
  priceBdt: number;
  compareAtPriceBdt: number | null;
  inStock: boolean;
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}
