import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { AuthorizationService } from "@nestjs/authorization";
import type {
  DeliveryTariffManagement,
  DeliveryTariffPlan,
  DeliveryTariffUpdate,
  DeliveryZone,
} from "@aaraj/contracts";
import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { DatabaseService } from "../platform/database/database.service.js";
import { AuditService } from "../platform/audit/audit.service.js";
import type { AuditTransaction } from "../platform/audit/audit.types.js";
import type { AccessPrincipal } from "../platform/authorization/permissions.service.js";
import {
  geographyLocation,
  geographySnapshot,
} from "../geography/geography-schema.js";
import {
  deliveryTariff,
  deliveryTariffDistrict,
  deliveryTariffArea,
} from "./delivery-schema.js";
import { DeliveryPolicy } from "./delivery.policy.js";

export type ResolvedDeliveryTariff = {
  version: string;
  effectiveFrom: string;
  geographyVersion: string;
  districtId: string;
  zone: DeliveryZone | null;
  feeBdt: number;
};

type TariffRow = typeof deliveryTariff.$inferSelect;
type DeliveryDatabase = DatabaseService["db"] | AuditTransaction;

@Injectable()
export class DeliveryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async resolveDeliveryFee(
    geographyVersion: string,
    districtId: string,
    upazilaId?: string,
  ): Promise<ResolvedDeliveryTariff> {
    const businessDate = bangladeshBusinessDate();
    const activeTariffs = await this.database.db
      .select()
      .from(deliveryTariff)
      .where(activeTariffCondition(businessDate))
      .limit(2);
    if (activeTariffs.length !== 1) throw tariffUnavailable();
    const tariff = activeTariffs[0]!;

    if (hasZoneFees(tariff)) {
      if (tariff.geographyVersion !== geographyVersion) {
        throw tariffUnavailable();
      }
      const areaRules = await this.database.db
        .select({
          locationId: deliveryTariffArea.locationId,
          zone: deliveryTariffArea.zone,
          level: geographyLocation.level,
          parentId: geographyLocation.parentId,
        })
        .from(deliveryTariffArea)
        .innerJoin(
          geographyLocation,
          and(
            eq(geographyLocation.snapshotVersion, geographyVersion),
            eq(geographyLocation.id, deliveryTariffArea.locationId),
          ),
        )
        .where(
          and(
            eq(deliveryTariffArea.tariffVersion, tariff.version),
            eq(deliveryTariffArea.geographyVersion, geographyVersion),
          ),
        );

      const districtZone =
        (areaRules.find(
          (rule) => rule.locationId === districtId && rule.level === "district",
        )?.zone as DeliveryZone | undefined) ?? "outside_dhaka";
      const upazilaRules = areaRules.filter(
        (rule) => rule.level === "upazila" && rule.parentId === districtId,
      );

      if (
        !upazilaId &&
        upazilaRules.some((rule) => rule.zone !== districtZone)
      ) {
        throw new UnprocessableEntityException(
          "Choose an upazila to calculate the delivery charge for this district.",
          { errorCode: "DELIVERY_UPAZILA_REQUIRED" },
        );
      }

      const zone =
        (upazilaId
          ? (upazilaRules.find((rule) => rule.locationId === upazilaId)
              ?.zone as DeliveryZone | undefined)
          : undefined) ?? districtZone;
      const feeBdt = feeForZone(tariff, zone);
      return {
        version: tariff.version,
        effectiveFrom: tariff.effectiveFrom,
        geographyVersion,
        districtId,
        zone,
        feeBdt,
      };
    }

    if (
      tariff.insideDhakaFeeBdt !== null ||
      tariff.suburbanFeeBdt !== null ||
      tariff.outsideDhakaFeeBdt !== null
    ) {
      throw tariffUnavailable();
    }
    const [entry] = await this.database.db
      .select({ feeBdt: deliveryTariffDistrict.feeBdt })
      .from(deliveryTariffDistrict)
      .where(
        and(
          eq(deliveryTariffDistrict.tariffVersion, tariff.version),
          eq(deliveryTariffDistrict.geographyVersion, geographyVersion),
          eq(deliveryTariffDistrict.districtId, districtId),
        ),
      )
      .limit(1);
    if (!entry) {
      throw new UnprocessableEntityException(
        "Delivery is not available for this district.",
        { errorCode: "DELIVERY_UNAVAILABLE" },
      );
    }
    return {
      version: tariff.version,
      effectiveFrom: tariff.effectiveFrom,
      geographyVersion,
      districtId,
      zone: null,
      feeBdt: entry.feeBdt,
    };
  }

  async getManagementSettings(
    actor: AccessPrincipal,
  ): Promise<DeliveryTariffManagement> {
    await this.authorization.authorize(DeliveryPolicy, "manage", actor);
    const today = bangladeshBusinessDate();
    const [active, geographyVersion] = await Promise.all([
      this.database.db
        .select()
        .from(deliveryTariff)
        .where(activeTariffCondition(today))
        .limit(2),
      this.getActiveGeographyVersion(this.database.db),
    ]);
    if (active.length !== 1) throw tariffUnavailable();
    const plan = await this.toPlan(this.database.db, active[0]!);
    return {
      current:
        plan.pricingModel === "zones"
          ? {
              pricingModel: "zones",
              fees: plan.fees,
              areaRules: plan.areaRules,
            }
          : { pricingModel: "district", fees: null, areaRules: [] },
      geographyVersion,
    };
  }

  async updateManagementSettings(
    actor: AccessPrincipal,
    input: DeliveryTariffUpdate,
  ): Promise<DeliveryTariffManagement> {
    await this.database.db.transaction(async (transaction) => {
      await this.authorization.authorize(
        DeliveryPolicy,
        "manage",
        actor,
        transaction,
      );
      const today = bangladeshBusinessDate();
      const active = await transaction
        .select()
        .from(deliveryTariff)
        .where(activeTariffCondition(today))
        .for("update")
        .limit(2);
      if (active.length !== 1) throw tariffUnavailable();
      const current = active[0]!;

      const activeGeographyVersion =
        await this.getActiveGeographyVersion(transaction);
      if (input.geographyVersion !== activeGeographyVersion) {
        throw new ConflictException(
          "The Bangladesh geography has changed. Reload the delivery areas and try again.",
          { errorCode: "GEOGRAPHY_VERSION_STALE" },
        );
      }
      await this.validateAreaRules(transaction, input);

      const scheduled = await transaction
        .select()
        .from(deliveryTariff)
        .where(gt(deliveryTariff.effectiveFrom, today))
        .orderBy(asc(deliveryTariff.effectiveFrom))
        .for("update")
        .limit(2);
      if (scheduled.length > 1) throw tariffUnavailable();
      const previousCurrentPlan = await this.toPlan(transaction, current);
      const cancelledScheduledPlan = scheduled[0]
        ? await this.toPlan(transaction, scheduled[0])
        : null;
      if (scheduled[0]) {
        await transaction
          .delete(deliveryTariffArea)
          .where(eq(deliveryTariffArea.tariffVersion, scheduled[0].version));
        await transaction
          .delete(deliveryTariffDistrict)
          .where(
            eq(deliveryTariffDistrict.tariffVersion, scheduled[0].version),
          );
        await transaction
          .delete(deliveryTariff)
          .where(eq(deliveryTariff.version, scheduled[0].version));
      }

      const version =
        current.effectiveFrom === today
          ? current.version
          : await this.nextVersion(transaction, today);
      const values = {
        version,
        effectiveFrom: today,
        geographyVersion: input.geographyVersion,
        effectiveTo: null,
        insideDhakaFeeBdt: input.fees.insideDhakaBdt,
        suburbanFeeBdt: input.fees.suburbanBdt,
        outsideDhakaFeeBdt: input.fees.outsideDhakaBdt,
      };
      if (current.version === version) {
        await transaction
          .update(deliveryTariff)
          .set(values)
          .where(eq(deliveryTariff.version, version));
        await transaction
          .delete(deliveryTariffArea)
          .where(eq(deliveryTariffArea.tariffVersion, version));
        await transaction
          .delete(deliveryTariffDistrict)
          .where(eq(deliveryTariffDistrict.tariffVersion, version));
      } else {
        await transaction.insert(deliveryTariff).values(values);
        await transaction
          .update(deliveryTariff)
          .set({ effectiveTo: today })
          .where(eq(deliveryTariff.version, current.version));
      }

      if (input.areaRules.length > 0) {
        await transaction.insert(deliveryTariffArea).values(
          input.areaRules.map((rule) => ({
            tariffVersion: version,
            geographyVersion: input.geographyVersion,
            locationId: rule.locationId,
            zone: rule.zone,
          })),
        );
      }

      await this.audit.append(transaction, {
        actorType: "user",
        actorId: actor.id,
        eventType: "delivery.tariff.updated",
        subjectType: "delivery_tariff",
        subjectId: version,
        reason: input.reason,
        metadata: {
          previousTariff: previousCurrentPlan,
          cancelledScheduledTariff: cancelledScheduledPlan,
          updatedTariff: {
            version,
            effectiveFrom: today,
            geographyVersion: input.geographyVersion,
            pricingModel: "zones",
            fees: input.fees,
            areaRules: input.areaRules,
          },
        },
      });
    });

    return this.getManagementSettings(actor);
  }

  async getCurrentVersion(): Promise<string> {
    const businessDate = bangladeshBusinessDate();
    const activeTariffs = await this.database.db
      .select({ version: deliveryTariff.version })
      .from(deliveryTariff)
      .where(activeTariffCondition(businessDate))
      .limit(2);
    if (activeTariffs.length !== 1) throw tariffUnavailable();
    return activeTariffs[0]!.version;
  }

  private async getActiveGeographyVersion(
    database: DeliveryDatabase,
  ): Promise<string> {
    const activeSnapshots = await database
      .select({ version: geographySnapshot.version })
      .from(geographySnapshot)
      .where(eq(geographySnapshot.active, true))
      .limit(2);
    if (activeSnapshots.length !== 1) throw tariffUnavailable();
    return activeSnapshots[0]!.version;
  }

  private async validateAreaRules(
    transaction: AuditTransaction,
    input: DeliveryTariffUpdate,
  ): Promise<void> {
    const ids = input.areaRules.map(({ locationId }) => locationId);
    const locations = ids.length
      ? await transaction
          .select({ id: geographyLocation.id, level: geographyLocation.level })
          .from(geographyLocation)
          .where(
            and(
              eq(geographyLocation.snapshotVersion, input.geographyVersion),
              inArray(geographyLocation.id, ids),
            ),
          )
      : [];
    const locationsById = new Map(
      locations.map((location) => [location.id, location]),
    );
    const hasInvalidArea = input.areaRules.some(
      (rule) => locationsById.get(rule.locationId)?.level !== rule.level,
    );
    if (locations.length !== ids.length || hasInvalidArea) {
      throw new BadRequestException(
        "Delivery zones must reference districts or upazilas from the current Bangladesh geography.",
        { errorCode: "DELIVERY_AREA_INVALID" },
      );
    }
  }

  private async nextVersion(
    database: DeliveryDatabase,
    effectiveFrom: string,
  ): Promise<string> {
    const datePart = effectiveFrom.replaceAll("-", "_");
    const prefix = `AARAJ_DELIVERY_${datePart}_V`;
    const matches = await database
      .select({ version: deliveryTariff.version })
      .from(deliveryTariff)
      .where(eq(deliveryTariff.effectiveFrom, effectiveFrom));
    const highestVersion = matches.reduce((highest, { version }) => {
      const parsed = Number(version.slice(prefix.length));
      return Number.isInteger(parsed) ? Math.max(highest, parsed) : highest;
    }, 0);
    return `${prefix}${highestVersion + 1}`;
  }

  private async toPlan(
    database: DeliveryDatabase,
    tariff: TariffRow,
  ): Promise<DeliveryTariffPlan> {
    if (!hasZoneFees(tariff)) {
      if (
        tariff.insideDhakaFeeBdt !== null ||
        tariff.suburbanFeeBdt !== null ||
        tariff.outsideDhakaFeeBdt !== null
      ) {
        throw tariffUnavailable();
      }
      return {
        version: tariff.version,
        effectiveFrom: tariff.effectiveFrom,
        geographyVersion: null,
        pricingModel: "district",
        fees: null,
        areaRules: [],
      };
    }
    if (!tariff.geographyVersion) throw tariffUnavailable();
    const areaRules = await database
      .select({
        locationId: deliveryTariffArea.locationId,
        level: geographyLocation.level,
        zone: deliveryTariffArea.zone,
      })
      .from(deliveryTariffArea)
      .innerJoin(
        geographyLocation,
        and(
          eq(geographyLocation.snapshotVersion, tariff.geographyVersion),
          eq(geographyLocation.id, deliveryTariffArea.locationId),
        ),
      )
      .where(eq(deliveryTariffArea.tariffVersion, tariff.version));
    return {
      version: tariff.version,
      effectiveFrom: tariff.effectiveFrom,
      geographyVersion: tariff.geographyVersion,
      pricingModel: "zones",
      fees: {
        insideDhakaBdt: tariff.insideDhakaFeeBdt!,
        suburbanBdt: tariff.suburbanFeeBdt!,
        outsideDhakaBdt: tariff.outsideDhakaFeeBdt!,
      },
      areaRules: areaRules.map((rule) => ({
        locationId: rule.locationId,
        level: rule.level as "district" | "upazila",
        zone: rule.zone as DeliveryZone,
      })),
    };
  }
}

function activeTariffCondition(businessDate: string) {
  return and(
    lte(deliveryTariff.effectiveFrom, businessDate),
    or(
      isNull(deliveryTariff.effectiveTo),
      gt(deliveryTariff.effectiveTo, businessDate),
    ),
  );
}

function hasZoneFees(tariff: TariffRow): tariff is TariffRow & {
  insideDhakaFeeBdt: number;
  suburbanFeeBdt: number;
  outsideDhakaFeeBdt: number;
} {
  return (
    tariff.insideDhakaFeeBdt !== null &&
    tariff.suburbanFeeBdt !== null &&
    tariff.outsideDhakaFeeBdt !== null
  );
}

function feeForZone(tariff: TariffRow, zone: DeliveryZone): number {
  if (!hasZoneFees(tariff)) throw tariffUnavailable();
  switch (zone) {
    case "inside_dhaka":
      return tariff.insideDhakaFeeBdt;
    case "suburban":
      return tariff.suburbanFeeBdt;
    case "outside_dhaka":
      return tariff.outsideDhakaFeeBdt;
  }
}

export function bangladeshBusinessDate(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function tariffUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "The approved AARAJ delivery tariff is unavailable.",
    { errorCode: "DELIVERY_TARIFF_UNAVAILABLE" },
  );
}
