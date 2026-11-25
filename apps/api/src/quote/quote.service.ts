import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  AuthoritativeQuoteSchema,
  MAX_QUOTE_COMPONENT_LINES,
  QUOTE_CURRENCY,
  QUOTE_SCHEMA_VERSION,
  QUOTE_VALIDITY_POLICY_VERSION,
  QuoteLookupSchema,
  QuoteIdSchema,
  type CartComboLine,
  type AuthoritativeQuote,
  type QuoteDestinationInput,
  type QuoteDestinationRef,
  type QuoteLookup,
} from "@aaraj/contracts";
import { and, desc, eq, exists, gt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  CartService,
  type CartQuoteContext,
  type CartQuoteOwner,
} from "../cart/cart.service.js";
import { lockCartOwner } from "../cart/cart-owner-lock.js";
import {
  CATALOG_CART_PORT,
  type CatalogCartPort,
  type PurchasableCatalogVariant,
  type PurchasableCatalogCombo,
} from "../catalog/catalog-cart.port.js";
import { assertComboSelections } from "../catalog/catalog-combo.helpers.js";
import { Inject } from "@nestjs/common";
import { DatabaseService } from "../platform/database/database.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { DeliveryService } from "../delivery/delivery.service.js";
import { GeographyService } from "../geography/geography.service.js";
import { quoteSnapshot } from "./quote-schema.js";

type QuoteRow = typeof quoteSnapshot.$inferSelect;
type AssistedComboLine = Pick<
  CartComboLine,
  "lineId" | "productId" | "comboRevision" | "quantity"
> & {
  selections: readonly Pick<
    CartComboLine["selections"][number],
    "componentId" | "variantId"
  >[];
};
const newerQuoteSnapshot = alias(quoteSnapshot, "newer_quote_snapshot");

@Injectable()
export class QuoteService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cart: CartService,
    @Inject(CATALOG_CART_PORT) private readonly catalog: CatalogCartPort,
    private readonly geography: GeographyService,
    private readonly delivery: DeliveryService,
  ) {}

  async create(
    customerId: string | undefined,
    guestCartId: string | undefined,
    input: QuoteDestinationInput,
  ): Promise<AuthoritativeQuote> {
    const context = await this.cart.getQuoteContext(customerId, guestCartId);
    if (
      !context.owner ||
      (context.cart.lines.length === 0 && context.cart.combos.length === 0)
    ) {
      throw new UnprocessableEntityException(
        "Add an available item before requesting a quote.",
        {
          errorCode: "QUOTE_CART_EMPTY",
        },
      );
    }
    const owner = context.owner;
    if (context.cart.lines.some((line) => line.availability !== "available")) {
      throw new UnprocessableEntityException(
        "Remove unavailable or out-of-stock items before requesting a quote.",
        {
          errorCode: "QUOTE_CART_UNAVAILABLE",
        },
      );
    }
    if (context.cart.combos.some((line) => line.availability !== "available")) {
      throw new UnprocessableEntityException(
        "Remove unavailable or out-of-stock combos before requesting a quote.",
        { errorCode: "QUOTE_CART_UNAVAILABLE" },
      );
    }

    const {
      destination,
      tariff,
      lines,
      comboGroups,
      merchandiseGrossBdt,
      totalBdt,
    } = await this.priceSelection(
      context.cart.lines.map(({ variantId, quantity }) => ({
        variantId,
        quantity,
      })),
      input,
      undefined,
      context.catalogVariants,
      context.cart.combos,
      context.catalogCombos,
    );
    const [saved] = await this.database.db.transaction(async (transaction) => {
      await lockCartQuoteOwner(transaction, owner);
      const [latest] = await transaction
        .select({ createdAt: quoteSnapshot.createdAt })
        .from(quoteSnapshot)
        .where(quoteOwnerCondition(owner))
        .orderBy(desc(quoteSnapshot.createdAt), desc(quoteSnapshot.id))
        .limit(1);
      const createdAt = latest
        ? sql`greatest(statement_timestamp(), ${latest.createdAt}::timestamptz + interval '1 millisecond')`
        : sql`statement_timestamp()`;
      return transaction
        .insert(quoteSnapshot)
        .values({
          schemaVersion: QUOTE_SCHEMA_VERSION,
          customerId: owner.kind === "customer" ? owner.customerId : null,
          guestCartHash: owner.kind === "guest" ? owner.guestCartHash : null,
          cartRevision: context.cart.revision,
          geographyVersion: input.geographyVersion,
          divisionId: destination.division.id,
          divisionName: destination.division.name,
          districtId: destination.district.id,
          districtName: destination.district.name,
          upazilaId: destination.upazila?.id ?? null,
          upazilaName: destination.upazila?.name ?? null,
          deliveryTariffVersion: tariff.version,
          deliveryTariffEffectiveFrom: tariff.effectiveFrom,
          deliveryZone: tariff.zone,
          deliveryAmountBdt: tariff.feeBdt,
          lines,
          comboGroups,
          merchandiseGrossBdt,
          totalBdt,
          validityPolicyVersion: QUOTE_VALIDITY_POLICY_VERSION,
          createdAt,
          expiresAt: sql`${createdAt} + interval '15 minutes'`,
        })
        .returning();
    });
    if (!saved)
      throw new ServiceUnavailableException("The quote could not be saved.");
    return this.toPublicQuote(saved);
  }

  async previewAssisted(
    lines: readonly { variantId: string; quantity: number }[],
    destination: QuoteDestinationInput,
    comboLines: readonly AssistedComboLine[] = [],
  ) {
    return this.priceSelection(
      lines,
      destination,
      undefined,
      undefined,
      comboLines,
    );
  }

  async createAssistedWithinTransaction(
    transaction: AuditTransaction,
    owner: CartQuoteOwner,
    cartRevision: number,
    selections: readonly { variantId: string; quantity: number }[],
    input: QuoteDestinationInput,
    comboLines: readonly AssistedComboLine[] = [],
  ): Promise<AuthoritativeQuote> {
    await lockCartQuoteOwner(transaction, owner);
    const {
      destination,
      tariff,
      lines,
      comboGroups,
      merchandiseGrossBdt,
      totalBdt,
    } = await this.priceSelection(
      selections,
      input,
      transaction,
      undefined,
      comboLines,
    );
    const [latest] = await transaction
      .select({ createdAt: quoteSnapshot.createdAt })
      .from(quoteSnapshot)
      .where(quoteOwnerCondition(owner))
      .orderBy(desc(quoteSnapshot.createdAt), desc(quoteSnapshot.id))
      .limit(1);
    const createdAt = latest
      ? sql`greatest(statement_timestamp(), ${latest.createdAt}::timestamptz + interval '1 millisecond')`
      : sql`statement_timestamp()`;
    const [saved] = await transaction
      .insert(quoteSnapshot)
      .values({
        schemaVersion: QUOTE_SCHEMA_VERSION,
        customerId: owner.kind === "customer" ? owner.customerId : null,
        guestCartHash: owner.kind === "guest" ? owner.guestCartHash : null,
        cartRevision,
        geographyVersion: input.geographyVersion,
        divisionId: destination.division.id,
        divisionName: destination.division.name,
        districtId: destination.district.id,
        districtName: destination.district.name,
        upazilaId: destination.upazila?.id ?? null,
        upazilaName: destination.upazila?.name ?? null,
        deliveryTariffVersion: tariff.version,
        deliveryTariffEffectiveFrom: tariff.effectiveFrom,
        deliveryZone: tariff.zone,
        deliveryAmountBdt: tariff.feeBdt,
        lines,
        comboGroups,
        merchandiseGrossBdt,
        totalBdt,
        validityPolicyVersion: QUOTE_VALIDITY_POLICY_VERSION,
        createdAt,
        expiresAt: sql`${createdAt} + interval '15 minutes'`,
      })
      .returning();
    if (!saved)
      throw new ServiceUnavailableException("The quote could not be saved.");
    return this.toPublicQuote(saved);
  }

  private async priceSelection(
    selections: readonly { variantId: string; quantity: number }[],
    input: QuoteDestinationInput,
    transaction?: AuditTransaction,
    knownVariants?: readonly PurchasableCatalogVariant[],
    comboLines: readonly AssistedComboLine[] = [],
    knownCombos?: readonly PurchasableCatalogCombo[],
  ) {
    if (selections.length === 0 && comboLines.length === 0) {
      throw new UnprocessableEntityException(
        "Add an item before requesting a quote.",
      );
    }
    const destination = await this.geography.resolveDestination(input);
    const tariff = transaction
      ? await this.delivery.resolveDeliveryFeeWithinTransaction(
          transaction,
          input.geographyVersion,
          destination.district.id,
          destination.upazila?.id,
        )
      : await this.delivery.resolveDeliveryFee(
          input.geographyVersion,
          destination.district.id,
          destination.upazila?.id,
        );
    const requestedVariantIds = [
      ...new Set([
        ...selections.map(({ variantId }) => variantId),
        ...comboLines.flatMap((line) =>
          line.selections.map(({ variantId }) => variantId),
        ),
      ]),
    ];
    const variants =
      knownVariants ??
      (transaction
        ? await this.catalog.findPurchasableVariantsWithinTransaction(
            transaction,
            requestedVariantIds,
          )
        : await this.catalog.findPurchasableVariants(requestedVariantIds));
    const byId = new Map(
      variants.map((variant) => [variant.variantId, variant]),
    );
    const standaloneLines = selections.map((selection) => {
      const variant = byId.get(selection.variantId);
      if (!variant)
        throw new UnprocessableEntityException(
          "A cart item is no longer available.",
          { errorCode: "QUOTE_CATALOG_CHANGED" },
        );
      const grossAmountBdt = safeAmount(
        BigInt(variant.unitPriceBdt) * BigInt(selection.quantity),
      );
      return {
        variantId: variant.variantId,
        comboGroupId: null,
        productName: variant.name,
        color: variant.color,
        sizeLabel: variant.sizeLabel,
        quantity: selection.quantity,
        unitPriceBdt: variant.unitPriceBdt,
        compareAtPriceBdt: variant.compareAtPriceBdt,
        grossAmountBdt,
      };
    });
    const currentCombos =
      knownCombos ??
      (comboLines.length
        ? await this.catalog.findPurchasableCombos(
            comboLines.map(({ productId }) => productId),
          )
        : []);
    const comboById = new Map(
      currentCombos.map((combo) => [combo.productId, combo]),
    );
    const comboGroups: AuthoritativeQuote["comboGroups"] = [];
    const comboComponentLines: AuthoritativeQuote["lines"] = [];
    for (const line of comboLines) {
      const current = comboById.get(line.productId);
      if (!current || current.revision !== line.comboRevision) {
        throw new UnprocessableEntityException(
          "A combo changed. Review its current options before checkout.",
          { errorCode: "QUOTE_CATALOG_CHANGED" },
        );
      }
      const validatedSelections = assertComboSelections(
        current.combo,
        line.selections,
        line.quantity,
      );
      const selectedComponents = validatedSelections.map((selection) => {
        const component = current.combo.components.find(
          ({ id }) => id === selection.componentId,
        )!;
        const catalogVariant = byId.get(selection.variantId);
        const comboVariant = component.variants.find(
          ({ variantId }) => variantId === selection.variantId,
        );
        if (!catalogVariant || !comboVariant) {
          throw new UnprocessableEntityException(
            "A selected combo variant is no longer available.",
            { errorCode: "QUOTE_CATALOG_CHANGED" },
          );
        }
        return {
          componentId: component.id,
          selectionIndex: selection.selectionIndex,
          variantId: selection.variantId,
          productName: catalogVariant.name,
          color: catalogVariant.color,
          sizeLabel: catalogVariant.sizeLabel,
          unitPriceBdt: catalogVariant.unitPriceBdt,
          compareAtPriceBdt: catalogVariant.compareAtPriceBdt,
        };
      });
      const groupGrossAmountBdt = safeAmount(
        BigInt(current.priceBdt) * BigInt(line.quantity),
      );
      const groupId = line.lineId;
      comboGroups.push({
        groupId,
        productId: line.productId,
        comboRevision: current.revision,
        comboName: current.name,
        selectionMode: current.combo.selectionMode,
        quantity: line.quantity,
        unitPriceBdt: current.priceBdt,
        grossAmountBdt: groupGrossAmountBdt,
        selections: selectedComponents,
      });
      const baseAllocation = Math.floor(
        current.priceBdt / selectedComponents.length,
      );
      let allocated = 0;
      for (const [index, selected] of selectedComponents.entries()) {
        const allocation =
          index === selectedComponents.length - 1
            ? current.priceBdt - allocated
            : baseAllocation;
        allocated += allocation;
        comboComponentLines.push({
          variantId: selected.variantId,
          selectionIndex: selected.selectionIndex,
          comboGroupId: groupId,
          productName: selected.productName,
          color: selected.color,
          sizeLabel: selected.sizeLabel,
          quantity: line.quantity,
          unitPriceBdt: allocation,
          compareAtPriceBdt: selected.compareAtPriceBdt,
          grossAmountBdt: safeAmount(
            BigInt(allocation) * BigInt(line.quantity),
          ),
        });
      }
    }
    const lines = [...standaloneLines, ...comboComponentLines];
    if (lines.length > MAX_QUOTE_COMPONENT_LINES) {
      throw new UnprocessableEntityException(
        "This cart has too many physical items to place as one order.",
        { errorCode: "QUOTE_LINE_LIMIT" },
      );
    }
    const merchandiseGrossBdt = safeAmount(
      [
        ...standaloneLines.map(({ grossAmountBdt }) => grossAmountBdt),
        ...comboGroups.map(({ grossAmountBdt }) => grossAmountBdt),
      ].reduce((sum, amount) => sum + BigInt(amount), 0n),
    );
    const totalBdt = safeAmount(
      BigInt(merchandiseGrossBdt) + BigInt(tariff.feeBdt),
    );
    return {
      destination,
      tariff,
      lines,
      comboGroups,
      merchandiseGrossBdt,
      totalBdt,
    };
  }

  async get(
    customerId: string | undefined,
    guestCartId: string | undefined,
    id: string,
    destinationRef: QuoteDestinationRef,
  ): Promise<QuoteLookup> {
    const context = await this.cart.getQuoteContext(customerId, guestCartId);
    if (!context.owner) throw quoteNotFound();
    const ownerCondition = quoteOwnerCondition(context.owner);
    const [result] = await this.database.db
      .select({
        row: quoteSnapshot,
        isUnexpired: sql<boolean>`${quoteSnapshot.expiresAt} > clock_timestamp()`,
      })
      .from(quoteSnapshot)
      .where(and(eq(quoteSnapshot.id, id), ownerCondition))
      .limit(1);
    if (!result) throw quoteNotFound();

    return this.lookupQuote(
      context,
      result.row,
      destinationRef,
      result.isUnexpired,
    );
  }

  private async lookupQuote(
    context: CartQuoteContext,
    row: QuoteRow,
    destinationRef: QuoteDestinationRef,
    isUnexpired: boolean,
    isLatest?: boolean,
  ): Promise<QuoteLookup> {
    if (!context.owner) throw quoteNotFound();
    const ownerCondition = quoteOwnerCondition(context.owner);
    if (!isUnexpired) {
      return QuoteLookupSchema.parse({
        status: "expired",
        quoteId: row.id,
        expiresAt: row.expiresAt.toISOString(),
      });
    }

    if (!sameDestination(row, destinationRef))
      return stale(row.id, "destination_requoted");
    if (
      context.cart.revision !== row.cartRevision ||
      !sameCartLines(context.cart, row.lines, row.comboGroups)
    ) {
      return stale(row.id, "cart_changed");
    }
    if (isLatest === false) return stale(row.id, "destination_requoted");

    const variants = context.catalogVariants;
    if (
      !sameCatalogLines(
        row.lines,
        row.comboGroups,
        variants,
        context.catalogCombos,
      )
    )
      return stale(row.id, "catalog_changed");

    let currentTariff: Awaited<
      ReturnType<DeliveryService["resolveDeliveryFee"]>
    >;
    try {
      currentTariff = await this.delivery.resolveDeliveryFee(
        row.geographyVersion,
        row.districtId,
        row.upazilaId ?? undefined,
      );
    } catch (error) {
      if (
        error instanceof UnprocessableEntityException &&
        ["DELIVERY_UPAZILA_REQUIRED", "DELIVERY_UNAVAILABLE"].includes(
          exceptionErrorCode(error) ?? "",
        )
      ) {
        return stale(row.id, "delivery_tariff_changed");
      }
      throw error;
    }
    if (
      currentTariff.version !== row.deliveryTariffVersion ||
      currentTariff.effectiveFrom !== row.deliveryTariffEffectiveFrom ||
      currentTariff.zone !== row.deliveryZone ||
      currentTariff.feeBdt !== row.deliveryAmountBdt
    ) {
      return stale(row.id, "delivery_tariff_changed");
    }
    if (isLatest === undefined) {
      const [newest] = await this.database.db
        .select({ id: quoteSnapshot.id })
        .from(quoteSnapshot)
        .where(ownerCondition)
        .orderBy(desc(quoteSnapshot.createdAt), desc(quoteSnapshot.id))
        .limit(1);
      if (newest && newest.id !== row.id)
        return stale(row.id, "destination_requoted");
    }

    return QuoteLookupSchema.parse({
      status: "current",
      quote: this.toPublicQuote(row),
    });
  }

  /** Internal checkout boundary: only returns a quote after owner and currentness checks. */
  async getCurrentForCheckout(
    customerId: string | undefined,
    guestCartId: string | undefined,
    rawId: string,
    existingContext?: CartQuoteContext,
  ): Promise<AuthoritativeQuote> {
    const parsedId = QuoteIdSchema.safeParse(rawId);
    if (!parsedId.success) throw quoteNotFound();
    const requestedOwner = this.cart.identifyQuoteOwner(
      customerId,
      guestCartId,
    );
    const context =
      existingContext ??
      (await this.cart.getQuoteContext(customerId, guestCartId));
    const owner = context.owner;
    if (!owner || !sameCartQuoteOwner(owner, requestedOwner)) {
      throw quoteNotFound();
    }
    const newerQuoteOwnerCondition =
      owner.kind === "customer"
        ? eq(newerQuoteSnapshot.customerId, owner.customerId)
        : eq(newerQuoteSnapshot.guestCartHash, owner.guestCartHash);
    const newerQuote = this.database.db
      .select({ id: newerQuoteSnapshot.id })
      .from(newerQuoteSnapshot)
      .where(
        and(
          newerQuoteOwnerCondition,
          or(
            gt(newerQuoteSnapshot.createdAt, quoteSnapshot.createdAt),
            and(
              eq(newerQuoteSnapshot.createdAt, quoteSnapshot.createdAt),
              gt(newerQuoteSnapshot.id, quoteSnapshot.id),
            ),
          ),
        ),
      )
      .limit(1);
    const [result] = await this.database.db
      .select({
        row: quoteSnapshot,
        isUnexpired: sql<boolean>`${quoteSnapshot.expiresAt} > clock_timestamp()`,
        isLatest: sql<boolean>`not ${exists(newerQuote)}`,
      })
      .from(quoteSnapshot)
      .where(
        and(eq(quoteSnapshot.id, parsedId.data), quoteOwnerCondition(owner)),
      )
      .limit(1);
    if (!result) throw quoteNotFound();

    const lookup = await this.lookupQuote(
      context,
      result.row,
      {
        geographyVersion: result.row.geographyVersion,
        divisionId: result.row.divisionId,
        districtId: result.row.districtId,
        ...(result.row.upazilaId ? { upazilaId: result.row.upazilaId } : {}),
      },
      result.isUnexpired,
      result.isLatest,
    );
    if (lookup.status === "expired") {
      throw new ConflictException(
        "The quote has expired. Request a new quote.",
        {
          errorCode: "QUOTE_EXPIRED",
        },
      );
    }
    if (lookup.status === "stale") {
      throw new ConflictException(
        "The quote is no longer current. Request a new quote.",
        {
          errorCode: "QUOTE_STALE",
        },
      );
    }
    return lookup.quote;
  }

  async lockAndValidateForOrderCheckout(
    transaction: AuditTransaction,
    quote: AuthoritativeQuote,
    owner: CartQuoteOwner,
  ): Promise<void> {
    await lockCartQuoteOwner(transaction, owner);

    const [row] = await transaction
      .select({ id: quoteSnapshot.id })
      .from(quoteSnapshot)
      .where(
        and(
          eq(quoteSnapshot.id, quote.id),
          quoteOwnerCondition(owner),
          sql`${quoteSnapshot.expiresAt} > clock_timestamp()`,
        ),
      )
      .limit(1);
    if (!row) {
      throw new ConflictException("The quote expired during checkout.", {
        errorCode: "QUOTE_EXPIRED",
      });
    }

    const [newest] = await transaction
      .select({ id: quoteSnapshot.id })
      .from(quoteSnapshot)
      .where(quoteOwnerCondition(owner))
      .orderBy(desc(quoteSnapshot.createdAt), desc(quoteSnapshot.id))
      .limit(1);
    if (!newest || newest.id !== quote.id) {
      throw new ConflictException(
        "A newer delivery quote exists. Request a fresh quote.",
        { errorCode: "QUOTE_STALE" },
      );
    }

    const variants =
      await this.catalog.findPurchasableVariantsWithinTransaction(transaction, [
        ...new Set(quote.lines.map(({ variantId }) => variantId)),
      ]);
    const combos = await this.catalog.findPurchasableCombosWithinTransaction(
      transaction,
      quote.comboGroups.map(({ productId }) => productId),
    );
    if (!sameCatalogLines(quote.lines, quote.comboGroups, variants, combos)) {
      throw new ConflictException(
        "The catalog changed during checkout. Request a fresh quote.",
        { errorCode: "QUOTE_STALE" },
      );
    }

    let currentTariff: Awaited<
      ReturnType<DeliveryService["resolveDeliveryFee"]>
    >;
    try {
      currentTariff = await this.delivery.resolveDeliveryFeeWithinTransaction(
        transaction,
        quote.destination.geographyVersion,
        quote.destination.districtId,
        quote.destination.upazilaId ?? undefined,
      );
    } catch (error) {
      if (
        error instanceof UnprocessableEntityException &&
        ["DELIVERY_UPAZILA_REQUIRED", "DELIVERY_UNAVAILABLE"].includes(
          exceptionErrorCode(error) ?? "",
        )
      ) {
        throw new ConflictException(
          "Delivery pricing changed during checkout. Request a fresh quote.",
          { errorCode: "QUOTE_STALE" },
        );
      }
      throw error;
    }
    if (
      currentTariff.version !== quote.delivery.tariffVersion ||
      currentTariff.effectiveFrom !== quote.delivery.effectiveFrom ||
      currentTariff.geographyVersion !== quote.destination.geographyVersion ||
      currentTariff.zone !== quote.delivery.zone ||
      currentTariff.feeBdt !== quote.delivery.grossAmountBdt
    ) {
      throw new ConflictException(
        "Delivery pricing changed during checkout. Request a fresh quote.",
        { errorCode: "QUOTE_STALE" },
      );
    }
  }

  async pruneExpiredUnreferenced(batchSize = 500): Promise<number> {
    const result = await this.database.db.execute(sql`
      select quote.prune_expired_unreferenced(${batchSize}) as deleted_count
    `);
    return Number(result.rows[0]?.deleted_count ?? 0);
  }

  private toPublicQuote(
    row: typeof quoteSnapshot.$inferSelect,
  ): AuthoritativeQuote {
    return AuthoritativeQuoteSchema.parse({
      schemaVersion: row.schemaVersion,
      id: row.id,
      currency: QUOTE_CURRENCY,
      cartRevision: row.cartRevision,
      lines: row.lines,
      comboGroups: row.comboGroups,
      merchandiseGrossBdt: row.merchandiseGrossBdt,
      destination: {
        geographyVersion: row.geographyVersion,
        divisionId: row.divisionId,
        divisionName: row.divisionName,
        districtId: row.districtId,
        districtName: row.districtName,
        upazilaId: row.upazilaId,
        upazilaName: row.upazilaName,
      },
      delivery: {
        tariffVersion: row.deliveryTariffVersion,
        effectiveFrom: row.deliveryTariffEffectiveFrom,
        zone: row.deliveryZone as AuthoritativeQuote["delivery"]["zone"],
        grossAmountBdt: row.deliveryAmountBdt,
      },
      totalBdt: row.totalBdt,
      validityPolicyVersion: row.validityPolicyVersion,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
  }
}

function quoteOwnerCondition(owner: CartQuoteOwner) {
  return owner.kind === "customer"
    ? eq(quoteSnapshot.customerId, owner.customerId)
    : eq(quoteSnapshot.guestCartHash, owner.guestCartHash);
}

function sameCartQuoteOwner(
  left: CartQuoteOwner | null,
  right: CartQuoteOwner | null,
): boolean {
  if (!left || !right || left.kind !== right.kind) return false;
  return left.kind === "customer"
    ? right.kind === "customer" && left.customerId === right.customerId
    : right.kind === "guest" && left.guestCartHash === right.guestCartHash;
}

async function lockCartQuoteOwner(
  transaction: AuditTransaction,
  owner: CartQuoteOwner,
): Promise<void> {
  await lockCartOwner(
    transaction,
    owner.kind,
    owner.kind === "customer" ? owner.customerId : owner.guestCartHash,
  );
}

function sameDestination(
  row: typeof quoteSnapshot.$inferSelect,
  ref: QuoteDestinationRef,
): boolean {
  return (
    row.geographyVersion === ref.geographyVersion &&
    row.divisionId === ref.divisionId &&
    row.districtId === ref.districtId &&
    row.upazilaId === (ref.upazilaId ?? null)
  );
}

function sameCartLines(
  cart: Awaited<ReturnType<CartService["getCart"]>>,
  rawLines: unknown,
  rawComboGroups: unknown,
): boolean {
  const lines = parseQuoteLines(rawLines);
  const comboGroups = parseQuoteComboGroups(rawComboGroups);
  const standaloneLines = lines.filter(({ comboGroupId }) => !comboGroupId);
  return (
    cart.lines.length === standaloneLines.length &&
    cart.lines.every(
      (line, index) =>
        line.variantId === standaloneLines[index]?.variantId &&
        line.quantity === standaloneLines[index]?.quantity &&
        line.availability === "available",
    ) &&
    cart.combos.length === comboGroups.length &&
    cart.combos.every((line) => {
      const group = comboGroups.find(({ groupId }) => groupId === line.lineId);
      return (
        line.availability === "available" &&
        !!group &&
        group.productId === line.productId &&
        group.comboRevision === line.comboRevision &&
        group.quantity === line.quantity &&
        group.selections.length === line.selections.length &&
        group.selections.every(
          (selection, index) =>
            line.selections[index]?.componentId === selection.componentId &&
            line.selections[index]?.variantId === selection.variantId,
        )
      );
    })
  );
}

function sameCatalogLines(
  rawLines: unknown,
  rawComboGroups: unknown,
  variants: readonly PurchasableCatalogVariant[],
  combos: readonly PurchasableCatalogCombo[],
): boolean {
  const lines = parseQuoteLines(rawLines);
  const comboGroups = parseQuoteComboGroups(rawComboGroups);
  const byId = new Map(variants.map((variant) => [variant.variantId, variant]));
  const standaloneLines = lines.filter(({ comboGroupId }) => !comboGroupId);
  const standaloneMatches = standaloneLines.every((line) => {
    const variant = byId.get(line.variantId);
    return (
      !!variant &&
      line.productName === variant.name &&
      line.color === variant.color &&
      line.sizeLabel === variant.sizeLabel &&
      line.unitPriceBdt === variant.unitPriceBdt
    );
  });
  if (!standaloneMatches) return false;
  if (comboGroups.length === 0) {
    return lines.every((line) => !line.comboGroupId);
  }
  const comboById = new Map(combos.map((combo) => [combo.productId, combo]));
  return comboGroups.every((group) => {
    const combo = comboById.get(group.productId);
    if (
      !combo ||
      combo.revision !== group.comboRevision ||
      combo.priceBdt !== group.unitPriceBdt ||
      combo.name !== group.comboName ||
      combo.combo.selectionMode !== group.selectionMode
    ) {
      return false;
    }
    try {
      assertComboSelections(
        combo.combo,
        group.selections.map(({ componentId, variantId }) => ({
          componentId,
          variantId,
        })),
        group.quantity,
      );
    } catch {
      return false;
    }
    const children = lines.filter(
      ({ comboGroupId }) => comboGroupId === group.groupId,
    );
    if (children.length !== group.selections.length) return false;
    return group.selections.every((selection) => {
      const variant = byId.get(selection.variantId);
      const child = children.find((line) =>
        selection.selectionIndex === undefined
          ? line.selectionIndex === undefined &&
            line.variantId === selection.variantId
          : line.selectionIndex === selection.selectionIndex,
      );
      return (
        !!variant &&
        !!child &&
        child.quantity === group.quantity &&
        selection.productName === variant.name &&
        selection.color === variant.color &&
        selection.sizeLabel === variant.sizeLabel &&
        selection.unitPriceBdt === variant.unitPriceBdt &&
        selection.compareAtPriceBdt === variant.compareAtPriceBdt
      );
    });
  });
}

function parseQuoteLines(value: unknown): AuthoritativeQuote["lines"] {
  const result = AuthoritativeQuoteSchema.shape.lines.safeParse(value);
  if (!result.success)
    throw new ServiceUnavailableException(
      "A stored quote snapshot is invalid.",
    );
  return result.data;
}

function parseQuoteComboGroups(
  value: unknown,
): AuthoritativeQuote["comboGroups"] {
  const result = AuthoritativeQuoteSchema.shape.comboGroups.safeParse(value);
  if (!result.success) {
    throw new ServiceUnavailableException(
      "A stored quote combo snapshot is invalid.",
    );
  }
  return result.data;
}

function stale(
  quoteId: string,
  reason: Extract<QuoteLookup, { status: "stale" }>["reason"],
): QuoteLookup {
  return QuoteLookupSchema.parse({ status: "stale", quoteId, reason });
}

function exceptionErrorCode(
  error: UnprocessableEntityException,
): string | null {
  const response = error.getResponse();
  if (
    typeof response === "object" &&
    response !== null &&
    "errorCode" in response &&
    typeof response.errorCode === "string"
  ) {
    return response.errorCode;
  }
  return null;
}

function quoteNotFound(): NotFoundException {
  return new NotFoundException("Quote not found.", {
    errorCode: "QUOTE_NOT_FOUND",
  });
}

function safeAmount(value: bigint): number {
  const amount = Number(value);
  if (value < 0n || !Number.isSafeInteger(amount)) {
    throw new UnprocessableEntityException(
      "The quote amount exceeds the supported BDT range.",
      {
        errorCode: "QUOTE_AMOUNT_OUT_OF_RANGE",
      },
    );
  }
  return amount;
}
