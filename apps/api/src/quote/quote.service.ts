import {
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
import { TaxService, type ResolvedTaxProfile } from "../tax/tax.service.js";
import { calculateInclusiveTaxBdt } from "../tax/inclusive-tax.js";

type TaxComponent = AuthoritativeQuote["tax"]["merchandise"];

@Injectable()
export class QuoteService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cart: CartService,
    @Inject(CATALOG_CART_PORT) private readonly catalog: CatalogCartPort,
    private readonly geography: GeographyService,
    private readonly delivery: DeliveryService,
    private readonly tax: TaxService,
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
    const tariff = await this.delivery.resolveDistrictFee(
      input.geographyVersion,
      destination.district.id,
    );
    const profile = await this.tax.getCurrentProfile();
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
    const merchandiseTax = taxComponent(
      merchandiseGrossBdt,
      profile,
      "product",
    );
    const deliveryTax = taxComponent(tariff.feeBdt, profile, "delivery");
    const totalTaxAmountBdt = safeAmount(
      BigInt(merchandiseTax.taxAmountBdt) + BigInt(deliveryTax.taxAmountBdt),
    );
    const totalBdt = safeAmount(
      BigInt(merchandiseGrossBdt) + BigInt(tariff.feeBdt),
    );
    const profileSnapshot = toTaxProfileSnapshot(profile);

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
        deliveryAmountBdt: tariff.feeBdt,
        taxProfileVersion: profile.version,
        taxSourceReference: profile.sourceReference,
        taxSourceVersion: profile.sourceVersion,
        taxRoundingRule: profile.roundingRule,
        taxProfileSnapshot: profileSnapshot,
        merchandiseTaxSnapshot: merchandiseTax,
        deliveryTaxSnapshot: deliveryTax,
        lines,
        merchandiseGrossBdt,
        totalTaxAmountBdt,
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

    const [currentTariff, currentProfile] = await Promise.all([
      this.delivery.resolveDistrictFee(row.geographyVersion, row.districtId),
      this.tax.getCurrentProfile(),
    ]);
    if (
      currentTariff.version !== row.deliveryTariffVersion ||
      currentTariff.effectiveFrom !== row.deliveryTariffEffectiveFrom ||
      currentTariff.feeBdt !== row.deliveryAmountBdt
    ) {
      return stale(row.id, "delivery_tariff_changed");
    }
    if (
      currentProfile.version !== row.taxProfileVersion ||
      stableJson(toTaxProfileSnapshot(currentProfile)) !==
        stableJson(row.taxProfileSnapshot)
    ) {
      return stale(row.id, "tax_rule_changed");
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
        grossAmountBdt: row.deliveryAmountBdt,
        tax: row.deliveryTaxSnapshot,
      },
      tax: {
        profileVersion: row.taxProfileVersion,
        sourceReference: row.taxSourceReference,
        sourceVersion: row.taxSourceVersion,
        pricePresentation: "vat_inclusive",
        roundingRule: row.taxRoundingRule,
        merchandise: row.merchandiseTaxSnapshot,
        totalTaxAmountBdt: row.totalTaxAmountBdt,
      },
      totalBdt: row.totalBdt,
      validityPolicyVersion: row.validityPolicyVersion,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
  }
}

function taxComponent(
  grossAmountBdt: number,
  profile: ResolvedTaxProfile,
  target: "product" | "delivery",
): TaxComponent {
  const isDelivery = target === "delivery";
  const treatment = isDelivery
    ? profile.deliveryTreatment
    : profile.productTreatment;
  const numerator = isDelivery
    ? profile.deliveryRateNumerator
    : profile.productRateNumerator;
  const denominator = isDelivery
    ? profile.deliveryRateDenominator
    : profile.productRateDenominator;
  const result = calculateInclusiveTaxBdt({
    grossAmountBdt,
    treatment: treatment as "taxable" | "exempt",
    rateNumerator: numerator,
    rateDenominator: denominator,
  });
  return {
    treatment: treatment as "taxable" | "exempt",
    grossAmountBdt,
    ...result,
    rateNumerator: numerator,
    rateDenominator: denominator,
  };
}

function toTaxProfileSnapshot(profile: ResolvedTaxProfile) {
  return {
    version: profile.version,
    effectiveFrom: profile.effectiveFrom,
    effectiveTo: profile.effectiveTo,
    legalMerchantReference: profile.legalMerchantReference,
    registrationStatus: profile.registrationStatus,
    registrationReference: profile.registrationReference,
    operatingModel: profile.operatingModel,
    pricePresentation: profile.pricePresentation,
    productTreatment: profile.productTreatment,
    productRateNumerator: profile.productRateNumerator,
    productRateDenominator: profile.productRateDenominator,
    deliveryTreatment: profile.deliveryTreatment,
    deliveryRateNumerator: profile.deliveryRateNumerator,
    deliveryRateDenominator: profile.deliveryRateDenominator,
    roundingRule: profile.roundingRule,
    sourceReference: profile.sourceReference,
    sourceVersion: profile.sourceVersion,
    approvalReference: profile.approvalReference,
    approved: profile.approved,
  };
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

function stableJson(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortObjectKeys(item)]),
    );
  }
  return value;
}

function stale(
  quoteId: string,
  reason: Extract<QuoteLookup, { status: "stale" }>["reason"],
): QuoteLookup {
  return QuoteLookupSchema.parse({ status: "stale", quoteId, reason });
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
