import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { CONTRACT_VERSION, type HealthCheckResponse } from "@aaraj/contracts";
import { DatabaseService } from "./platform/database/database.service.js";
import { RedisService } from "./platform/redis/redis.service.js";

@Controller()
@AllowAnonymous()
@SkipThrottle()
export class AppController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
  ) {}

  @Get("health")
  getHealth(): HealthCheckResponse {
    return {
      status: "ok",
      service: "@aaraj/api",
      timestamp: new Date().toISOString(),
      version: CONTRACT_VERSION,
    };
  }

  @Get("health/ready")
  async getReadiness(): Promise<{
    status: "ok";
    database: "ok";
    redis: "ok";
  }> {
    await Promise.all([
      this.databaseService.checkConnection(),
      this.redisService.checkConnection(),
    ]);
    return { status: "ok", database: "ok", redis: "ok" };
  }
}
