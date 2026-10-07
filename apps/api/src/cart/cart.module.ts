import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module.js";
import { DatabaseModule } from "../platform/database/database.module.js";
import { RedisModule } from "../platform/redis/redis.module.js";
import { CartController } from "./cart.controller.js";
import { CartService } from "./cart.service.js";

@Module({
  imports: [CatalogModule, DatabaseModule, RedisModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
