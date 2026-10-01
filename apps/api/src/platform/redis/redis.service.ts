import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { closeRedisClient, getRedisClient } from "./redis-client.js";

@Injectable()
export class RedisService implements OnApplicationShutdown {
  async checkConnection(): Promise<void> {
    const client = getRedisClient();
    if (client.status !== "ready") {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("Redis did not become ready within 5 seconds."));
        }, 5_000);
        const ready = () => {
          cleanup();
          resolve();
        };
        const error = (cause: Error) => {
          cleanup();
          reject(cause);
        };
        const cleanup = () => {
          clearTimeout(timeout);
          client.off("ready", ready);
          client.off("error", error);
        };
        client.once("ready", ready);
        client.once("error", error);
        if (client.status === "ready") ready();
      });
    }
    await client.ping();
  }

  async onApplicationShutdown(): Promise<void> {
    await closeRedisClient();
  }
}
