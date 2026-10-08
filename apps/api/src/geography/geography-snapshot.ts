import { createHash } from "node:crypto";
import { z } from "zod";

const LocationSchema = z.strictObject({
  id: z.uuid(),
  level: z.enum(["division", "district", "upazila"]),
  parentId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  sourceUrl: z.url().refine((value) => {
    return isGovernmentUrl(value);
  }),
});

const SourceSchema = z.strictObject({
  level: z.enum(["division", "district", "upazila"]),
  url: z.url().refine(isGovernmentUrl),
  retrievedDate: z.iso.date(),
  authority: z.string().trim().min(1).max(160).optional(),
  reference: z.string().trim().min(1).max(240).optional(),
  publishedDate: z.iso.date().optional(),
});

export const GeographySnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  datasetVersion: z.string().min(1).max(80),
  authority: z.string().trim().min(1).max(200),
  snapshotDate: z.iso.date(),
  sources: z.array(SourceSchema).min(3).max(12),
  idGeneration: z.string().min(1).max(300),
  locations: z.array(LocationSchema).min(1),
});
export type GeographySnapshot = z.infer<typeof GeographySnapshotSchema>;

export function validateGeographySnapshot(value: unknown): GeographySnapshot {
  const snapshot = GeographySnapshotSchema.parse(value);
  const sourceLevels = new Set(snapshot.sources.map((source) => source.level));
  if (
    !["division", "district", "upazila"].every((level) =>
      sourceLevels.has(level as GeographySnapshot["sources"][number]["level"]),
    )
  ) {
    throw new Error(
      "Geography snapshot must cite a source for every location level.",
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
  const duplicateSources = new Set(
    snapshot.sources.map((source) => `${source.level}:${source.url}`),
  );
  if (duplicateSources.size !== snapshot.sources.length) {
    throw new Error("Geography snapshot contains duplicate source references.");
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

function isGovernmentUrl(value: string): boolean {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    (url.hostname === "gov.bd" || url.hostname.endsWith(".gov.bd"))
  );
}

export function geographySnapshotChecksum(snapshotBytes: Uint8Array): string {
  return createHash("sha256").update(snapshotBytes).digest("hex");
}

export function generateGeographyLocationId(input: {
  level: GeographySnapshot["locations"][number]["level"];
  parentId: string;
  sourceUrl: string;
  name: string;
}): string {
  const digest = createHash("sha256")
    .update(
      `aaraj-geography\0${input.level}\0${input.parentId}\0${input.sourceUrl}\0${input.name}`,
      "utf8",
    )
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hexadecimal = digest.subarray(0, 16).toString("hex");
  return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(12, 16)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20)}`;
}
