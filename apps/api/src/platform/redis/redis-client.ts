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

export async function waitForRedisReady(
  client: Redis,
  timeoutMs = 5_000,
): Promise<void> {
  if (client.status === "ready") return;

  await new Promise<void>((resolve, reject) => {
    let lastError: Error | undefined;
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        lastError ??
          new Error(`Redis did not become ready within ${timeoutMs}ms.`),
      );
    }, timeoutMs);
    const ready = () => {
      cleanup();
      resolve();
    };
    const error = (cause: Error) => {
      lastError = cause;
    };
    const end = () => {
      cleanup();
      reject(lastError ?? new Error("Redis connection ended before ready."));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      client.off("ready", ready);
      client.off("error", error);
      client.off("end", end);
    };

    client.once("ready", ready);
    client.on("error", error);
    client.once("end", end);
    if (client.status === "ready") ready();
    else if (client.status === "end") end();
  });
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
