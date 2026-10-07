import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  BANGLADESH_GEOGRAPHY_SCHEMA_VERSION,
  BangladeshGeographySchema,
  type QuoteDestinationRef,
} from "@aaraj/contracts";
import { DatabaseService } from "../platform/database/database.service.js";
import { geographyLocation, geographySnapshot } from "./geography-schema.js";

@Injectable()
export class GeographyService {
  constructor(private readonly database: DatabaseService) {}

  async listBangladesh(): Promise<
    ReturnType<typeof BangladeshGeographySchema.parse>
  > {
    const snapshots = await this.database.db
      .select()
      .from(geographySnapshot)
      .where(eq(geographySnapshot.active, true))
      .limit(2);
    if (snapshots.length !== 1) throw geographyUnavailable();
    const snapshot = snapshots[0]!;

    const rows = await this.database.db
      .select({
        id: geographyLocation.id,
        level: geographyLocation.level,
        parentId: geographyLocation.parentId,
        name: geographyLocation.name,
      })
      .from(geographyLocation)
      .where(eq(geographyLocation.snapshotVersion, snapshot.version))
      .orderBy(asc(geographyLocation.level), asc(geographyLocation.name));

    return BangladeshGeographySchema.parse({
      schemaVersion: BANGLADESH_GEOGRAPHY_SCHEMA_VERSION,
      datasetVersion: snapshot.version,
      authority: snapshot.authority,
      snapshotDate: snapshot.snapshotDate,
      locations: rows,
    });
  }

  async resolveDestination(input: QuoteDestinationRef) {
    const snapshots = await this.database.db
      .select({ version: geographySnapshot.version })
      .from(geographySnapshot)
      .where(eq(geographySnapshot.active, true))
      .limit(2);
    if (snapshots.length !== 1) throw geographyUnavailable();
    if (snapshots[0]!.version !== input.geographyVersion) {
      throw new BadRequestException(
        "The selected Bangladesh geography is out of date. Reload locations and choose again.",
        { errorCode: "GEOGRAPHY_VERSION_STALE" },
      );
    }

    const ids = [input.divisionId, input.districtId];
    if (input.upazilaId) ids.push(input.upazilaId);
    const rows = await this.database.db
      .select({
        id: geographyLocation.id,
        level: geographyLocation.level,
        parentId: geographyLocation.parentId,
        name: geographyLocation.name,
      })
      .from(geographyLocation)
      .where(
        and(
          eq(geographyLocation.snapshotVersion, input.geographyVersion),
          inArray(geographyLocation.id, ids),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const division = byId.get(input.divisionId);
    const district = byId.get(input.districtId);
    const upazila = input.upazilaId ? byId.get(input.upazilaId) : undefined;
    if (
      division?.level !== "division" ||
      district?.level !== "district" ||
      district.parentId !== division.id ||
      (input.upazilaId &&
        (upazila?.level !== "upazila" || upazila.parentId !== district.id))
    ) {
      throw new BadRequestException(
        "Choose a valid division, district, and optional upazila combination.",
        { errorCode: "GEOGRAPHY_DESTINATION_INVALID" },
      );
    }
    return { division, district, upazila: upazila ?? null };
  }

  async getActiveVersion(): Promise<string> {
    const snapshots = await this.database.db
      .select({ version: geographySnapshot.version })
      .from(geographySnapshot)
      .where(eq(geographySnapshot.active, true))
      .limit(2);
    if (snapshots.length !== 1) throw geographyUnavailable();
    return snapshots[0]!.version;
  }
}

function geographyUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    "Bangladesh delivery geography is not configured.",
    { errorCode: "GEOGRAPHY_UNAVAILABLE" },
  );
}
