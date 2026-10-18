import { BadRequestException } from "@nestjs/common";
import {
  MAX_STOREFRONT_ASSET_DERIVATIVE_BYTES,
  MAX_STOREFRONT_BANNER_HEIGHT,
  MAX_STOREFRONT_ASSET_UPLOAD_BYTES,
  MAX_STOREFRONT_BANNER_WIDTH,
} from "@aaraj/contracts";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import {
  DEFAULT_WEBP_QUALITY,
  IMAGE_PROCESSING_TIMEOUT_SECONDS,
  MAX_DECODED_IMAGE_PIXELS,
  WEBP_EFFORT,
} from "../platform/media/image-processing.config.js";

export interface StorefrontBannerUploadFile {
  buffer: Buffer;
  size: number;
}

export interface ProcessedStorefrontBannerImage {
  body: Buffer;
  width: number;
  height: number;
}

let processingQueue: Promise<void> = Promise.resolve();

export function processStorefrontBannerImage(
  file: StorefrontBannerUploadFile | undefined,
): Promise<ProcessedStorefrontBannerImage> {
  const result = processingQueue.then(() => processWithinLimits(file));
  processingQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function processWithinLimits(
  file: StorefrontBannerUploadFile | undefined,
): Promise<ProcessedStorefrontBannerImage> {
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
  if (
    detected?.mime !== "image/jpeg" &&
    detected?.mime !== "image/png" &&
    detected?.mime !== "image/webp"
  ) {
    throw new BadRequestException("Use a JPEG, PNG, or WebP image file.");
  }

  try {
    const source = sharp(file.buffer, {
      failOn: "warning",
      limitInputPixels: MAX_DECODED_IMAGE_PIXELS,
      pages: 1,
    }).timeout({ seconds: IMAGE_PROCESSING_TIMEOUT_SECONDS });
    const metadata = await source.metadata();
    if (
      metadata.format !==
      (detected.mime === "image/jpeg"
        ? "jpeg"
        : detected.mime === "image/png"
          ? "png"
          : "webp")
    ) {
      throw new BadRequestException("The uploaded image is not supported.");
    }
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_DECODED_IMAGE_PIXELS ||
      (metadata.pages ?? 1) > 1
    ) {
      throw new BadRequestException(
        "The uploaded image dimensions are invalid.",
      );
    }

    const output = await sharp(file.buffer, {
      failOn: "warning",
      limitInputPixels: MAX_DECODED_IMAGE_PIXELS,
      pages: 1,
    })
      .timeout({ seconds: IMAGE_PROCESSING_TIMEOUT_SECONDS })
      .rotate()
      .resize({
        width: MAX_STOREFRONT_BANNER_WIDTH,
        height: MAX_STOREFRONT_BANNER_HEIGHT,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: DEFAULT_WEBP_QUALITY, effort: WEBP_EFFORT })
      .toBuffer({ resolveWithObject: true });

    if (output.data.byteLength > MAX_STOREFRONT_ASSET_DERIVATIVE_BYTES) {
      throw new BadRequestException("The optimized image is too large.");
    }
    return {
      body: output.data,
      width: output.info.width,
      height: output.info.height,
    };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException("The uploaded image could not be processed.");
  }
}
