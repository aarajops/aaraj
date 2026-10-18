import { BadRequestException } from "@nestjs/common";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import {
  MAX_STOREFRONT_ASSET_DERIVATIVE_BYTES,
  MAX_STOREFRONT_ASSET_UPLOAD_BYTES,
  type StorefrontBrandAssetKind,
} from "@aaraj/contracts";
import {
  IMAGE_PROCESSING_TIMEOUT_SECONDS,
  MAX_DECODED_IMAGE_PIXELS,
  WEBP_EFFORT,
} from "../platform/media/image-processing.config.js";

const LOGO_DIMENSIONS = { width: 1200, height: 400 } as const;
const BRAND_ICON_DIMENSIONS = { width: 1024, height: 1024 } as const;
const FAVICON_DIMENSIONS = { width: 64, height: 64 } as const;
const SOCIAL_IMAGE_DIMENSIONS = { width: 1200, height: 630 } as const;
const SUPPORTED_FORMATS = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export interface StorefrontBrandUploadFile {
  buffer: Buffer;
  size: number;
}

export interface ProcessedStorefrontBrandImage {
  body: Buffer;
  contentType: "image/webp" | "image/png" | "image/jpeg";
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

export function processStorefrontBrandIcon(source: Buffer): Promise<Buffer> {
  return sharp(source, {
    failOn: "warning",
    limitInputPixels: MAX_DECODED_IMAGE_PIXELS,
    pages: 1,
  })
    .timeout({ seconds: IMAGE_PROCESSING_TIMEOUT_SECONDS })
    .resize({
      width: 512,
      height: 512,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
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
    file.size > MAX_STOREFRONT_ASSET_UPLOAD_BYTES
  ) {
    throw new BadRequestException(
      `Image files must be no larger than ${MAX_STOREFRONT_ASSET_UPLOAD_BYTES} bytes.`,
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
  if (kind === "brandIcon" && expectedFormat === "jpeg") {
    throw new BadRequestException(
      "Use a PNG or WebP brand icon so transparent padding is preserved.",
    );
  }

  try {
    const source = sharp(file.buffer, {
      failOn: "warning",
      limitInputPixels: MAX_DECODED_IMAGE_PIXELS,
      pages: 1,
    }).timeout({ seconds: IMAGE_PROCESSING_TIMEOUT_SECONDS });
    const metadata = await source.metadata();
    if (
      metadata.format !== expectedFormat ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_DECODED_IMAGE_PIXELS ||
      (metadata.pages ?? 1) > 1
    ) {
      throw new BadRequestException("The uploaded image is not supported.");
    }

    const dimensions =
      kind === "logo"
        ? LOGO_DIMENSIONS
        : kind === "brandIcon"
          ? BRAND_ICON_DIMENSIONS
          : kind === "favicon"
            ? FAVICON_DIMENSIONS
            : SOCIAL_IMAGE_DIMENSIONS;
    const pipeline = sharp(file.buffer, {
      failOn: "warning",
      limitInputPixels: MAX_DECODED_IMAGE_PIXELS,
      pages: 1,
    })
      .timeout({ seconds: IMAGE_PROCESSING_TIMEOUT_SECONDS })
      .rotate()
      .resize({
        width: dimensions.width,
        height: dimensions.height,
        fit:
          kind === "favicon" || kind === "brandIcon"
            ? "contain"
            : kind === "socialImage"
              ? "cover"
              : "inside",
        position: "centre",
        withoutEnlargement: kind === "logo",
        background:
          kind === "socialImage"
            ? { r: 255, g: 255, b: 255, alpha: 1 }
            : { r: 0, g: 0, b: 0, alpha: 0 },
      });

    const output =
      kind === "logo"
        ? await pipeline.webp({ quality: 84, effort: WEBP_EFFORT }).toBuffer({
            resolveWithObject: true,
          })
        : kind === "favicon" || kind === "brandIcon"
          ? await pipeline.png({ compressionLevel: 9 }).toBuffer({
              resolveWithObject: true,
            })
          : await pipeline.jpeg({ quality: 84, mozjpeg: true }).toBuffer({
              resolveWithObject: true,
            });
    if (output.data.byteLength > MAX_STOREFRONT_ASSET_DERIVATIVE_BYTES) {
      throw new BadRequestException("The optimized image is too large.");
    }
    return {
      body: output.data,
      contentType:
        kind === "logo"
          ? "image/webp"
          : kind === "favicon" || kind === "brandIcon"
            ? "image/png"
            : "image/jpeg",
      width: output.info.width,
      height: output.info.height,
    };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException("The uploaded image could not be processed.");
  }
}
