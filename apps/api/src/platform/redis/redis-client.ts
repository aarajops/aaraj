import { Redis } from "ioredis";

let redisClient: Redis | undefined;

export function getRedisClient(): Redis {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL must be configured before connecting to Redis.");
  }

  redisClient = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  return redisClient;
}

export async function closeRedisClient(): Promise<void> {
  if (!redisClient) return;

  if (redisClient.status === "ready") {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
  } else {
    redisClient.disconnect();
  }

  redisClient = undefined;
}
