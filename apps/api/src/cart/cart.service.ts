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
  CartProductSnapshotSchema,
  CartSchema,
  MAX_CART_LINES,
  MAX_CART_QUANTITY_PER_VARIANT,
  type Cart,
  type CartMergeResult,
  type CartProductSnapshot,
  type CartRevisionQuery,
  type CartSetLineInput,
} from "@aaraj/contracts";
import { and, asc, eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  CATALOG_CART_PORT,
  type CatalogCartPort,
  type CatalogCartVariant,
} from "../catalog/catalog-cart.port.js";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { getRedisClient } from "../platform/redis/redis-client.js";
import {
  cartMergeReceipt,
  customerCart,
  customerCartLine,
} from "./cart-schema.js";
import { GUEST_CART_TTL_SECONDS, parseGuestCartId } from "./cart-cookie.js";

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
});
type CartStoredLine = z.infer<typeof CartStoredLineSchema>;
type CartStoredState = z.infer<typeof CartStoredStateSchema>;

export type CartQuoteOwner =
  | { kind: "customer"; customerId: string }
  | { kind: "guest"; guestCartHash: string };

export type CartQuoteContext = {
  cart: Cart;
  owner: CartQuoteOwner | null;
};

const EMPTY_CART: CartStoredState = {
  schemaVersion: CART_SCHEMA_VERSION,
  currency: CART_CURRENCY,
  revision: 0,
  lines: [],
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
local state = '{"schemaVersion":1,"currency":"BDT","revision":' .. string.format('%.0f', revision) .. ',"lines":[]}'
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
    if (customerId) {
      return {
        cart: await this.getCustomerCart(customerId),
        owner: { kind: "customer", customerId },
      };
    }
    const id = parseGuestCartId(guestCartId);
    if (!id) return { cart: await this.toCart(EMPTY_CART), owner: null };
    const state = await this.readGuestState(id);
    return {
      cart: await this.toCart(state ?? EMPTY_CART),
      owner: {
        kind: "guest",
        guestCartHash: createHash("sha256").update(id).digest("hex"),
      },
    };
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

    return this.toCart(await this.clearGuestCartState(id));
  }

  async clearGuestCartForMergeResolution(
    guestCartId: string | undefined,
  ): Promise<Cart> {
    const id = parseGuestCartId(guestCartId);
    if (!id) return this.toCart(EMPTY_CART);
    return this.toCart(await this.clearGuestCartState(id));
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
    const state = await this.readGuestState(id);
    const next = setStoredLine(state ?? EMPTY_CART, input.revision, line);
    await this.writeGuestState(id, input.revision, next);
    return { cart: await this.toCart(next), guestCartId: id };
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
    const state = await this.readGuestState(id);
    if (!state) {
      if (input.revision !== 0) throw staleRevision(0);
      return { cart: await this.toCart(EMPTY_CART), guestCartId: null };
    }
    const next = removeStoredLine(state, variantId, input.revision);
    await this.writeGuestState(id, input.revision, next);
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
    if (currentProducts.size !== guest.lines.length) {
      throw new ConflictException({
        statusCode: 409,
        message:
          "The guest cart contains a variant that is no longer available. Remove it before merging.",
        error: "Conflict",
        errorCode: "CART_VARIANT_UNAVAILABLE",
      });
    }
    const guestHash = createHash("sha256").update(id).digest("hex");
    let committed: CartStoredState;
    try {
      committed = await this.database.db.transaction(async (transaction) => {
        const cartId = await ensureAndLockCustomerCart(transaction, customerId);
        const [receipt] = await transaction
          .select({ guestRevision: cartMergeReceipt.guestRevision })
          .from(cartMergeReceipt)
          .where(
            and(
              eq(cartMergeReceipt.guestCartHash, guestHash),
              eq(cartMergeReceipt.guestRevision, guest.revision),
            ),
          )
          .limit(1);
        const current = await readCustomerCartState(transaction, customerId);
        if (receipt) return current;

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
        if (combined.size > MAX_CART_LINES) {
          throw cartLimitConflict(
            "Combining the carts would exceed the cart line limit.",
          );
        }

        const oldLines = new Map(
          current.lines.map((line) => [line.variantId, line]),
        );
        for (const line of combined.values()) {
          const prior = oldLines.get(line.variantId);
          if (!prior) {
            await transaction.insert(customerCartLine).values({
              cartId,
              variantId: line.variantId,
              quantity: line.quantity,
              productSnapshot: line.product,
            });
          } else if (
            prior.quantity !== line.quantity ||
            !sameSnapshot(prior.product, line.product)
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
                  eq(customerCartLine.cartId, cartId),
                  eq(customerCartLine.variantId, line.variantId),
                ),
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
          });
        const revision = changed
          ? incrementRevision(current.revision)
          : current.revision;
        if (changed) {
          await transaction
            .update(customerCart)
            .set({ revision, updatedAt: new Date() })
            .where(eq(customerCart.id, cartId));
        }
        await transaction.insert(cartMergeReceipt).values({
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
        };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A competing account may have committed this exact guest revision.
      // The receipt is globally unique, so returning the caller's own cart is safe.
      const receipt = await this.database.db
        .select({ guestRevision: cartMergeReceipt.guestRevision })
        .from(cartMergeReceipt)
        .where(
          and(
            eq(cartMergeReceipt.guestCartHash, guestHash),
            eq(cartMergeReceipt.guestRevision, guest.revision),
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
    const state = await this.readGuestState(id);
    if (!state)
      throw new ConflictException("The guest cart is no longer available.");
    const next = setStoredLine(state, input.revision, {
      variantId,
      quantity: input.quantity,
      product: toProductSnapshot(variant),
    });
    await this.writeGuestState(id, input.revision, next);
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
    const state = await this.readGuestState(id);
    if (!state)
      throw new ConflictException("The guest cart is no longer available.");
    const next = removeStoredLine(state, variantId, input.revision);
    await this.writeGuestState(id, input.revision, next);
    return { cart: await this.toCart(next), guestCartId: id };
  }

  private async getCustomerCart(customerId: string): Promise<Cart> {
    return this.toCart(await this.getCustomerCartState(customerId));
  }

  private async getCustomerCartState(
    customerId: string,
  ): Promise<CartStoredState> {
    const [row] = await this.database.db
      .select()
      .from(customerCart)
      .where(eq(customerCart.customerId, customerId))
      .limit(1);
    if (!row) return EMPTY_CART;
    const rows = await this.database.db
      .select({
        variantId: customerCartLine.variantId,
        quantity: customerCartLine.quantity,
        product: customerCartLine.productSnapshot,
      })
      .from(customerCartLine)
      .where(eq(customerCartLine.cartId, row.id))
      .orderBy(asc(customerCartLine.variantId));
    return parseStoredState({
      schemaVersion: row.schemaVersion,
      currency: row.currency,
      revision: row.revision,
      lines: rows,
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

      const removed = await transaction
        .delete(customerCartLine)
        .where(eq(customerCartLine.cartId, row.id))
        .returning({ id: customerCartLine.id });
      if (removed.length === 0)
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
      const cartId = await ensureAndLockCustomerCart(transaction, customerId);
      const current = await readCustomerCartState(transaction, customerId);
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
          cartId,
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
                eq(customerCartLine.cartId, cartId),
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
          .where(eq(customerCart.id, cartId));
      }
      return { ...current, revision, lines: lines.sort(byVariantId) };
    });
  }

  private async removeCustomerLine(
    customerId: string,
    variantId: string,
    expectedRevision: number,
  ): Promise<CartStoredState> {
    return this.database.db.transaction(async (transaction) => {
      const [existingCart] = await transaction
        .select({ id: customerCart.id, revision: customerCart.revision })
        .from(customerCart)
        .where(eq(customerCart.customerId, customerId))
        .for("update")
        .limit(1);
      if (!existingCart) {
        if (expectedRevision !== 0) throw staleRevision(0);
        return EMPTY_CART;
      }
      const current = await readCustomerCartState(transaction, customerId);
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
      this.logger.warn("Guest cart cleanup is pending after merge commit.");
      return false;
    }
  }

  private guestKey(id: string): string {
    const prefix =
      process.env.CART_REDIS_KEY_PREFIX?.trim() || "aaraj:cart:guest:";
    return `${prefix}${id}`;
  }

  private async toCart(state: CartStoredState): Promise<Cart> {
    const available = new Set(
      (
        await this.catalog.findPurchasableVariants(
          state.lines.map(({ variantId }) => variantId),
        )
      ).map(({ variantId }) => variantId),
    );
    return CartSchema.parse({
      ...state,
      lines: state.lines.map((line) => ({
        ...line,
        availability: available.has(line.variantId)
          ? "available"
          : "unavailable",
      })),
    });
  }
}

async function ensureAndLockCustomerCart(
  transaction: AuditTransaction,
  customerId: string,
): Promise<string> {
  await transaction
    .insert(customerCart)
    .values({ customerId, currency: CART_CURRENCY })
    .onConflictDoNothing({ target: customerCart.customerId });
  const [row] = await transaction
    .select({ id: customerCart.id })
    .from(customerCart)
    .where(eq(customerCart.customerId, customerId))
    .for("update")
    .limit(1);
  if (!row) throw new Error("Customer cart lock could not be acquired.");
  return row.id;
}

async function readCustomerCartState(
  transaction: AuditTransaction,
  customerId: string,
): Promise<CartStoredState> {
  const [row] = await transaction
    .select()
    .from(customerCart)
    .where(eq(customerCart.customerId, customerId))
    .limit(1);
  if (!row) throw new Error("Customer cart row is missing after lock.");
  const rows = await transaction
    .select({
      variantId: customerCartLine.variantId,
      quantity: customerCartLine.quantity,
      product: customerCartLine.productSnapshot,
    })
    .from(customerCartLine)
    .where(eq(customerCartLine.cartId, row.id))
    .orderBy(asc(customerCartLine.variantId));
  return parseStoredState({
    schemaVersion: row.schemaVersion,
    currency: row.currency,
    revision: row.revision,
    lines: rows,
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
  if (!previous && state.lines.length >= MAX_CART_LINES) {
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
    currency: variant.currency,
  });
}

function incrementRevision(revision: number): number {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw cartLimitConflict("The cart revision cannot be advanced further.");
  }
  return revision + 1;
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
