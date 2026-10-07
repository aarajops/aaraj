import { Module } from "@nestjs/common";
import { DatabaseModule } from "../platform/database/database.module.js";
import { TaxService } from "./tax.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [TaxService],
  exports: [TaxService],
})
export class TaxModule {}
