import {
  BadRequestException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  CatalogCombo,
  CatalogComboConfigurationInput,
} from "@aaraj/contracts";
import { MAX_CART_QUANTITY_PER_VARIANT } from "@aaraj/contracts";
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
  if (
    input.selectionMode === "fixed_combo" &&
    input.itemCount !== input.components.length
  ) {
    throw new BadRequestException(
      "A fixed combo must include every product listed in it.",
    );
  }
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

  if (input.selectionMode === "fixed_combo") {
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
        "Every fixed combo product must have at least one shared size.",
      );
    }
  } else if (
    !input.components.some(
      (component) =>
        (variantsByProduct.get(component.productId) ?? []).length > 0,
    )
  ) {
    throw new BadRequestException(
      "Add at least one product with a priced variant to this combo.",
    );
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
      itemCount: catalogCombo.itemCount,
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
        itemCount: combo.itemCount,
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
                availableQuantity: variant.availableQuantity,
              }),
            ),
          }),
        ),
      },
    ]),
  );
}

export function comboHasAvailableSet(combo: CatalogCombo): boolean {
  if (combo.selectionMode === "fixed_combo") {
    const sharedSizes = new Set(
      combo.components[0]?.variants
        .filter(
          (variant) =>
            variant.availableQuantity > 0 &&
            normalize(variant.color) ===
              normalize(combo.components[0]!.fixedColor!),
        )
        .map(({ sizeLabel }) => normalize(sizeLabel)) ?? [],
    );
    return [...sharedSizes].some((size) =>
      combo.components.every((component) =>
        component.variants.some(
          (variant) =>
            variant.availableQuantity > 0 &&
            normalize(variant.sizeLabel) === size &&
            normalize(variant.color) === normalize(component.fixedColor!),
        ),
      ),
    );
  }
  if (combo.selectionMode === "mix_sizes_and_colors") {
    return (
      combo.components.reduce(
        (total, component) =>
          total +
          component.variants.reduce(
            (sum, variant) => sum + variant.availableQuantity,
            0,
          ),
        0,
      ) >= combo.itemCount
    );
  }
  const availableBySize = new Map<string, number>();
  for (const component of combo.components) {
    for (const variant of component.variants) {
      const size = normalize(variant.sizeLabel);
      availableBySize.set(
        size,
        (availableBySize.get(size) ?? 0) + variant.availableQuantity,
      );
    }
  }
  return [...availableBySize.values()].some(
    (quantity) => quantity >= combo.itemCount,
  );
}

export function limitComboAvailabilityForStorefront(
  combo: CatalogCombo,
): CatalogCombo {
  return {
    ...combo,
    components: combo.components.map((component) => ({
      ...component,
      variants: component.variants.map((variant) => ({
        ...variant,
        availableQuantity: Math.min(variant.availableQuantity, combo.itemCount),
      })),
    })),
  };
}

export function assertComboSelections(
  combo: CatalogCombo,
  selections: readonly { componentId: string; variantId: string }[],
  comboQuantity = 1,
): Array<{ componentId: string; selectionIndex: number; variantId: string }> {
  if (selections.length !== combo.itemCount) {
    throw new UnprocessableEntityException(
      `Choose exactly ${combo.itemCount} items for this combo.`,
      { errorCode: "COMBO_SELECTION_INCOMPLETE" },
    );
  }
  const selectedPerComponent = new Map<string, number>();
  const selected = selections.map((selection, selectionIndex) => {
    const component = combo.components.find(
      ({ id }) => id === selection.componentId,
    );
    if (!component) {
      throw new UnprocessableEntityException(
        "Choose products that are included in this combo.",
        { errorCode: "COMBO_SELECTION_INVALID" },
      );
    }
    const variant = component.variants.find(
      (candidate) => candidate.variantId === selection.variantId,
    );
    if (!variant || variant.availableQuantity < comboQuantity) {
      throw new UnprocessableEntityException(
        "A selected combo variant is no longer available.",
        { errorCode: "COMBO_VARIANT_UNAVAILABLE" },
      );
    }
    selectedPerComponent.set(
      component.id,
      (selectedPerComponent.get(component.id) ?? 0) + 1,
    );
    if (
      combo.selectionMode === "fixed_combo" &&
      normalize(variant.color) !== normalize(component.fixedColor!)
    ) {
      throw new UnprocessableEntityException(
        "This combo component has a fixed color.",
        { errorCode: "COMBO_SELECTION_INVALID" },
      );
    }
    return { component, variant, selectionIndex };
  });
  if (combo.selectionMode === "fixed_combo") {
    if (
      selectedPerComponent.size !== combo.components.length ||
      combo.components.some(
        (component) => selectedPerComponent.get(component.id) !== 1,
      )
    ) {
      throw new UnprocessableEntityException(
        "Choose each fixed combo product exactly once.",
        { errorCode: "COMBO_SELECTION_INVALID" },
      );
    }
  } else {
    const selectedQuantityByVariant = new Map<string, number>();
    for (const { variant } of selected) {
      selectedQuantityByVariant.set(
        variant.variantId,
        (selectedQuantityByVariant.get(variant.variantId) ?? 0) + 1,
      );
    }
    if (
      [...selectedQuantityByVariant].some(
        ([variantId, quantity]) =>
          quantity * comboQuantity > MAX_CART_QUANTITY_PER_VARIANT ||
          quantity * comboQuantity >
            selected.find(({ variant }) => variant.variantId === variantId)!
              .variant.availableQuantity,
      )
    ) {
      throw new UnprocessableEntityException(
        "The selected quantities exceed available stock.",
        { errorCode: "COMBO_VARIANT_UNAVAILABLE" },
      );
    }
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
  return selected.map(({ component, variant, selectionIndex }) => ({
    componentId: component.id,
    selectionIndex,
    variantId: variant.variantId,
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
      availableQuantity: sql<number>`greatest(coalesce(${inventoryStockBalance.quantityOnHand}, 0) - coalesce(${inventoryStockBalance.quantityReserved}, 0), 0)`,
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
    variants.push({
      ...row,
      priceBdt: row.priceBdt!,
      inStock: row.availableQuantity > 0,
    });
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
  availableQuantity: number;
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}
