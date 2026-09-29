import { Test, TestingModule } from "@nestjs/testing";
import { CONTRACT_VERSION } from "@aaraj/contracts";
import { AppController } from "./app.controller.js";
import { DatabaseService } from "./platform/database/database.service.js";
import { RedisService } from "./platform/redis/redis.service.js";

describe("AppController", () => {
  let appController: AppController;
  let databaseService: { checkConnection: ReturnType<typeof vi.fn> };
  let redisService: { checkConnection: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    databaseService = { checkConnection: vi.fn().mockResolvedValue(undefined) };
    redisService = { checkConnection: vi.fn().mockResolvedValue(undefined) };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: DatabaseService, useValue: databaseService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it("reports the API health and contract version", () => {
    const response = appController.getHealth();

    expect(response).toMatchObject({
      status: "ok",
      service: "@aaraj/api",
      version: CONTRACT_VERSION,
    });
    expect(Number.isNaN(Date.parse(response.timestamp))).toBe(false);
  });

  it("reports ready only after PostgreSQL and Redis are available", async () => {
    await expect(appController.getReadiness()).resolves.toEqual({
      status: "ok",
      database: "ok",
      redis: "ok",
    });
    expect(databaseService.checkConnection).toHaveBeenCalledOnce();
    expect(redisService.checkConnection).toHaveBeenCalledOnce();

    redisService.checkConnection.mockRejectedValueOnce(
      new Error("unavailable"),
    );
    await expect(appController.getReadiness()).rejects.toThrow("unavailable");
  });
});
