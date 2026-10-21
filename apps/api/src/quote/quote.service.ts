import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  AuthoritativeQuoteSchema,
  QUOTE_CURRENCY,
  QUOTE_SCHEMA_VERSION,
  QUOTE_VALIDITY_POLICY_VERSION,
  QuoteLookupSchema,
  QuoteIdSchema,
  type AuthoritativeQuote,
  type QuoteDestinationInput,
  type QuoteDestinationRef,
  type QuoteLookup,
} from "@aaraj/contracts";
import { and, desc, eq, sql } from "drizzle-orm";
import { CartService, type CartQuoteOwner } from "../cart/cart.service.js";
import {
  CATALOG_CART_PORT,
  type CatalogCartPort,
} from "../catalog/catalog-cart.port.js";
import { Inject } from "@nestjs/common";
import { DatabaseService } from "../platform/database/database.service.js";
import { DeliveryService } from "../delivery/delivery.service.js";
import { GeographyService } from "../geography/geography.service.js";
import { quoteSnapshot } from "./quote-schema.js";

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
    if (!context.owner || context.cart.lines.length === 0) {
      throw new UnprocessableEntityException(
        "Add an available item before requesting a quote.",
        {
          errorCode: "QUOTE_CART_EMPTY",
        },
      );
    }
    if (context.cart.lines.some((line) => line.availability !== "available")) {
      throw new UnprocessableEntityException(
        "Remove unavailable items before requesting a quote.",
        {
          errorCode: "QUOTE_CART_UNAVAILABLE",
        },
      );
    }

    const destination = await this.geography.resolveDestination(input);
    const tariff = await this.delivery.resolveDeliveryFee(
      input.geographyVersion,
      destination.district.id,
      destination.upazila?.id,
    );
    const variants = await this.catalog.findPurchasableVariants(
      context.cart.lines.map(({ variantId }) => variantId),
    );
    const byId = new Map(
      variants.map((variant) => [variant.variantId, variant]),
    );
    const lines = context.cart.lines.map((line) => {
      const variant = byId.get(line.variantId);
      if (!variant) {
        throw new UnprocessableEntityException(
          "A cart item is no longer available. Refresh the cart and try again.",
          {
            errorCode: "QUOTE_CATALOG_CHANGED",
          },
        );
      }
      const grossAmountBdt = safeAmount(
        BigInt(variant.unitPriceBdt) * BigInt(line.quantity),
      );
      return {
        variantId: variant.variantId,
        productName: variant.name,
        color: variant.color,
        sizeLabel: variant.sizeLabel,
        quantity: line.quantity,
        unitPriceBdt: variant.unitPriceBdt,
        grossAmountBdt,
      };
    });
    const merchandiseGrossBdt = safeAmount(
      lines.reduce((sum, line) => sum + BigInt(line.grossAmountBdt), 0n),
    );
    const totalBdt = safeAmount(
      BigInt(merchandiseGrossBdt) + BigInt(tariff.feeBdt),
    );
    const [saved] = await this.database.db
      .insert(quoteSnapshot)
      .values({
        schemaVersion: QUOTE_SCHEMA_VERSION,
        customerId:
          context.owner.kind === "customer" ? context.owner.customerId : null,
        guestCartHash:
          context.owner.kind === "guest" ? context.owner.guestCartHash : null,
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
        merchandiseGrossBdt,
        totalBdt,
        validityPolicyVersion: QUOTE_VALIDITY_POLICY_VERSION,
        createdAt: sql`now()`,
        expiresAt: sql`now() + interval '15 minutes'`,
      })
      .returning();
    if (!saved)
      throw new ServiceUnavailableException("The quote could not be saved.");
    return this.toPublicQuote(saved);
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
    const [row] = await this.database.db
      .select()
      .from(quoteSnapshot)
      .where(and(eq(quoteSnapshot.id, id), ownerCondition))
      .limit(1);
    if (!row) throw quoteNotFound();

    const [databaseClock] = await this.database.db
      .select({ now: sql<string>`now()` })
      .from(quoteSnapshot)
      .where(eq(quoteSnapshot.id, row.id))
      .limit(1);
    if (
      !databaseClock ||
      row.expiresAt.getTime() <= new Date(databaseClock.now).getTime()
    ) {
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
      !sameCartLines(context.cart, row.lines)
    ) {
      return stale(row.id, "cart_changed");
    }

    const variants = await this.catalog.findPurchasableVariants(
      context.cart.lines.map(({ variantId }) => variantId),
    );
    if (!sameCatalogLines(row.lines, variants))
      return stale(row.id, "catalog_changed");

    const currentTariffVersion = await this.delivery.getCurrentVersion();
    if (currentTariffVersion !== row.deliveryTariffVersion) {
      return stale(row.id, "delivery_tariff_changed");
    }

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
    const [newest] = await this.database.db
      .select({ id: quoteSnapshot.id })
      .from(quoteSnapshot)
      .where(ownerCondition)
      .orderBy(desc(quoteSnapshot.createdAt), desc(quoteSnapshot.id))
      .limit(1);
    if (newest && newest.id !== row.id)
      return stale(row.id, "destination_requoted");

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
  ): Promise<AuthoritativeQuote> {
    const parsedId = QuoteIdSchema.safeParse(rawId);
    if (!parsedId.success) throw quoteNotFound();
    const context = await this.cart.getQuoteContext(customerId, guestCartId);
    if (!context.owner) throw quoteNotFound();
    const [row] = await this.database.db
      .select()
      .from(quoteSnapshot)
      .where(
        and(
          eq(quoteSnapshot.id, parsedId.data),
          quoteOwnerCondition(context.owner),
        ),
      )
      .limit(1);
    if (!row) throw quoteNotFound();

    const lookup = await this.get(customerId, guestCartId, parsedId.data, {
      geographyVersion: row.geographyVersion,
      divisionId: row.divisionId,
      districtId: row.districtId,
      ...(row.upazilaId ? { upazilaId: row.upazilaId } : {}),
    });
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

  private toPublicQuote(
    row: typeof quoteSnapshot.$inferSelect,
  ): AuthoritativeQuote {
    return AuthoritativeQuoteSchema.parse({
      schemaVersion: row.schemaVersion,
      id: row.id,
      currency: QUOTE_CURRENCY,
      cartRevision: row.cartRevision,
      lines: row.lines,
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
): boolean {
  const lines = parseQuoteLines(rawLines);
  return (
    cart.lines.length === lines.length &&
    cart.lines.every(
      (line, index) =>
        line.variantId === lines[index]?.variantId &&
        line.quantity === lines[index]?.quantity &&
        line.availability === "available",
    )
  );
}

function sameCatalogLines(
  rawLines: unknown,
  variants: Awaited<ReturnType<CatalogCartPort["findPurchasableVariants"]>>,
): boolean {
  const lines = parseQuoteLines(rawLines);
  if (lines.length !== variants.length) return false;
  const byId = new Map(variants.map((variant) => [variant.variantId, variant]));
  return lines.every((line) => {
    const variant = byId.get(line.variantId);
    return (
      !!variant &&
      line.productName === variant.name &&
      line.color === variant.color &&
      line.sizeLabel === variant.sizeLabel &&
      line.unitPriceBdt === variant.unitPriceBdt
    );
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
