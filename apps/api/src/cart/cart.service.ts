import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  CART_CURRENCY,
  CART_SCHEMA_VERSION,
  CartComboLineSchema,
  CartProductSnapshotSchema,
  CartSchema,
  MAX_CART_LINES,
  MAX_CART_QUANTITY_PER_VARIANT,
  type Cart,
  type CartAddComboInput,
  type CartComboLine,
  type CartMergeResult,
  type CartProductSnapshot,
  type CartRevisionQuery,
  type CartSetLineInput,
} from "@aaraj/contracts";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CATALOG_CART_PORT,
  type CatalogCartPort,
  type CatalogCartVariant,
  type PurchasableCatalogVariant,
  type PurchasableCatalogCombo,
} from "../catalog/catalog-cart.port.js";
import { assertComboSelections } from "../catalog/catalog-combo.helpers.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { getRedisClient } from "../platform/redis/redis-client.js";
import { lockCartOwner } from "./cart-owner-lock.js";
import {
  customerCart,
  customerCartLine,
  customerCartComboLine,
  guestCartRevisionReceipt,
} from "./cart-schema.js";
import {
  GUEST_CART_CHECKOUT_TOMBSTONE_TTL_SECONDS,
  GUEST_CART_TTL_SECONDS,
  parseGuestCartId,
} from "./cart-cookie.js";

const CartStoredProductSnapshotSchema = z.object(
  CartProductSnapshotSchema.shape,
);
const CartStoredLineSchema = z.strictObject({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_CART_QUANTITY_PER_VARIANT),
  product: CartStoredProductSnapshotSchema,
});
const CartStoredStateSchema = z.strictObject({
  schemaVersion: z.literal(CART_SCHEMA_VERSION),
  currency: z.literal(CART_CURRENCY),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  lines: z.array(CartStoredLineSchema).max(MAX_CART_LINES),
  combos: z
    .array(CartComboLineSchema.omit({ availability: true, image: true }))
    .max(MAX_CART_LINES)
    .default([]),
});
const CartStoredComboLineSchema = CartComboLineSchema.omit({
  availability: true,
  image: true,
});
type CartStoredLine = z.infer<typeof CartStoredLineSchema>;
type CartStoredComboLine = z.infer<typeof CartStoredComboLineSchema>;
type CartStoredState = z.infer<typeof CartStoredStateSchema>;
type CartAvailabilityVariant = Pick<CatalogCartVariant, "variantId"> &
  Partial<Pick<CatalogCartVariant, "inStock">> &
  Partial<Pick<CatalogCartVariant, "image">>;
type CustomerCartHeader = Pick<
  typeof customerCart.$inferSelect,
  "id" | "currency" | "schemaVersion" | "revision"
>;

export type CartQuoteOwner =
  | { kind: "customer"; customerId: string }
  | { kind: "guest"; guestCartHash: string };

export type CartQuoteContext = {
  cart: Cart;
  catalogVariants: readonly PurchasableCatalogVariant[];
  catalogCombos: readonly PurchasableCatalogCombo[];
  owner: CartQuoteOwner | null;
};

const EMPTY_CART: CartStoredState = {
  schemaVersion: CART_SCHEMA_VERSION,
  currency: CART_CURRENCY,
  revision: 0,
  lines: [],
  combos: [],
};

const GUEST_CART_MUTATION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local expected = tonumber(ARGV[1])
if raw then
  local ok, current = pcall(cjson.decode, raw)
  if not ok or type(current) ~= 'table' or current.schemaVersion ~= 1 or type(current.revision) ~= 'number' then
    return { 'CORRUPT', '' }
  end
  if current.revision ~= expected then
    return { 'STALE', tostring(current.revision) }
  end
elseif expected ~= 0 then
  return { 'STALE', '0' }
end
redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[2])
return { 'OK', '' }
`;

const GUEST_CART_COMPARE_AND_DELETE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 1 end
local ok, current = pcall(cjson.decode, raw)
if not ok or type(current) ~= 'table' or current.schemaVersion ~= 1 or type(current.revision) ~= 'number' then
  return 0
end
if current.revision ~= tonumber(ARGV[1]) then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

const GUEST_CART_CHECKOUT_CLEAR_SCRIPT = `
local expected = tonumber(ARGV[1])
if not expected or expected < 0 or expected >= 9007199254740991
  or expected ~= math.floor(expected) then return 'CHANGED' end
local raw = redis.call('GET', KEYS[1])
if raw then
  local ok, current = pcall(cjson.decode, raw)
  if not ok or type(current) ~= 'table' or current.schemaVersion ~= 1
    or type(current.revision) ~= 'number' or current.revision ~= expected then
    return 'CHANGED'
  end
end
local revision = expected + 1
local state = '{"schemaVersion":1,"currency":"${CART_CURRENCY}","revision":'
  .. string.format('%.0f', revision) .. ',"lines":[]}'
redis.call('SET', KEYS[1], state, 'EX', ARGV[2])
return 'CLEARED'
`;

const GUEST_CART_CLEAR_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local revision = 1
if raw then
  local ok, current = pcall(cjson.decode, raw)
  if ok and type(current) == 'table' and type(current.revision) == 'number'
    and current.revision >= 0 and current.revision <= 9007199254740991
    and current.revision == math.floor(current.revision) then
    if current.revision >= 9007199254740991 then return { 'REVISION_EXHAUSTED', '' } end
    revision = current.revision + 1
  end
end
local state = '{"schemaVersion":1,"currency":"${CART_CURRENCY}","revision":' .. string.format('%.0f', revision) .. ',"lines":[]}'
redis.call('SET', KEYS[1], state, 'EX', ARGV[1])
return { 'OK', tostring(revision) }
`;

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly database: DatabaseService,
    @Inject(CATALOG_CART_PORT) private readonly catalog: CatalogCartPort,
  ) {}

  async getCart(
    customerId: string | undefined,
    guestCartId: string | undefined,
  ): Promise<Cart> {
    if (customerId) return this.getCustomerCart(customerId);
    const id = parseGuestCartId(guestCartId);
    if (!id) return this.toCart(EMPTY_CART);
    const state = await this.readGuestState(id);
    return this.toCart(state ?? EMPTY_CART);
  }

  async getQuoteContext(
    customerId: string | undefined,
    guestCartId: string | undefined,
  ): Promise<CartQuoteContext> {
    const owner = this.identifyQuoteOwner(customerId, guestCartId);
    if (owner?.kind === "customer") {
      const state = await this.getCustomerCartState(owner.customerId);
      const variantIds = cartVariantIds(state);
      const catalogVariants =
        await this.catalog.findPurchasableVariants(variantIds);
      const catalogCombos = await this.catalog.findPurchasableCombos(
        state.combos.map(({ productId }) => productId),
      );
      return {
        cart: this.toCartFromVariants(state, catalogVariants, catalogCombos),
        catalogVariants,
        catalogCombos,
        owner,
      };
    }
    const id = parseGuestCartId(guestCartId);
    if (!id || !owner) {
      const catalogVariants: PurchasableCatalogVariant[] = [];
      return {
        cart: this.toCartFromVariants(EMPTY_CART, catalogVariants),
        catalogVariants,
        catalogCombos: [],
        owner: null,
      };
    }
    const state = (await this.readGuestState(id)) ?? EMPTY_CART;
    const variantIds = cartVariantIds(state);
    const catalogVariants =
      await this.catalog.findPurchasableVariants(variantIds);
    const catalogCombos = await this.catalog.findPurchasableCombos(
      state.combos.map(({ productId }) => productId),
    );
    return {
      cart: this.toCartFromVariants(state, catalogVariants, catalogCombos),
      catalogVariants,
      catalogCombos,
      owner,
    };
  }

  identifyQuoteOwner(
    customerId: string | undefined,
    guestCartId: string | undefined,
  ): CartQuoteOwner | null {
    if (customerId) return { kind: "customer", customerId };
    const id = parseGuestCartId(guestCartId);
    return id
      ? {
          kind: "guest",
          guestCartHash: createHash("sha256").update(id).digest("hex"),
        }
      : null;
  }

  async clearCart(
    customerId: string | undefined,
    guestCartId: string | undefined,
  ): Promise<Cart> {
    if (customerId) {
      const state = await this.clearCustomerCart(customerId);
      return this.toCart(state);
    }

    const id = parseGuestCartId(guestCartId);
    if (!id) return this.toCart(EMPTY_CART);

    const state = await this.withGuestCartOwnerLock(id, () =>
      this.clearGuestCartState(id),
    );
    return this.toCart(state);
  }

  async clearGuestCartForMergeResolution(
    guestCartId: string | undefined,
  ): Promise<Cart> {
    const id = parseGuestCartId(guestCartId);
    if (!id) return this.toCart(EMPTY_CART);
    const state = await this.withGuestCartOwnerLock(id, () =>
      this.clearGuestCartState(id),
    );
    return this.toCart(state);
  }

  /** Called inside the checkout transaction while the shared guest-owner lock is held. */
  async hasGuestRevisionReceipt(
    guestCartHash: string,
    revision: number,
    transaction?: AuditTransaction,
  ): Promise<boolean> {
    const database = transaction ?? this.database.db;
    const [receipt] = await database
      .select({ guestRevision: guestCartRevisionReceipt.guestRevision })
      .from(guestCartRevisionReceipt)
      .where(
        and(
          eq(guestCartRevisionReceipt.guestCartHash, guestCartHash),
          eq(guestCartRevisionReceipt.guestRevision, revision),
        ),
      )
      .limit(1);
    return Boolean(receipt);
  }

  async findGuestRevisionReceiptKeys(
    revisions: readonly { guestCartHash: string; revision: number }[],
  ): Promise<Set<string>> {
    if (revisions.length === 0) return new Set();
    const rows = await this.database.db
      .select({
        guestCartHash: guestCartRevisionReceipt.guestCartHash,
        revision: guestCartRevisionReceipt.guestRevision,
      })
      .from(guestCartRevisionReceipt)
      .where(
        or(
          ...revisions.map(({ guestCartHash, revision }) =>
            and(
              eq(guestCartRevisionReceipt.guestCartHash, guestCartHash),
              eq(guestCartRevisionReceipt.guestRevision, revision),
            ),
          ),
        ),
      );
    return new Set(
      rows.map(({ guestCartHash, revision }) => `${guestCartHash}:${revision}`),
    );
  }

  /** Called inside the checkout transaction while the shared guest-owner lock is held. */
  async claimGuestCartRevisionForCheckout(
    transaction: AuditTransaction,
    guestCartId: string | undefined,
    guestCartHash: string,
    expectedRevision: number,
  ): Promise<void> {
    const id = parseGuestCartId(guestCartId);
    if (!id)
      throw new ConflictException("The guest cart is no longer available.");
    const state = await this.readGuestState(id);
    if ((state ?? EMPTY_CART).revision !== expectedRevision) {
      throw new ConflictException(
        "The cart changed during checkout. Request a fresh quote.",
        { errorCode: "CART_REVISION_STALE" },
      );
    }
    const [receipt] = await transaction
      .select({ guestRevision: guestCartRevisionReceipt.guestRevision })
      .from(guestCartRevisionReceipt)
      .where(
        and(
          eq(guestCartRevisionReceipt.guestCartHash, guestCartHash),
          eq(guestCartRevisionReceipt.guestRevision, expectedRevision),
        ),
      )
      .limit(1);
    if (receipt) {
      throw new ConflictException(
        "This guest cart revision has already been used. Refresh the cart before checking out.",
        { errorCode: "CART_REVISION_ALREADY_CONSUMED" },
      );
    }
    await transaction.insert(guestCartRevisionReceipt).values({
      guestCartHash,
      guestRevision: expectedRevision,
    });
  }

  /** Staff-assisted checkout may use a saved cart after its Redis TTL has elapsed. */
  async claimGuestDraftRevisionForCheckout(
    transaction: AuditTransaction,
    guestCartId: string | undefined,
    guestCartHash: string,
    expectedRevision: number,
  ): Promise<void> {
    const id = parseGuestCartId(guestCartId);
    if (
      !id ||
      createHash("sha256").update(id).digest("hex") !== guestCartHash
    ) {
      throw new ConflictException("The guest cart identity is invalid.");
    }
    const state = await this.readGuestState(id);
    if (state && state.revision !== expectedRevision) {
      throw new ConflictException(
        "The cart changed after this draft was saved.",
        { errorCode: "DRAFT_CART_CHANGED" },
      );
    }
    if (
      await this.hasGuestRevisionReceipt(
        guestCartHash,
        expectedRevision,
        transaction,
      )
    ) {
      throw new ConflictException("This cart was already used.", {
        errorCode: "DRAFT_CART_CONSUMED",
      });
    }
    await transaction.insert(guestCartRevisionReceipt).values({
      guestCartHash,
      guestRevision: expectedRevision,
    });
  }

  async clearCustomerCartForCheckout(
    transaction: AuditTransaction,
    customerId: string,
    expectedRevision: number,
  ): Promise<boolean> {
    const [row] = await transaction
      .select({ id: customerCart.id, revision: customerCart.revision })
      .from(customerCart)
      .where(eq(customerCart.customerId, customerId))
      .for("update")
      .limit(1);
    if (!row || row.revision !== expectedRevision) return false;
    const removedLines = await transaction
      .delete(customerCartLine)
      .where(eq(customerCartLine.cartId, row.id))
      .returning({ id: customerCartLine.id });
    const removedCombos = await transaction
      .delete(customerCartComboLine)
      .where(eq(customerCartComboLine.cartId, row.id))
      .returning({ id: customerCartComboLine.id });
    if (removedLines.length + removedCombos.length === 0) return false;
    await transaction
      .update(customerCart)
      .set({ revision: incrementRevision(row.revision), updatedAt: new Date() })
      .where(eq(customerCart.id, row.id));
    return true;
  }

  async clearGuestCartAfterCheckout(
    guestCartId: string | undefined,
    expectedRevision: number,
  ): Promise<"cleared" | "changed" | "unavailable"> {
    const id = parseGuestCartId(guestCartId);
    if (!id) return "changed";
    try {
      const result = await getRedisClient().eval(
        GUEST_CART_CHECKOUT_CLEAR_SCRIPT,
        1,
        this.guestKey(id),
        String(expectedRevision),
        String(GUEST_CART_CHECKOUT_TOMBSTONE_TTL_SECONDS),
      );
      return result === "CLEARED" ? "cleared" : "changed";
    } catch {
      this.logger.warn("Guest cart checkout cleanup could not reach Redis.");
      return "unavailable";
    }
  }

  private async clearGuestCartState(id: string): Promise<CartStoredState> {
    try {
      const result = (await getRedisClient().eval(
        GUEST_CART_CLEAR_SCRIPT,
        1,
        this.guestKey(id),
        String(GUEST_CART_TTL_SECONDS),
      )) as [string, string];
      if (result[0] === "REVISION_EXHAUSTED") {
        throw cartLimitConflict(
          "The cart revision cannot be advanced further.",
        );
      }
      if (result[0] !== "OK") {
        throw new Error("Unexpected Redis cart clear response.");
      }
      return { ...EMPTY_CART, revision: Number(result[1]) };
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        "Guest cart storage is temporarily unavailable.",
        { errorCode: "CART_STORAGE_UNAVAILABLE" },
      );
    }
  }

  async setLine(
    customerId: string | undefined,
    guestCartId: string | undefined,
    variantId: string,
    input: CartSetLineInput,
  ): Promise<{ cart: Cart; guestCartId: string | null }> {
    const variant = await this.catalog.findPurchasableVariants([variantId]);
    const resolved = variant.find((item) => item.variantId === variantId);
    if (!resolved) throw new NotFoundException("Product variant not found.");
    const line: CartStoredLine = {
      variantId,
      quantity: input.quantity,
      product: toProductSnapshot(resolved),
    };

    if (customerId) {
      const state = await this.setCustomerLine(
        customerId,
        input.revision,
        line,
      );
      return { cart: await this.toCart(state), guestCartId: null };
    }

    let id = parseGuestCartId(guestCartId);
    if (!id) {
      if (input.revision !== 0) throw staleRevision(0);
      id = randomBytes(32).toString("base64url");
    }
    const next = await this.withGuestCartOwnerLock(id, async () => {
      const state = await this.readGuestState(id);
      const updated = setStoredLine(state ?? EMPTY_CART, input.revision, line);
      await this.writeGuestState(id, input.revision, updated);
      return updated;
    });
    return { cart: await this.toCart(next), guestCartId: id };
  }

  async addCombo(
    customerId: string | undefined,
    guestCartId: string | undefined,
    input: CartAddComboInput,
  ): Promise<{ cart: Cart; guestCartId?: string }> {
    const [combo] = await this.catalog.findPurchasableCombos([input.productId]);
    if (!combo) throw new NotFoundException("Combo not found.");
    if (combo.revision !== input.comboRevision) {
      throw new ConflictException(
        "This combo changed. Choose its options again.",
        {
          errorCode: "COMBO_CHANGED",
        },
      );
    }
    const selections = assertComboSelections(
      combo.combo,
      input.selections,
      input.quantity,
    );
    const selectionsSnapshot = selections.map((selection) => {
      const component = combo.combo.components.find(
        ({ id }) => id === selection.componentId,
      )!;
      const variant = component.variants.find(
        ({ variantId }) => variantId === selection.variantId,
      )!;
      return {
        componentId: component.id,
        selectionIndex: selection.selectionIndex,
        variantId: variant.variantId,
        productName: component.productName,
        color: variant.color,
        sizeLabel: variant.sizeLabel,
        unitPriceBdt: variant.price.amountBdt,
        compareAtPriceBdt: variant.compareAtPrice?.amountBdt ?? null,
      };
    });
    const line: CartStoredComboLine = {
      lineId: randomUUID(),
      productId: combo.productId,
      comboRevision: combo.revision,
      quantity: input.quantity,
      slug: combo.slug,
      name: combo.name,
      unitPriceBdt: combo.priceBdt,
      selections: selectionsSnapshot,
    };
    const configurationHash = comboConfigurationHash(line);
    if (customerId) {
      const state = await this.setCustomerComboLine(
        customerId,
        input.revision,
        line,
        configurationHash,
      );
      return { cart: await this.toCart(state) };
    }
    const id =
      parseGuestCartId(guestCartId) ?? randomBytes(32).toString("base64url");
    const state = await this.withGuestCartOwnerLock(id, async () => {
      const current = (await this.readGuestState(id)) ?? EMPTY_CART;
      const updated = addStoredComboLine(
        current,
        input.revision,
        line,
        configurationHash,
      );
      await this.writeGuestState(id, input.revision, updated);
      return updated;
    });
    return { cart: await this.toCart(state), guestCartId: id };
  }

  async setComboQuantity(
    customerId: string | undefined,
    guestCartId: string | undefined,
    lineId: string,
    input: CartSetLineInput,
  ): Promise<{ cart: Cart; guestCartId?: string }> {
    if (customerId) {
      const state = await this.setCustomerComboQuantity(
        customerId,
        lineId,
        input.revision,
        input.quantity,
      );
      return { cart: await this.toCart(state) };
    }
    const id = parseGuestCartId(guestCartId);
    if (!id) throw new NotFoundException("Combo cart line not found.");
    const state = await this.withGuestCartOwnerLock(id, async () => {
      const current = await this.readGuestState(id);
      if (!current) throw new NotFoundException("Combo cart line not found.");
      const updated = setStoredComboQuantity(
        current,
        lineId,
        input.revision,
        input.quantity,
      );
      await this.writeGuestState(id, input.revision, updated);
      return updated;
    });
    return { cart: await this.toCart(state), guestCartId: id };
  }

  async removeCombo(
    customerId: string | undefined,
    guestCartId: string | undefined,
    lineId: string,
    input: CartRevisionQuery,
  ): Promise<{ cart: Cart; guestCartId?: string }> {
    if (customerId) {
      const state = await this.removeCustomerComboLine(
        customerId,
        lineId,
        input.revision,
      );
      return { cart: await this.toCart(state) };
    }
    const id = parseGuestCartId(guestCartId);
    if (!id) return { cart: await this.toCart(EMPTY_CART) };
    const state = await this.withGuestCartOwnerLock(id, async () => {
      const current = (await this.readGuestState(id)) ?? EMPTY_CART;
      const updated = removeStoredComboLine(current, lineId, input.revision);
      await this.writeGuestState(id, input.revision, updated);
      return updated;
    });
    return { cart: await this.toCart(state), guestCartId: id };
  }

  async removeLine(
    customerId: string | undefined,
    guestCartId: string | undefined,
    variantId: string,
    input: CartRevisionQuery,
  ): Promise<{ cart: Cart; guestCartId: string | null }> {
    if (customerId) {
      const state = await this.removeCustomerLine(
        customerId,
        variantId,
        input.revision,
      );
      return { cart: await this.toCart(state), guestCartId: null };
    }

    const id = parseGuestCartId(guestCartId);
    if (!id) {
      if (input.revision !== 0) throw staleRevision(0);
      return { cart: await this.toCart(EMPTY_CART), guestCartId: null };
    }
    const next = await this.withGuestCartOwnerLock(id, async () => {
      const state = await this.readGuestState(id);
      if (!state) {
        if (input.revision !== 0) throw staleRevision(0);
        return EMPTY_CART;
      }
      const updated = removeStoredLine(state, variantId, input.revision);
      await this.writeGuestState(id, input.revision, updated);
      return updated;
    });
    return { cart: await this.toCart(next), guestCartId: id };
  }

  async mergeGuestCart(
    customerId: string,
    guestCartId: string | undefined,
  ): Promise<CartMergeResult> {
    const id = parseGuestCartId(guestCartId);
    if (!id) {
      return {
        cart: await this.getCustomerCart(customerId),
        guestCartCleanupPending: false,
      };
    }
    const guest = await this.readGuestState(id);
    if (!guest) {
      return {
        cart: await this.getCustomerCart(customerId),
        guestCartCleanupPending: !(await this.deleteGuestState(id, 0)),
      };
    }

    const snapshots = await this.catalog.findPurchasableVariants(
      guest.lines.map(({ variantId }) => variantId),
    );
    const currentProducts = new Map(
      snapshots.map((variant) => [
        variant.variantId,
        toProductSnapshot(variant),
      ]),
    );
    const hasUnavailableVariant = currentProducts.size !== guest.lines.length;
    const guestComboInfo = await this.catalog.findPurchasableCombos(
      guest.combos.map(({ productId }) => productId),
    );
    const guestComboByProductId = new Map(
      guestComboInfo.map((combo) => [combo.productId, combo]),
    );
    const refreshedGuestCombos = guest.combos.map((line) => {
      const current = guestComboByProductId.get(line.productId);
      if (!current || current.revision !== line.comboRevision) {
        throw new ConflictException(
          "The guest cart contains a combo that changed. Review it before merging.",
          { errorCode: "CART_COMBO_UNAVAILABLE" },
        );
      }
      const selections = assertComboSelections(
        current.combo,
        line.selections,
        line.quantity,
      );
      return {
        ...line,
        slug: current.slug,
        name: current.name,
        unitPriceBdt: current.priceBdt,
        selections: selections.map((selection) => {
          const component = current.combo.components.find(
            ({ id }) => id === selection.componentId,
          )!;
          const variant = component.variants.find(
            ({ variantId }) => variantId === selection.variantId,
          )!;
          return {
            ...selection,
            productName: component.productName,
            color: variant.color,
            sizeLabel: variant.sizeLabel,
            unitPriceBdt: variant.price.amountBdt,
            compareAtPriceBdt: variant.compareAtPrice?.amountBdt ?? null,
          };
        }),
      };
    });
    const guestHash = createHash("sha256").update(id).digest("hex");
    let committed: CartStoredState;
    try {
      committed = await this.database.db.transaction(async (transaction) => {
        await lockCartOwner(transaction, "guest", guestHash);
        const cart = await ensureAndLockCustomerCart(transaction, customerId);
        const [receipt] = await transaction
          .select({ guestRevision: guestCartRevisionReceipt.guestRevision })
          .from(guestCartRevisionReceipt)
          .where(
            and(
              eq(guestCartRevisionReceipt.guestCartHash, guestHash),
              eq(guestCartRevisionReceipt.guestRevision, guest.revision),
            ),
          )
          .limit(1);
        const current = await readCustomerCartState(transaction, cart);
        if (receipt) return current;
        const currentGuest = await this.readGuestState(id);
        if (!currentGuest || currentGuest.revision !== guest.revision) {
          throw staleRevision(currentGuest?.revision ?? 0);
        }
        if (hasUnavailableVariant) {
          throw new ConflictException({
            statusCode: 409,
            message:
              "The guest cart contains a variant that is no longer available. Remove it before merging.",
            error: "Conflict",
            errorCode: "CART_VARIANT_UNAVAILABLE",
          });
        }

        const combined = new Map(
          current.lines.map((line) => [line.variantId, line]),
        );
        for (const guestLine of guest.lines) {
          const existing = combined.get(guestLine.variantId);
          const quantity = (existing?.quantity ?? 0) + guestLine.quantity;
          if (quantity > MAX_CART_QUANTITY_PER_VARIANT) {
            throw cartLimitConflict(
              "Combining the carts would exceed the quantity limit for a variant.",
            );
          }
          combined.set(guestLine.variantId, {
            variantId: guestLine.variantId,
            quantity,
            product:
              currentProducts.get(guestLine.variantId) ??
              existing?.product ??
              guestLine.product,
          });
        }
        const combinedCombos = new Map(
          current.combos.map((line) => [comboConfigurationHash(line), line]),
        );
        for (const guestLine of refreshedGuestCombos) {
          const hash = comboConfigurationHash(guestLine);
          const existing = combinedCombos.get(hash);
          const quantity = (existing?.quantity ?? 0) + guestLine.quantity;
          if (quantity > MAX_CART_QUANTITY_PER_VARIANT) {
            throw cartLimitConflict(
              "Combining the carts would exceed the quantity limit for a combo configuration.",
            );
          }
          combinedCombos.set(hash, {
            ...guestLine,
            lineId: existing?.lineId ?? guestLine.lineId,
            quantity,
          });
        }
        if (combined.size + combinedCombos.size > MAX_CART_LINES) {
          throw cartLimitConflict(
            "Combining the carts would exceed the cart line limit.",
          );
        }

        const oldLines = new Map(
          current.lines.map((line) => [line.variantId, line]),
        );
        const linesToInsert: CartStoredLine[] = [];
        const linesToUpdate: CartStoredLine[] = [];
        for (const line of combined.values()) {
          const prior = oldLines.get(line.variantId);
          if (!prior) {
            linesToInsert.push(line);
          } else if (
            prior.quantity !== line.quantity ||
            !sameSnapshot(prior.product, line.product)
          ) {
            linesToUpdate.push(line);
          }
        }
        if (linesToInsert.length > 0) {
          await transaction.insert(customerCartLine).values(
            linesToInsert.map((line) => ({
              cartId: cart.id,
              variantId: line.variantId,
              quantity: line.quantity,
              productSnapshot: line.product,
            })),
          );
        }
        if (linesToUpdate.length > 0) {
          const quantityCase = sql`CASE ${customerCartLine.variantId} ${sql.join(
            linesToUpdate.map(
              (line) =>
                sql`WHEN ${line.variantId}::uuid THEN ${line.quantity}::integer`,
            ),
            sql` `,
          )} ELSE ${customerCartLine.quantity} END`;
          const productSnapshotCase = sql`CASE ${customerCartLine.variantId} ${sql.join(
            linesToUpdate.map(
              (line) =>
                sql`WHEN ${line.variantId}::uuid THEN ${JSON.stringify(line.product)}::jsonb`,
            ),
            sql` `,
          )} ELSE ${customerCartLine.productSnapshot} END`;
          const updatedLines = await transaction
            .update(customerCartLine)
            .set({
              quantity: quantityCase,
              productSnapshot: productSnapshotCase,
              updatedAt: sql`clock_timestamp()`,
            })
            .where(
              and(
                eq(customerCartLine.cartId, cart.id),
                inArray(
                  customerCartLine.variantId,
                  linesToUpdate.map(({ variantId }) => variantId),
                ),
              ),
            )
            .returning({ variantId: customerCartLine.variantId });
          if (updatedLines.length !== linesToUpdate.length) {
            throw new ConflictException(
              "The account cart changed during guest cart merge. Refresh the cart and try again.",
              { errorCode: "CART_REVISION_STALE" },
            );
          }
        }

        const oldComboLines = new Map(
          current.combos.map((line) => [comboConfigurationHash(line), line]),
        );
        const comboLinesChanged =
          combinedCombos.size !== current.combos.length ||
          [...combinedCombos].some(([hash, line]) => {
            const prior = oldComboLines.get(hash);
            return !prior || prior.quantity !== line.quantity;
          });
        if (comboLinesChanged) {
          await transaction
            .delete(customerCartComboLine)
            .where(eq(customerCartComboLine.cartId, cart.id));
          if (combinedCombos.size > 0) {
            await transaction.insert(customerCartComboLine).values(
              [...combinedCombos].map(([configurationHash, line]) => ({
                id: line.lineId,
                cartId: cart.id,
                comboProductId: line.productId,
                comboRevision: line.comboRevision,
                configurationHash,
                quantity: line.quantity,
                slug: line.slug,
                name: line.name,
                unitPriceBdt: line.unitPriceBdt,
                selections: line.selections,
              })),
            );
          }
        }

        const changed =
          combined.size !== current.lines.length ||
          [...combined.values()].some((line) => {
            const prior = oldLines.get(line.variantId);
            return (
              !prior ||
              prior.quantity !== line.quantity ||
              !sameSnapshot(prior.product, line.product)
            );
          }) ||
          comboLinesChanged;
        const revision = changed
          ? incrementRevision(current.revision)
          : current.revision;
        if (changed) {
          await transaction
            .update(customerCart)
            .set({ revision, updatedAt: new Date() })
            .where(eq(customerCart.id, cart.id));
        }
        await transaction.insert(guestCartRevisionReceipt).values({
          guestCartHash: guestHash,
          guestRevision: guest.revision,
        });
        return {
          schemaVersion: CART_SCHEMA_VERSION,
          currency: CART_CURRENCY,
          revision,
          lines: [...combined.values()].sort((left, right) =>
            left.variantId.localeCompare(right.variantId),
          ),
          combos: [...combinedCombos.values()].sort((left, right) =>
            left.lineId.localeCompare(right.lineId),
          ),
        };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A competing account may have committed this exact guest revision.
      // The receipt is globally unique, so returning the caller's own cart is safe.
      const receipt = await this.database.db
        .select({ guestRevision: guestCartRevisionReceipt.guestRevision })
        .from(guestCartRevisionReceipt)
        .where(
          and(
            eq(guestCartRevisionReceipt.guestCartHash, guestHash),
            eq(guestCartRevisionReceipt.guestRevision, guest.revision),
          ),
        )
        .limit(1);
      if (!receipt.length) throw error;
      committed = await this.getCustomerCartState(customerId);
    }

    const cleanupPending = !(await this.deleteGuestState(id, guest.revision));
    return {
      cart: await this.toCart(committed),
      guestCartCleanupPending: cleanupPending,
    };
  }

  async getGuestCartForMergeResolution(
    guestCartId: string | undefined,
  ): Promise<Cart> {
    const id = parseGuestCartId(guestCartId);
    if (!id) return this.toCart(EMPTY_CART);
    const state = await this.readGuestState(id);
    return this.toCart(state ?? EMPTY_CART);
  }

  async setGuestLineForMergeResolution(
    guestCartId: string | undefined,
    variantId: string,
    input: CartSetLineInput,
  ): Promise<{ cart: Cart; guestCartId: string }> {
    const id = parseGuestCartId(guestCartId);
    if (!id)
      throw new ConflictException("The guest cart is no longer available.");
    const [variant] = await this.catalog.findPurchasableVariants([variantId]);
    if (!variant) throw new NotFoundException("Product variant not found.");
    const next = await this.withGuestCartOwnerLock(id, async () => {
      const state = await this.readGuestState(id);
      if (!state)
        throw new ConflictException("The guest cart is no longer available.");
      const updated = setStoredLine(state, input.revision, {
        variantId,
        quantity: input.quantity,
        product: toProductSnapshot(variant),
      });
      await this.writeGuestState(id, input.revision, updated);
      return updated;
    });
    return { cart: await this.toCart(next), guestCartId: id };
  }

  async removeGuestLineForMergeResolution(
    guestCartId: string | undefined,
    variantId: string,
    input: CartRevisionQuery,
  ): Promise<{ cart: Cart; guestCartId: string }> {
    const id = parseGuestCartId(guestCartId);
    if (!id)
      throw new ConflictException("The guest cart is no longer available.");
    const next = await this.withGuestCartOwnerLock(id, async () => {
      const state = await this.readGuestState(id);
      if (!state)
        throw new ConflictException("The guest cart is no longer available.");
      const updated = removeStoredLine(state, variantId, input.revision);
      await this.writeGuestState(id, input.revision, updated);
      return updated;
    });
    return { cart: await this.toCart(next), guestCartId: id };
  }

  private async getCustomerCart(customerId: string): Promise<Cart> {
    return this.toCart(await this.getCustomerCartState(customerId));
  }

  private async getCustomerCartState(
    customerId: string,
  ): Promise<CartStoredState> {
    const [row] = await this.database.db
      .select({
        id: customerCart.id,
        currency: customerCart.currency,
        schemaVersion: customerCart.schemaVersion,
        revision: customerCart.revision,
      })
      .from(customerCart)
      .where(eq(customerCart.customerId, customerId))
      .limit(1);
    if (!row) return EMPTY_CART;
    const [lineRows, comboRows] = await Promise.all([
      this.database.db
        .select({
          variantId: customerCartLine.variantId,
          quantity: customerCartLine.quantity,
          product: customerCartLine.productSnapshot,
        })
        .from(customerCartLine)
        .where(eq(customerCartLine.cartId, row.id))
        .orderBy(asc(customerCartLine.variantId)),
      this.database.db
        .select({
          lineId: customerCartComboLine.id,
          productId: customerCartComboLine.comboProductId,
          comboRevision: customerCartComboLine.comboRevision,
          quantity: customerCartComboLine.quantity,
          slug: customerCartComboLine.slug,
          name: customerCartComboLine.name,
          unitPriceBdt: customerCartComboLine.unitPriceBdt,
          selections: customerCartComboLine.selections,
        })
        .from(customerCartComboLine)
        .where(eq(customerCartComboLine.cartId, row.id)),
    ]);
    const lines = lineRows;
    return parseStoredState({
      schemaVersion: row.schemaVersion,
      currency: row.currency,
      revision: row.revision,
      lines,
      combos: comboRows,
    });
  }

  private async clearCustomerCart(
    customerId: string,
  ): Promise<CartStoredState> {
    return this.database.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({ id: customerCart.id, revision: customerCart.revision })
        .from(customerCart)
        .where(eq(customerCart.customerId, customerId))
        .for("update")
        .limit(1);
      if (!row) return EMPTY_CART;

      const removedLines = await transaction
        .delete(customerCartLine)
        .where(eq(customerCartLine.cartId, row.id))
        .returning({ id: customerCartLine.id });
      const removedCombos = await transaction
        .delete(customerCartComboLine)
        .where(eq(customerCartComboLine.cartId, row.id))
        .returning({ id: customerCartComboLine.id });
      if (removedLines.length + removedCombos.length === 0)
        return { ...EMPTY_CART, revision: row.revision };

      const revision = incrementRevision(row.revision);
      await transaction
        .update(customerCart)
        .set({ revision, updatedAt: new Date() })
        .where(eq(customerCart.id, row.id));
      return { ...EMPTY_CART, revision };
    });
  }

  private async setCustomerLine(
    customerId: string,
    expectedRevision: number,
    line: CartStoredLine,
  ): Promise<CartStoredState> {
    return this.database.db.transaction(async (transaction) => {
      const cart = await ensureAndLockCustomerCart(transaction, customerId);
      const current = await readCustomerCartState(transaction, cart);
      if (current.revision !== expectedRevision) {
        throw staleRevision(current.revision);
      }
      const old = current.lines.find(
        ({ variantId }) => variantId === line.variantId,
      );
      const lines = [...current.lines];
      if (!old) {
        if (lines.length >= MAX_CART_LINES) {
          throw cartLimitConflict("The cart has reached its line limit.");
        }
        lines.push(line);
        await transaction.insert(customerCartLine).values({
          cartId: cart.id,
          variantId: line.variantId,
          quantity: line.quantity,
          productSnapshot: line.product,
        });
      } else {
        const index = lines.findIndex(
          ({ variantId }) => variantId === line.variantId,
        );
        lines[index] = line;
        if (
          old.quantity !== line.quantity ||
          !sameSnapshot(old.product, line.product)
        ) {
          await transaction
            .update(customerCartLine)
            .set({
              quantity: line.quantity,
              productSnapshot: line.product,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(customerCartLine.cartId, cart.id),
                eq(customerCartLine.variantId, line.variantId),
              ),
            );
        }
      }
      const changed =
        !old ||
        old.quantity !== line.quantity ||
        !sameSnapshot(old.product, line.product);
      const revision = changed
        ? incrementRevision(current.revision)
        : current.revision;
      if (changed) {
        await transaction
          .update(customerCart)
          .set({ revision, updatedAt: new Date() })
          .where(eq(customerCart.id, cart.id));
      }
      return { ...current, revision, lines: lines.sort(byVariantId) };
    });
  }

  private async setCustomerComboLine(
    customerId: string,
    expectedRevision: number,
    line: CartStoredComboLine,
    configurationHash: string,
  ): Promise<CartStoredState> {
    return this.database.db.transaction(async (transaction) => {
      const cart = await ensureAndLockCustomerCart(transaction, customerId);
      const current = await readCustomerCartState(transaction, cart);
      if (current.revision !== expectedRevision) {
        throw staleRevision(current.revision);
      }
      const existing = current.combos.find(
        (candidate) => comboConfigurationHash(candidate) === configurationHash,
      );
      const quantity = (existing?.quantity ?? 0) + line.quantity;
      if (quantity > MAX_CART_QUANTITY_PER_VARIANT) {
        throw cartLimitConflict(
          "The quantity for this combo configuration exceeds the cart limit.",
        );
      }
      if (
        !existing &&
        current.lines.length + current.combos.length >= MAX_CART_LINES
      ) {
        throw cartLimitConflict("The cart has reached its line limit.");
      }
      const savedLine = {
        ...line,
        lineId: existing?.lineId ?? line.lineId,
        quantity,
      };
      if (existing) {
        await transaction
          .update(customerCartComboLine)
          .set({
            quantity,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(customerCartComboLine.cartId, cart.id),
              eq(customerCartComboLine.id, existing.lineId),
            ),
          );
      } else {
        await transaction.insert(customerCartComboLine).values({
          id: savedLine.lineId,
          cartId: cart.id,
          comboProductId: savedLine.productId,
          comboRevision: savedLine.comboRevision,
          configurationHash,
          quantity,
          slug: savedLine.slug,
          name: savedLine.name,
          unitPriceBdt: savedLine.unitPriceBdt,
          selections: savedLine.selections,
        });
      }
      const revision = incrementRevision(current.revision);
      await transaction
        .update(customerCart)
        .set({ revision, updatedAt: sql`clock_timestamp()` })
        .where(eq(customerCart.id, cart.id));
      return {
        ...current,
        revision,
        combos: [
          ...current.combos.filter(
            (candidate) => candidate.lineId !== savedLine.lineId,
          ),
          savedLine,
        ].sort((left, right) => left.lineId.localeCompare(right.lineId)),
      };
    });
  }

  private async setCustomerComboQuantity(
    customerId: string,
    lineId: string,
    expectedRevision: number,
    quantity: number,
  ): Promise<CartStoredState> {
    return this.database.db.transaction(async (transaction) => {
      const cart = await ensureAndLockCustomerCart(transaction, customerId);
      const current = await readCustomerCartState(transaction, cart);
      if (current.revision !== expectedRevision) {
        throw staleRevision(current.revision);
      }
      const line = current.combos.find(({ lineId: id }) => id === lineId);
      if (!line) throw new NotFoundException("Combo cart line not found.");
      if (line.quantity === quantity) return current;
      await transaction
        .update(customerCartComboLine)
        .set({ quantity, updatedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(customerCartComboLine.cartId, cart.id),
            eq(customerCartComboLine.id, lineId),
          ),
        );
      const revision = incrementRevision(current.revision);
      await transaction
        .update(customerCart)
        .set({ revision, updatedAt: sql`clock_timestamp()` })
        .where(eq(customerCart.id, cart.id));
      return {
        ...current,
        revision,
        combos: current.combos.map((candidate) =>
          candidate.lineId === lineId ? { ...candidate, quantity } : candidate,
        ),
      };
    });
  }

  private async removeCustomerComboLine(
    customerId: string,
    lineId: string,
    expectedRevision: number,
  ): Promise<CartStoredState> {
    return this.database.db.transaction(async (transaction) => {
      const [cart] = await transaction
        .select({
          id: customerCart.id,
          currency: customerCart.currency,
          schemaVersion: customerCart.schemaVersion,
          revision: customerCart.revision,
        })
        .from(customerCart)
        .where(eq(customerCart.customerId, customerId))
        .for("update")
        .limit(1);
      if (!cart) {
        if (expectedRevision !== 0) throw staleRevision(0);
        return EMPTY_CART;
      }
      const current = await readCustomerCartState(transaction, cart);
      if (current.revision !== expectedRevision) {
        throw staleRevision(current.revision);
      }
      if (!current.combos.some(({ lineId: id }) => id === lineId)) {
        return current;
      }
      await transaction
        .delete(customerCartComboLine)
        .where(
          and(
            eq(customerCartComboLine.cartId, cart.id),
            eq(customerCartComboLine.id, lineId),
          ),
        );
      const revision = incrementRevision(current.revision);
      await transaction
        .update(customerCart)
        .set({ revision, updatedAt: sql`clock_timestamp()` })
        .where(eq(customerCart.id, cart.id));
      return {
        ...current,
        revision,
        combos: current.combos.filter(({ lineId: id }) => id !== lineId),
      };
    });
  }

  private async removeCustomerLine(
    customerId: string,
    variantId: string,
    expectedRevision: number,
  ): Promise<CartStoredState> {
    return this.database.db.transaction(async (transaction) => {
      const [existingCart] = await transaction
        .select({
          id: customerCart.id,
          currency: customerCart.currency,
          schemaVersion: customerCart.schemaVersion,
          revision: customerCart.revision,
        })
        .from(customerCart)
        .where(eq(customerCart.customerId, customerId))
        .for("update")
        .limit(1);
      if (!existingCart) {
        if (expectedRevision !== 0) throw staleRevision(0);
        return EMPTY_CART;
      }
      const current = await readCustomerCartState(transaction, existingCart);
      if (current.revision !== expectedRevision)
        throw staleRevision(current.revision);
      const line = current.lines.find(({ variantId: id }) => id === variantId);
      if (!line) return current;
      await transaction
        .delete(customerCartLine)
        .where(
          and(
            eq(customerCartLine.cartId, existingCart.id),
            eq(customerCartLine.variantId, variantId),
          ),
        );
      const revision = incrementRevision(current.revision);
      await transaction
        .update(customerCart)
        .set({ revision, updatedAt: new Date() })
        .where(eq(customerCart.id, existingCart.id));
      return {
        ...current,
        revision,
        lines: current.lines.filter(({ variantId: id }) => id !== variantId),
      };
    });
  }

  private async readGuestState(id: string): Promise<CartStoredState | null> {
    try {
      const raw = await getRedisClient().get(this.guestKey(id));
      if (raw === null) return null;
      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        throw invalidStoredCart();
      }
      return parseStoredState(decoded);
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      throw new ServiceUnavailableException(
        "Guest cart storage is temporarily unavailable.",
        { errorCode: "CART_STORAGE_UNAVAILABLE" },
      );
    }
  }

  private async writeGuestState(
    id: string,
    expectedRevision: number,
    state: CartStoredState,
  ): Promise<void> {
    try {
      const result = (await getRedisClient().eval(
        GUEST_CART_MUTATION_SCRIPT,
        1,
        this.guestKey(id),
        String(expectedRevision),
        String(GUEST_CART_TTL_SECONDS),
        JSON.stringify(state),
      )) as [string, string];
      if (result[0] === "STALE") throw staleRevision(Number(result[1]));
      if (result[0] === "CORRUPT") throw invalidStoredCart();
      if (result[0] !== "OK")
        throw new Error("Unexpected Redis cart response.");
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        "Guest cart storage is temporarily unavailable.",
        { errorCode: "CART_STORAGE_UNAVAILABLE" },
      );
    }
  }

  private async deleteGuestState(
    id: string,
    revision: number,
  ): Promise<boolean> {
    try {
      const result = await getRedisClient().eval(
        GUEST_CART_COMPARE_AND_DELETE_SCRIPT,
        1,
        this.guestKey(id),
        String(revision),
      );
      return result === 1;
    } catch {
      this.logger.warn("Guest cart cleanup could not reach Redis.");
      return false;
    }
  }

  private async withGuestCartOwnerLock<T>(
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const guestCartHash = createHash("sha256").update(id).digest("hex");
    return this.database.db.transaction(async (transaction) => {
      await lockCartOwner(transaction, "guest", guestCartHash);
      return operation();
    });
  }

  private guestKey(id: string): string {
    const prefix =
      process.env.CART_REDIS_KEY_PREFIX?.trim() || "aaraj:cart:guest:";
    return `${prefix}${id}`;
  }

  private async toCart(
    state: CartStoredState,
    includeImages = true,
  ): Promise<Cart> {
    const variants = await this.catalog.findPurchasableVariants(
      cartVariantIds(state),
      { includeImages },
    );
    const combos = await this.catalog.findPurchasableCombos(
      state.combos.map(({ productId }) => productId),
    );
    return this.toCartFromVariants(state, variants, combos);
  }

  private toCartFromVariants(
    state: CartStoredState,
    variants: readonly CartAvailabilityVariant[],
    combos: readonly PurchasableCatalogCombo[] = [],
  ): Cart {
    const variantsById = new Map(
      variants.map((variant) => [variant.variantId, variant]),
    );
    const combosById = new Map(combos.map((combo) => [combo.productId, combo]));
    return CartSchema.parse({
      ...state,
      lines: state.lines.map((line) => {
        const variant = variantsById.get(line.variantId);
        return {
          ...line,
          ...(variant?.image ? { image: variant.image } : {}),
          availability: !variant
            ? "unavailable"
            : variant.inStock === false
              ? "out_of_stock"
              : "available",
        };
      }),
      combos: state.combos.map((line) => {
        const current = combosById.get(line.productId);
        const selectedVariants = line.selections.map((selection) => {
          const component = current?.combo.components.find(
            ({ id }) => id === selection.componentId,
          );
          const variant = component?.variants.find(
            ({ variantId }) => variantId === selection.variantId,
          );
          return { selection, component, variant };
        });
        let availability: CartComboLine["availability"] = "available";
        const hasSelectedCatalogData = Boolean(
          current &&
          current.revision === line.comboRevision &&
          selectedVariants.every(({ component, variant }) =>
            Boolean(component && variant),
          ),
        );
        if (!hasSelectedCatalogData || !current) {
          availability = "unavailable";
        } else {
          try {
            assertComboSelections(
              current.combo,
              line.selections,
              line.quantity,
            );
          } catch {
            const demandByVariant = new Map<string, number>();
            for (const selection of line.selections) {
              demandByVariant.set(
                selection.variantId,
                (demandByVariant.get(selection.variantId) ?? 0) + line.quantity,
              );
            }
            const exceedsStock = [...demandByVariant].some(
              ([variantId, demand]) => {
                const variant = selectedVariants.find(
                  (selected) => selected.variant?.variantId === variantId,
                )?.variant;
                return !variant || variant.availableQuantity < demand;
              },
            );
            availability = exceedsStock ? "out_of_stock" : "unavailable";
          }
        }
        return {
          ...line,
          ...(current
            ? {
                slug: current.slug,
                name: current.name,
                unitPriceBdt: current.priceBdt,
                image: current.image ?? undefined,
                selections: selectedVariants.map(
                  ({ selection, variant }, selectionIndex) => ({
                    ...selection,
                    selectionIndex: selection.selectionIndex ?? selectionIndex,
                    ...(variant
                      ? {
                          productName:
                            current.combo.components.find(
                              ({ id }) => id === selection.componentId,
                            )?.productName ?? selection.productName,
                          color: variant.color,
                          sizeLabel: variant.sizeLabel,
                          unitPriceBdt: variant.price.amountBdt,
                          compareAtPriceBdt:
                            variant.compareAtPrice?.amountBdt ?? null,
                        }
                      : {}),
                  }),
                ),
              }
            : {}),
          availability,
        };
      }),
    });
  }
}

async function ensureAndLockCustomerCart(
  transaction: AuditTransaction,
  customerId: string,
): Promise<CustomerCartHeader> {
  await transaction
    .insert(customerCart)
    .values({ customerId, currency: CART_CURRENCY })
    .onConflictDoNothing({ target: customerCart.customerId });
  const [row] = await transaction
    .select({
      id: customerCart.id,
      currency: customerCart.currency,
      schemaVersion: customerCart.schemaVersion,
      revision: customerCart.revision,
    })
    .from(customerCart)
    .where(eq(customerCart.customerId, customerId))
    .for("update")
    .limit(1);
  if (!row) throw new Error("Customer cart lock could not be acquired.");
  return row;
}

async function readCustomerCartState(
  transaction: AuditTransaction,
  row: CustomerCartHeader,
): Promise<CartStoredState> {
  const [rows, combos] = await Promise.all([
    transaction
      .select({
        variantId: customerCartLine.variantId,
        quantity: customerCartLine.quantity,
        product: customerCartLine.productSnapshot,
      })
      .from(customerCartLine)
      .where(eq(customerCartLine.cartId, row.id))
      .orderBy(asc(customerCartLine.variantId)),
    transaction
      .select({
        lineId: customerCartComboLine.id,
        productId: customerCartComboLine.comboProductId,
        comboRevision: customerCartComboLine.comboRevision,
        quantity: customerCartComboLine.quantity,
        slug: customerCartComboLine.slug,
        name: customerCartComboLine.name,
        unitPriceBdt: customerCartComboLine.unitPriceBdt,
        selections: customerCartComboLine.selections,
      })
      .from(customerCartComboLine)
      .where(eq(customerCartComboLine.cartId, row.id)),
  ]);
  return parseStoredState({
    schemaVersion: row.schemaVersion,
    currency: row.currency,
    revision: row.revision,
    lines: rows,
    combos,
  });
}

function parseStoredState(value: unknown): CartStoredState {
  const parsed = CartStoredStateSchema.safeParse(value);
  if (!parsed.success) throw invalidStoredCart();
  const ids = new Set<string>();
  for (const line of parsed.data.lines) {
    if (ids.has(line.variantId)) throw invalidStoredCart();
    ids.add(line.variantId);
  }
  return parsed.data;
}

function setStoredLine(
  state: CartStoredState,
  expectedRevision: number,
  line: CartStoredLine,
): CartStoredState {
  if (state.revision !== expectedRevision) throw staleRevision(state.revision);
  const previous = state.lines.find(
    ({ variantId }) => variantId === line.variantId,
  );
  if (!previous && state.lines.length + state.combos.length >= MAX_CART_LINES) {
    throw cartLimitConflict("The cart has reached its line limit.");
  }
  const changed =
    !previous ||
    previous.quantity !== line.quantity ||
    !sameSnapshot(previous.product, line.product);
  return {
    ...state,
    revision: changed ? incrementRevision(state.revision) : state.revision,
    lines: [
      ...state.lines.filter(({ variantId }) => variantId !== line.variantId),
      line,
    ].sort(byVariantId),
  };
}

function addStoredComboLine(
  state: CartStoredState,
  expectedRevision: number,
  line: CartStoredComboLine,
  configurationHash: string,
): CartStoredState {
  if (state.revision !== expectedRevision) throw staleRevision(state.revision);
  const previous = state.combos.find(
    (candidate) => comboConfigurationHash(candidate) === configurationHash,
  );
  if (!previous && state.lines.length + state.combos.length >= MAX_CART_LINES) {
    throw cartLimitConflict("The cart has reached its line limit.");
  }
  const quantity = (previous?.quantity ?? 0) + line.quantity;
  if (quantity > MAX_CART_QUANTITY_PER_VARIANT) {
    throw cartLimitConflict(
      "The quantity for this combo configuration exceeds the cart limit.",
    );
  }
  return {
    ...state,
    revision: incrementRevision(state.revision),
    combos: [
      ...state.combos.filter(({ lineId }) => lineId !== previous?.lineId),
      {
        ...line,
        lineId: previous?.lineId ?? line.lineId,
        quantity,
      },
    ].sort((left, right) => left.lineId.localeCompare(right.lineId)),
  };
}

function setStoredComboQuantity(
  state: CartStoredState,
  lineId: string,
  expectedRevision: number,
  quantity: number,
): CartStoredState {
  if (state.revision !== expectedRevision) throw staleRevision(state.revision);
  const line = state.combos.find(({ lineId: id }) => id === lineId);
  if (!line) throw new NotFoundException("Combo cart line not found.");
  if (line.quantity === quantity) return state;
  return {
    ...state,
    revision: incrementRevision(state.revision),
    combos: state.combos.map((candidate) =>
      candidate.lineId === lineId ? { ...candidate, quantity } : candidate,
    ),
  };
}

function removeStoredComboLine(
  state: CartStoredState,
  lineId: string,
  expectedRevision: number,
): CartStoredState {
  if (state.revision !== expectedRevision) throw staleRevision(state.revision);
  if (!state.combos.some((line) => line.lineId === lineId)) return state;
  return {
    ...state,
    revision: incrementRevision(state.revision),
    combos: state.combos.filter(({ lineId: id }) => id !== lineId),
  };
}

function removeStoredLine(
  state: CartStoredState,
  variantId: string,
  expectedRevision: number,
): CartStoredState {
  if (state.revision !== expectedRevision) throw staleRevision(state.revision);
  if (!state.lines.some((line) => line.variantId === variantId)) return state;
  return {
    ...state,
    revision: incrementRevision(state.revision),
    lines: state.lines.filter((line) => line.variantId !== variantId),
  };
}

function toProductSnapshot(variant: CatalogCartVariant): CartProductSnapshot {
  return CartProductSnapshotSchema.parse({
    slug: variant.slug,
    name: variant.name,
    color: variant.color,
    sizeLabel: variant.sizeLabel,
    unitPriceBdt: variant.unitPriceBdt,
    compareAtPriceBdt: variant.compareAtPriceBdt,
    currency: variant.currency,
  });
}

function incrementRevision(revision: number): number {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw cartLimitConflict("The cart revision cannot be advanced further.");
  }
  return revision + 1;
}

function comboConfigurationHash(line: CartStoredComboLine): string {
  const selections = [...line.selections]
    .map(({ componentId, variantId }) => ({ componentId, variantId }))
    .sort(
      (left, right) =>
        left.componentId.localeCompare(right.componentId) ||
        left.variantId.localeCompare(right.variantId),
    );
  return createHash("sha256")
    .update(
      JSON.stringify({
        productId: line.productId,
        comboRevision: line.comboRevision,
        selections,
      }),
    )
    .digest("hex");
}

function cartVariantIds(state: CartStoredState): string[] {
  return [
    ...new Set([
      ...state.lines.map(({ variantId }) => variantId),
      ...state.combos.flatMap((line) =>
        line.selections.map(({ variantId }) => variantId),
      ),
    ]),
  ];
}

function sameSnapshot(
  left: CartProductSnapshot,
  right: CartProductSnapshot,
): boolean {
  return (
    left.slug === right.slug &&
    left.name === right.name &&
    left.color === right.color &&
    left.sizeLabel === right.sizeLabel &&
    left.unitPriceBdt === right.unitPriceBdt &&
    left.compareAtPriceBdt === right.compareAtPriceBdt &&
    left.currency === right.currency
  );
}

function byVariantId(left: CartStoredLine, right: CartStoredLine): number {
  return left.variantId.localeCompare(right.variantId);
}

function invalidStoredCart(): InternalServerErrorException {
  return new InternalServerErrorException(
    "Your saved cart cannot be read. Clear it to start a fresh cart.",
    {
      errorCode: "CART_DATA_INVALID",
    },
  );
}

function staleRevision(currentRevision: number): ConflictException {
  return new ConflictException({
    statusCode: 409,
    message: "The cart changed in another request. Reload it before retrying.",
    error: "Conflict",
    errorCode: "CART_REVISION_CONFLICT",
    currentRevision,
  });
}

function cartLimitConflict(message: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    message,
    error: "Conflict",
    errorCode: "CART_LIMIT_EXCEEDED",
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
