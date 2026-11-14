import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import {
  closeRedisClient,
  getRedisClient,
  waitForRedisReady,
} from "./redis-client.js";

@Injectable()
export class RedisService implements OnApplicationShutdown {
  async checkConnection(): Promise<void> {
    const client = getRedisClient();
    await waitForRedisReady(client);
    await client.ping();
  }

  async onApplicationShutdown(): Promise<void> {
    await closeRedisClient();
  }
}
