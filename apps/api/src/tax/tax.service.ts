import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { DatabaseService } from "../platform/database/database.service.js";
import { bangladeshBusinessDate } from "../delivery/delivery.service.js";
import { taxProfile } from "./tax-schema.js";

export type ResolvedTaxProfile = typeof taxProfile.$inferSelect;

@Injectable()
export class TaxService {
  constructor(private readonly database: DatabaseService) {}

  async getCurrentProfile(): Promise<ResolvedTaxProfile> {
    const testOnly = process.env.NODE_ENV === "test";
    const date = bangladeshBusinessDate();
    const profiles = await this.database.db
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

  async getCurrentVersion(): Promise<string> {
    return (await this.getCurrentProfile()).version;
  }
}

function taxProfileUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "An approved AARAJ tax profile is required before a quote can be issued.",
    { errorCode: "TAX_PROFILE_UNAVAILABLE" },
  );
}
