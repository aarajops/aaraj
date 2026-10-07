import { Controller, Get, Header } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { GeographyService } from "./geography.service.js";

@Controller("geography")
export class GeographyController {
  constructor(private readonly geography: GeographyService) {}

  @Get()
  @AllowAnonymous()
  @Header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
  getBangladeshGeography() {
    return this.geography.listBangladesh();
  }
}
