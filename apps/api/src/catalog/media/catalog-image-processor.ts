import sharp from "sharp";
import {
  CATALOG_MEDIA_RENDITIONS,
  MAX_CATALOG_MEDIA_DERIVATIVE_BYTES,
  CatalogMediaDerivativeSchema,
  type CatalogMediaContentType,
  type CatalogMediaDerivative,
  type CatalogMediaRendition,
} from "@aaraj/contracts";
import { createHash } from "node:crypto";

const MAX_DECODED_PIXELS = 24_000_000;
const PROCESS_TIMEOUT_SECONDS = 15;
const WEBP_QUALITY = 82;
const WEBP_EFFORT = 4;

// Keep each native libvips operation bounded on the API process.
sharp.concurrency(1);

export class InvalidCatalogImageError extends Error {
  constructor() {
    super("The uploaded file is not a supported, decodable product image.");
    this.name = "InvalidCatalogImageError";
  }
}

export interface ProcessedCatalogImage {
  derivatives: Array<{
    metadata: CatalogMediaDerivative;
    body: Buffer;
  }>;
}

let processingQueue: Promise<void> = Promise.resolve();

export async function processCatalogImage(
  source: Buffer,
  expectedContentType: CatalogMediaContentType,
): Promise<ProcessedCatalogImage> {
  const result = processingQueue.then(() =>
    processCatalogImageWithinLimits(source, expectedContentType),
  );
  processingQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function processCatalogImageWithinLimits(
  source: Buffer,
  expectedContentType: CatalogMediaContentType,
): Promise<ProcessedCatalogImage> {
  try {
    const metadata = await sharp(source, {
      failOn: "warning",
      limitInputPixels: MAX_DECODED_PIXELS,
      pages: 1,
    })
      .timeout({ seconds: PROCESS_TIMEOUT_SECONDS })
      .metadata();
    const expectedFormat = contentTypeToFormat(expectedContentType);
    if (
      metadata.format !== expectedFormat ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_DECODED_PIXELS ||
      (metadata.pages ?? 1) > 1
    ) {
      throw new InvalidCatalogImageError();
    }

    const derivatives: ProcessedCatalogImage["derivatives"] = [];
    for (const rendition of ["card", "detail"] as const) {
      const output = await createRendition(source, rendition);
      const sha256 = createHash("sha256").update(output.data).digest("hex");
      const derivative = CatalogMediaDerivativeSchema.parse({
        rendition,
        sha256,
        width: output.info.width,
        height: output.info.height,
        sizeBytes: output.data.byteLength,
      });
      if (output.data.byteLength > MAX_CATALOG_MEDIA_DERIVATIVE_BYTES) {
        throw new InvalidCatalogImageError();
      }
      derivatives.push({ metadata: derivative, body: output.data });
    }
    return { derivatives };
  } catch (error) {
    if (error instanceof InvalidCatalogImageError) throw error;
    throw new InvalidCatalogImageError();
  }
}

async function createRendition(
  source: Buffer,
  rendition: CatalogMediaRendition,
) {
  const dimensions = CATALOG_MEDIA_RENDITIONS[rendition];
  return sharp(source, {
    failOn: "warning",
    limitInputPixels: MAX_DECODED_PIXELS,
    pages: 1,
  })
    .timeout({ seconds: PROCESS_TIMEOUT_SECONDS })
    .rotate()
    .resize({
      width: dimensions.width,
      height: dimensions.height,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT })
    .toBuffer({ resolveWithObject: true });
}

function contentTypeToFormat(contentType: CatalogMediaContentType): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpeg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
}
