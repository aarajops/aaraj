import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  pgSchema,
  text,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";

export const taxSchema = pgSchema("tax");

export const taxProfile = taxSchema.table(
  "profile",
  {
    version: text("version").primaryKey(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    legalMerchantReference: text("legal_merchant_reference").notNull(),
    registrationStatus: text("registration_status").notNull(),
    registrationReference: text("registration_reference"),
    operatingModel: text("operating_model").notNull(),
    pricePresentation: text("price_presentation").notNull(),
    productTreatment: text("product_treatment").notNull(),
    productRateNumerator: integer("product_rate_numerator"),
    productRateDenominator: integer("product_rate_denominator"),
    deliveryTreatment: text("delivery_treatment").notNull(),
    deliveryRateNumerator: integer("delivery_rate_numerator"),
    deliveryRateDenominator: integer("delivery_rate_denominator"),
    roundingRule: text("rounding_rule").notNull(),
    sourceReference: text("source_reference").notNull(),
    sourceVersion: text("source_version").notNull(),
    approvalReference: text("approval_reference"),
    approved: boolean("approved").notNull().default(false),
    testOnly: boolean("test_only").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "profile_version_format_check",
      sql`${table.version} ~ '^(TEST_ONLY_)?BD_RETAIL_TAX_RULE_[A-Z0-9_]+$'`,
    ),
    check(
      "profile_test_scope_check",
      sql`${table.testOnly} = (left(${table.version}, 10) = 'TEST_ONLY_')`,
    ),
    check(
      "profile_effective_range_check",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
    check(
      "profile_legal_reference_check",
      sql`${table.legalMerchantReference} = btrim(${table.legalMerchantReference}) and length(${table.legalMerchantReference}) between 1 and 300`,
    ),
    check(
      "profile_registration_status_check",
      sql`${table.registrationStatus} in ('registered', 'enlisted', 'not_required', 'unresolved')`,
    ),
    check(
      "profile_model_check",
      sql`${table.operatingModel} = 'direct_retailer'`,
    ),
    check(
      "profile_price_presentation_check",
      sql`${table.pricePresentation} = 'vat_inclusive'`,
    ),
    check(
      "profile_product_tax_rule_check",
      sql`(${table.productTreatment} = 'taxable' and ${table.productRateNumerator} between 1 and 1000000000 and ${table.productRateDenominator} between 1 and 1000000000) or (${table.productTreatment} = 'exempt' and ${table.productRateNumerator} is null and ${table.productRateDenominator} is null)`,
    ),
    check(
      "profile_delivery_tax_rule_check",
      sql`(${table.deliveryTreatment} = 'taxable' and ${table.deliveryRateNumerator} between 1 and 1000000000 and ${table.deliveryRateDenominator} between 1 and 1000000000) or (${table.deliveryTreatment} = 'exempt' and ${table.deliveryRateNumerator} is null and ${table.deliveryRateDenominator} is null)`,
    ),
    check(
      "profile_rounding_rule_check",
      sql`${table.roundingRule} = 'half_up_bdt_v1'`,
    ),
    check(
      "profile_source_check",
      sql`${table.sourceReference} = btrim(${table.sourceReference}) and length(${table.sourceReference}) between 1 and 500 and ${table.sourceVersion} = btrim(${table.sourceVersion}) and length(${table.sourceVersion}) between 1 and 120`,
    ),
  ],
);
