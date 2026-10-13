import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import type { TaxSettings, TaxSettingsUpdate } from "@aaraj/contracts";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { DatabaseService } from "../platform/database/database.service.js";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import { TaxPolicy } from "./tax.policy.js";
import { bangladeshBusinessDate } from "../delivery/delivery.service.js";
import { taxConfiguration, taxProfile } from "./tax-schema.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";

export type ResolvedTaxProfile = typeof taxProfile.$inferSelect;

export type QuoteTaxState =
  | {
      mode: "disabled";
      profile: null;
      profileSnapshot: { mode: "disabled" };
    }
  | {
      mode: "inclusive";
      profile: ResolvedTaxProfile;
      profileSnapshot: ReturnType<typeof toTaxProfileSnapshot>;
    };

@Injectable()
export class TaxService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async getCurrentQuoteState(): Promise<QuoteTaxState> {
    const configuration = await this.readConfiguration(this.database.db);
    if (!configuration.enabled) {
      return {
        mode: "disabled",
        profile: null,
        profileSnapshot: { mode: "disabled" },
      };
    }

    const profile = await this.getCurrentProfile(this.database.db);
    return {
      mode: "inclusive",
      profile,
      profileSnapshot: toTaxProfileSnapshot(profile),
    };
  }

  async getManagementSettings(actor: AccessPrincipal): Promise<TaxSettings> {
    await this.authorization.authorize(TaxPolicy, "manage", actor);
    const configuration = await this.readConfiguration(this.database.db);
    return this.toManagementSettings(configuration);
  }

  async updateSettings(
    actor: AccessPrincipal,
    input: TaxSettingsUpdate,
  ): Promise<TaxSettings> {
    const updated = await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        TaxPolicy,
        "manage",
        actor,
        transaction,
      );
      const [current] = await transaction
        .select()
        .from(taxConfiguration)
        .where(eq(taxConfiguration.id, "default"))
        .for("update")
        .limit(1);
      if (!current) throw taxConfigurationUnavailable();

      if (input.enabled) {
        try {
          await this.getCurrentProfile(transaction);
        } catch (error) {
          if (error instanceof ServiceUnavailableException) {
            throw new ConflictException(
              "An approved current tax profile must be configured before tax can be enabled.",
              { errorCode: "TAX_PROFILE_REQUIRED" },
            );
          }
          throw error;
        }
      }

      if (current.enabled === input.enabled) return current;

      const [next] = await transaction
        .update(taxConfiguration)
        .set({
          enabled: input.enabled,
          updatedAt: sql`now()`,
          updatedBy: actor.id,
        })
        .where(eq(taxConfiguration.id, "default"))
        .returning();
      if (!next) throw taxConfigurationUnavailable();

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "tax.calculation_setting_changed",
        subjectType: "tax_configuration",
        subjectId: "default",
        reason: input.reason,
        metadata: { enabled: input.enabled, previousEnabled: current.enabled },
      });
      return next;
    });

    return this.toManagementSettings(updated);
  }

  async getCurrentProfile(
    database: DatabaseService["db"] | AuditTransaction = this.database.db,
  ): Promise<ResolvedTaxProfile> {
    const testOnly = process.env.NODE_ENV === "test";
    const date = bangladeshBusinessDate();
    const profiles = await database
      .select()
      .from(taxProfile)
      .where(
        and(
          eq(taxProfile.testOnly, testOnly),
          lte(taxProfile.effectiveFrom, date),
          or(isNull(taxProfile.effectiveTo), gt(taxProfile.effectiveTo, date)),
        ),
      )
      .limit(2);
    if (profiles.length !== 1) throw taxProfileUnavailable();
    const profile = profiles[0]!;
    if (
      !profile.approved ||
      !profile.legalMerchantReference.trim() ||
      profile.operatingModel !== "direct_retailer" ||
      profile.pricePresentation !== "vat_inclusive" ||
      profile.registrationStatus === "unresolved" ||
      (profile.registrationStatus !== "not_required" &&
        !profile.registrationReference?.trim()) ||
      !profile.sourceReference.trim() ||
      !profile.sourceVersion.trim() ||
      (!testOnly && !profile.approvalReference?.trim())
    ) {
      throw taxProfileUnavailable();
    }
    return profile;
  }

  private async readConfiguration(
    database: DatabaseService["db"] | AuditTransaction,
  ) {
    const [configuration] = await database
      .select()
      .from(taxConfiguration)
      .where(eq(taxConfiguration.id, "default"))
      .limit(1);
    if (!configuration) throw taxConfigurationUnavailable();
    return configuration;
  }

  private async toManagementSettings(
    configuration: typeof taxConfiguration.$inferSelect,
  ): Promise<TaxSettings> {
    let approvedProfileAvailable = false;
    try {
      await this.getCurrentProfile(this.database.db);
      approvedProfileAvailable = true;
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
    }
    return {
      enabled: configuration.enabled,
      approvedProfileAvailable,
      updatedAt: configuration.updatedAt?.toISOString() ?? null,
    };
  }
}

function toTaxProfileSnapshot(profile: ResolvedTaxProfile) {
  return {
    mode: "inclusive" as const,
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

function taxConfigurationUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "The tax setting is unavailable. Contact the site administrator.",
    { errorCode: "TAX_CONFIGURATION_UNAVAILABLE" },
  );
}

function taxProfileUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "An approved AARAJ tax profile is required before tax can be enabled.",
    { errorCode: "TAX_PROFILE_UNAVAILABLE" },
  );
}
