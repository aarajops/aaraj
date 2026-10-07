import { Module } from "@nestjs/common";
import { DatabaseModule } from "../platform/database/database.module.js";
import { GeographyController } from "./geography.controller.js";
import { GeographyService } from "./geography.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [GeographyController],
  providers: [GeographyService],
  exports: [GeographyService],
})
export class GeographyModule {}
