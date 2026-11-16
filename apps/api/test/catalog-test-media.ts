import { randomUUID } from "node:crypto";

export function readyCatalogImageValues(
  productId: string,
  createdBy: string,
  altText = "Product image used by an integration test.",
) {
  const id = randomUUID();
  return {
    id,
    commandId: randomUUID(),
    productId,
    variantId: null,
    objectKey: `quarantine/${id}/source`,
    contentType: "image/png" as const,
    sizeBytes: 68,
    sourceSha256: "a".repeat(64),
    derivatives: [
      {
        rendition: "card" as const,
        sha256: "b".repeat(64),
        width: 2,
        height: 3,
        sizeBytes: 20,
      },
      {
        rendition: "detail" as const,
        sha256: "c".repeat(64),
        width: 2,
        height: 3,
        sizeBytes: 30,
      },
    ],
    altText,
    reason: null,
    deletionReason: null,
    sortOrder: 0,
    status: "ready" as const,
    createdBy,
  };
}
