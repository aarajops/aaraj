import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  geographySnapshotChecksum,
  validateGeographySnapshot,
} from "./geography-snapshot.js";

const snapshotUrl = new URL(
  "./data/bangladesh-2026-10-07.json",
  import.meta.url,
);
const snapshotBytes = readFileSync(fileURLToPath(snapshotUrl));
const snapshot = validateGeographySnapshot(
  JSON.parse(snapshotBytes.toString("utf8")),
);

describe("Bangladesh National Portal geography snapshot", () => {
  it("preserves Bangla source names and validates all parent relationships", () => {
    expect(snapshot.datasetVersion).toBe(
      "BANGLADESH_NATIONAL_PORTAL_2026_10_07_V1",
    );
    expect(
      snapshot.locations.some((location) => location.name === "ঢাকা জেলা"),
    ).toBe(true);
    expect(
      snapshot.locations.some(
        (location) => location.name === "কেরাণীগঞ্জ উপজেলা",
      ),
    ).toBe(true);
    expect(
      snapshot.locations.every((location) => !("englishName" in location)),
    ).toBe(true);
  });

  it("rejects orphaned and wrong-level parent relationships", () => {
    const invalid = structuredClone(snapshot);
    const district = invalid.locations.find(
      (location) => location.level === "district",
    );
    if (!district) throw new Error("Snapshot test requires a district.");
    district.parentId = "00000000-0000-4000-8000-000000000000";
    expect(() => validateGeographySnapshot(invalid)).toThrow("invalid parent");
  });

  it("requires distinct source provenance for each hierarchy level", () => {
    const invalid = structuredClone(snapshot);
    invalid.sources[2]!.level = "district";
    expect(() => validateGeographySnapshot(invalid)).toThrow("one source per");
  });

  it("records a reproducible checksum for the checked snapshot", () => {
    expect(geographySnapshotChecksum(snapshotBytes)).toBe(
      "76b6718f6993aa0cc7672b1019fc69f2eda94cde0776eebf97b4409d44211af7",
    );
  });
});
