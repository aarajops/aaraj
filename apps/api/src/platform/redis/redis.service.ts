import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { closeRedisClient, getRedisClient } from "./redis-client.js";

@Injectable()
export class RedisService implements OnApplicationShutdown {
  async checkConnection(): Promise<void> {
    await getRedisClient().ping();
  }

  async onApplicationShutdown(): Promise<void> {
    await closeRedisClient();
  }
}
