import { BadRequestException } from "@nestjs/common";
import {
  CatalogMediaContentTypeSchema,
  MAX_CATALOG_MEDIA_UPLOAD_BYTES,
} from "@aaraj/contracts";
import { fileTypeFromBuffer } from "file-type";

export interface CatalogMediaUploadFile {
  buffer: Buffer;
  size: number;
}

export async function validateCatalogImageUpload(
  file: CatalogMediaUploadFile | undefined,
): Promise<{
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}> {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new BadRequestException("Choose one image file to upload.");
  }
  if (
    !Number.isSafeInteger(file.size) ||
    file.size !== file.buffer.byteLength ||
    file.size < 1 ||
    file.size > MAX_CATALOG_MEDIA_UPLOAD_BYTES
  ) {
    throw new BadRequestException(
      `Image files must be no larger than ${MAX_CATALOG_MEDIA_UPLOAD_BYTES} bytes.`,
    );
  }

  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    detected = await fileTypeFromBuffer(file.buffer);
  } catch {
    throw new BadRequestException("The uploaded image could not be inspected.");
  }
  const parsedContentType = CatalogMediaContentTypeSchema.safeParse(
    detected?.mime,
  );
  if (!parsedContentType.success) {
    throw new BadRequestException("Use a JPEG, PNG, or WebP image file.");
  }
  return { buffer: file.buffer, contentType: parsedContentType.data };
}
