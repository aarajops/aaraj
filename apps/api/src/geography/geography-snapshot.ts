import { createHash } from "node:crypto";
import { z } from "zod";

const LocationSchema = z.strictObject({
  id: z.uuid(),
  level: z.enum(["division", "district", "upazila"]),
  parentId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  sourceUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "gov.bd" || url.hostname.endsWith(".gov.bd"))
    );
  }),
});

const SourceSchema = z.strictObject({
  level: z.enum(["division", "district", "upazila"]),
  url: z.url(),
  retrievedDate: z.iso.date(),
});

export const GeographySnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  datasetVersion: z.string().min(1).max(80),
  authority: z.literal("Bangladesh National Portal"),
  snapshotDate: z.iso.date(),
  sources: z.array(SourceSchema).min(3).max(3),
  idGeneration: z.string().min(1).max(300),
  locations: z.array(LocationSchema).min(1),
});
export type GeographySnapshot = z.infer<typeof GeographySnapshotSchema>;

export function validateGeographySnapshot(value: unknown): GeographySnapshot {
  const snapshot = GeographySnapshotSchema.parse(value);
  const sourceLevels = new Set(snapshot.sources.map((source) => source.level));
  if (sourceLevels.size !== 3) {
    throw new Error(
      "Geography snapshot must cite one source per location level.",
    );
  }
  if (
    snapshot.sources.some(
      (source) => source.retrievedDate !== snapshot.snapshotDate,
    )
  ) {
    throw new Error(
      "Geography snapshot sources must use the same retrieval date.",
    );
  }

  const locations = new Map(
    snapshot.locations.map((location) => [location.id, location]),
  );
  if (locations.size !== snapshot.locations.length) {
    throw new Error("Geography snapshot contains duplicate internal IDs.");
  }
  const sourceKeys = new Set<string>();
  const namesByLevelAndParent = new Set<string>();
  for (const location of snapshot.locations) {
    const sourceKey = `${location.level}:${location.sourceUrl}`;
    if (sourceKeys.has(sourceKey)) {
      throw new Error("Geography snapshot contains duplicate source records.");
    }
    sourceKeys.add(sourceKey);

    const siblingKey = `${location.level}:${location.parentId ?? "root"}:${location.name.toLocaleLowerCase("bn-BD")}`;
    if (namesByLevelAndParent.has(siblingKey)) {
      throw new Error("Geography snapshot contains duplicate sibling names.");
    }
    namesByLevelAndParent.add(siblingKey);

    if (location.level === "division") {
      if (location.parentId !== null) {
        throw new Error("Division locations must not have a parent.");
      }
      continue;
    }
    if (!location.parentId) {
      throw new Error("District and upazila locations must have a parent.");
    }
    const parent = locations.get(location.parentId);
    const expectedParentLevel =
      location.level === "district" ? "division" : "district";
    if (!parent || parent.level !== expectedParentLevel) {
      throw new Error(`${location.level} location has an invalid parent.`);
    }
  }
  return snapshot;
}

export function geographySnapshotChecksum(snapshotBytes: Uint8Array): string {
  return createHash("sha256").update(snapshotBytes).digest("hex");
}
