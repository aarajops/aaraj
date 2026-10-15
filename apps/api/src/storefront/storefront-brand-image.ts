import { BadRequestException } from "@nestjs/common";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import type { StorefrontBrandAssetKind } from "@aaraj/contracts";

export const MAX_STOREFRONT_BRAND_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_STOREFRONT_BRAND_DERIVATIVE_BYTES = 3 * 1024 * 1024;

const MAX_DECODED_PIXELS = 24_000_000;
const PROCESS_TIMEOUT_SECONDS = 15;
const LOGO_DIMENSIONS = { width: 1200, height: 400 } as const;
const FAVICON_DIMENSIONS = { width: 64, height: 64 } as const;
const SUPPORTED_FORMATS = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

sharp.concurrency(1);

export interface StorefrontBrandUploadFile {
  buffer: Buffer;
  size: number;
}

export interface ProcessedStorefrontBrandImage {
  body: Buffer;
  contentType: "image/webp" | "image/png";
  width: number;
  height: number;
}

let processingQueue: Promise<void> = Promise.resolve();

export function processStorefrontBrandImage(
  file: StorefrontBrandUploadFile | undefined,
  kind: StorefrontBrandAssetKind,
): Promise<ProcessedStorefrontBrandImage> {
  const result = processingQueue.then(() =>
    processStorefrontBrandImageWithinLimits(file, kind),
  );
  processingQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function processStorefrontBrandImageWithinLimits(
  file: StorefrontBrandUploadFile | undefined,
  kind: StorefrontBrandAssetKind,
): Promise<ProcessedStorefrontBrandImage> {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new BadRequestException("Choose one image file to upload.");
  }
  if (
    !Number.isSafeInteger(file.size) ||
    file.size !== file.buffer.byteLength ||
    file.size < 1 ||
    file.size > MAX_STOREFRONT_BRAND_ASSET_BYTES
  ) {
    throw new BadRequestException(
      `Image files must be no larger than ${MAX_STOREFRONT_BRAND_ASSET_BYTES} bytes.`,
    );
  }

  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    detected = await fileTypeFromBuffer(file.buffer);
  } catch {
    throw new BadRequestException("The uploaded image could not be inspected.");
  }
  const expectedFormat = detected?.mime
    ? SUPPORTED_FORMATS.get(detected.mime)
    : undefined;
  if (!expectedFormat) {
    throw new BadRequestException("Use a JPEG, PNG, or WebP image file.");
  }

  try {
    const source = sharp(file.buffer, {
      failOn: "warning",
      limitInputPixels: MAX_DECODED_PIXELS,
      pages: 1,
    }).timeout({ seconds: PROCESS_TIMEOUT_SECONDS });
    const metadata = await source.metadata();
    if (
      metadata.format !== expectedFormat ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_DECODED_PIXELS ||
      (metadata.pages ?? 1) > 1
    ) {
      throw new BadRequestException("The uploaded image is not supported.");
    }

    const dimensions = kind === "logo" ? LOGO_DIMENSIONS : FAVICON_DIMENSIONS;
    const pipeline = sharp(file.buffer, {
      failOn: "warning",
      limitInputPixels: MAX_DECODED_PIXELS,
      pages: 1,
    })
      .timeout({ seconds: PROCESS_TIMEOUT_SECONDS })
      .rotate()
      .resize({
        width: dimensions.width,
        height: dimensions.height,
        fit: kind === "favicon" ? "contain" : "inside",
        position: "centre",
        withoutEnlargement: kind === "logo",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });

    const output =
      kind === "logo"
        ? await pipeline.webp({ quality: 84, effort: 4 }).toBuffer({
            resolveWithObject: true,
          })
        : await pipeline.png({ compressionLevel: 9 }).toBuffer({
            resolveWithObject: true,
          });
    if (output.data.byteLength > MAX_STOREFRONT_BRAND_DERIVATIVE_BYTES) {
      throw new BadRequestException("The optimized image is too large.");
    }
    return {
      body: output.data,
      contentType: kind === "logo" ? "image/webp" : "image/png",
      width: output.info.width,
      height: output.info.height,
    };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException("The uploaded image could not be processed.");
  }
}
