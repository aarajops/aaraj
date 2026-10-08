import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  generateGeographyLocationId,
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
const reconciledSnapshotUrl = new URL(
  "./data/bangladesh-2026-10-08.json",
  import.meta.url,
);
const reconciledSnapshotBytes = readFileSync(
  fileURLToPath(reconciledSnapshotUrl),
);
const reconciledSnapshot = validateGeographySnapshot(
  JSON.parse(reconciledSnapshotBytes.toString("utf8")),
);

describe("Bangladesh geography snapshots", () => {
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
    expect(() => validateGeographySnapshot(invalid)).toThrow(
      "source for every location level",
    );
  });

  it("records a reproducible checksum for the checked snapshot", () => {
    expect(geographySnapshotChecksum(snapshotBytes)).toBe(
      "76b6718f6993aa0cc7672b1019fc69f2eda94cde0776eebf97b4409d44211af7",
    );
  });

  it("preserves V1 and validates the versioned 2026 geography reconciliation", () => {
    expect(snapshot.locations).toHaveLength(571);
    expect(reconciledSnapshot.datasetVersion).toBe(
      "BANGLADESH_GOVERNMENT_2026_10_08_V2",
    );
    expect(reconciledSnapshot.authority).toBe(
      "Bangladesh National Portal and Bangladesh Government Press (Cabinet Division)",
    );
    expect(reconciledSnapshot.locations).toHaveLength(572);
    expect(geographySnapshotChecksum(reconciledSnapshotBytes)).toBe(
      "f0d76cfba2e270e376896b9c9885b984f308b823bdaf7a5febf1127a712a6baf",
    );

    const counts = reconciledSnapshot.locations.reduce(
      (total, { level }) => {
        total[level] += 1;
        return total;
      },
      { division: 0, district: 0, upazila: 0 },
    );
    expect(counts).toEqual({ division: 8, district: 64, upazila: 500 });

    const byId = new Map(
      reconciledSnapshot.locations.map((location) => [location.id, location]),
    );
    expect(byId.size).toBe(reconciledSnapshot.locations.length);
    for (const location of reconciledSnapshot.locations) {
      if (location.level === "division") {
        expect(location.parentId).toBeNull();
      } else {
        expect(byId.has(location.parentId!)).toBe(true);
      }
    }
    for (const [name, districtName] of [
      ["মাতামুহুরী উপজেলা", "কক্সবাজার জেলা"],
      ["মোকামতলা উপজেলা", "বগুড়া জেলা"],
      ["চন্দ্রগঞ্জ উপজেলা", "লক্ষ্মীপুর জেলা"],
      ["রুহিয়া উপজেলা", "ঠাকুরগাঁও জেলা"],
      ["ভূল্লী উপজেলা", "ঠাকুরগাঁও জেলা"],
    ]) {
      const upazila = reconciledSnapshot.locations.find(
        (location) => location.name === name,
      );
      expect(upazila?.level).toBe("upazila");
      expect(byId.get(upazila!.parentId!)?.name).toBe(districtName);
    }
    expect(
      reconciledSnapshot.locations.find(
        (location) => location.name === "মাতামুহুরী উপজেলা",
      )?.sourceUrl,
    ).toBe("https://www.dpp.gov.bd/upload_file/gazettes/61700_42685.pdf");
    const matamuhuri = reconciledSnapshot.locations.find(
      (location) => location.name === "মাতামুহুরী উপজেলা",
    );
    expect(matamuhuri?.id).toBe(
      generateGeographyLocationId({
        level: "upazila",
        parentId: matamuhuri!.parentId!,
        sourceUrl: matamuhuri!.sourceUrl,
        name: matamuhuri!.name,
      }),
    );
    for (const url of [
      "https://www.dpp.gov.bd/upload_file/gazettes/61698_65239.pdf",
      "https://www.dpp.gov.bd/upload_file/gazettes/61699_58391.pdf",
      "https://www.dpp.gov.bd/upload_file/gazettes/61700_42685.pdf",
      "https://www.dpp.gov.bd/upload_file/gazettes/61701_57582.pdf",
      "https://www.dpp.gov.bd/upload_file/gazettes/61702_83377.pdf",
    ]) {
      expect(
        reconciledSnapshot.sources.some(
          (source) =>
            source.url === url &&
            source.authority?.includes("Cabinet Division") &&
            source.publishedDate === "2026-05-19",
        ),
      ).toBe(true);
    }
  });
});
