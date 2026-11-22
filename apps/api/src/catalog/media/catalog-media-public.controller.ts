import {
  Controller,
  Get,
  Param,
  Res,
  StandardSchemaValidationPipe,
  UsePipes,
} from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import {
  CatalogMediaRenditionSchema,
  CatalogMediaSha256Schema,
  CatalogProductIdSchema,
} from "@aaraj/contracts";
import type { Response } from "express";
import { CatalogMediaService } from "./catalog-media.service.js";

@Controller("catalog/media")
@UsePipes(StandardSchemaValidationPipe)
export class CatalogMediaPublicController {
  constructor(private readonly catalogMedia: CatalogMediaService) {}

  @Get(":mediaId/:rendition/:sha256.webp")
  @AllowAnonymous()
  async getPublishedImage(
    @Param("mediaId", { schema: CatalogProductIdSchema }) mediaId: string,
    @Param("rendition", { schema: CatalogMediaRenditionSchema })
    rendition: "card" | "detail",
    @Param("sha256", { schema: CatalogMediaSha256Schema }) sha256: string,
    @Res() response: Response,
  ): Promise<void> {
    let image: { body: Buffer; sizeBytes: number };
    try {
      image = await this.catalogMedia.getPublishedDerivative(
        mediaId,
        rendition,
        sha256,
      );
    } catch (error: unknown) {
      response.setHeader("Cache-Control", "private, no-store");
      throw error;
    }

    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.status(200);
    response.setHeader("Content-Type", "image/webp");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Length", String(image.sizeBytes));
    response.setHeader(
      "Content-Disposition",
      `inline; filename="${mediaId}.webp"`,
    );
    response.end(image.body);
  }
}
