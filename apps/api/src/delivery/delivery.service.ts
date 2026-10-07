import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { DatabaseService } from "../platform/database/database.service.js";
import { deliveryTariff, deliveryTariffDistrict } from "./delivery-schema.js";

export const AARAJ_DELIVERY_TARIFF_VERSION =
  "AARAJ_DELIVERY_2026_10_07_V1" as const;

export type ResolvedDeliveryTariff = {
  version: string;
  effectiveFrom: string;
  geographyVersion: string;
  districtId: string;
  feeBdt: number;
};

@Injectable()
export class DeliveryService {
  constructor(private readonly database: DatabaseService) {}

  async resolveDistrictFee(
    geographyVersion: string,
    districtId: string,
  ): Promise<ResolvedDeliveryTariff> {
    const businessDate = bangladeshBusinessDate();
    const activeTariffs = await this.database.db
      .select({
        version: deliveryTariff.version,
        effectiveFrom: deliveryTariff.effectiveFrom,
      })
      .from(deliveryTariff)
      .where(
        and(
          lte(deliveryTariff.effectiveFrom, businessDate),
          or(
            isNull(deliveryTariff.effectiveTo),
            gt(deliveryTariff.effectiveTo, businessDate),
          ),
        ),
      )
      .limit(2);
    if (activeTariffs.length !== 1) throw tariffUnavailable();
    const tariff = activeTariffs[0]!;

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
      feeBdt: entry.feeBdt,
    };
  }

  async getCurrentVersion(): Promise<string> {
    const businessDate = bangladeshBusinessDate();
    const activeTariffs = await this.database.db
      .select({ version: deliveryTariff.version })
      .from(deliveryTariff)
      .where(
        and(
          lte(deliveryTariff.effectiveFrom, businessDate),
          or(
            isNull(deliveryTariff.effectiveTo),
            gt(deliveryTariff.effectiveTo, businessDate),
          ),
        ),
      )
      .limit(2);
    if (activeTariffs.length !== 1) throw tariffUnavailable();
    return activeTariffs[0]!.version;
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
