import type { ThrottlerStorage } from "@nestjs/throttler";
import type { Redis } from "ioredis";

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage["increment"]>
>;

const incrementScript = `
  local hitsKey = KEYS[1]
  local blockedKey = KEYS[2]
  local ttl = tonumber(ARGV[1])
  local limit = tonumber(ARGV[2])
  local blockDuration = tonumber(ARGV[3])

  local isBlocked = redis.call('GET', blockedKey)
  if isBlocked then
    local timeToBlockExpire = redis.call('PTTL', blockedKey)
    if timeToBlockExpire > 0 then
      local totalHits = tonumber(redis.call('GET', hitsKey)) or 0
      local timeToExpire = redis.call('PTTL', hitsKey)
      return { totalHits, math.max(timeToExpire, 0), 1, timeToBlockExpire }
    end
    redis.call('DEL', blockedKey)
    redis.call('DEL', hitsKey)
  end

  local totalHits = redis.call('INCR', hitsKey)
  local timeToExpire = redis.call('PTTL', hitsKey)
  if timeToExpire <= 0 then
    redis.call('PEXPIRE', hitsKey, ttl)
    timeToExpire = ttl
  end

  local isNowBlocked = totalHits > limit
  local timeToBlockExpire = 0
  if isNowBlocked and blockDuration > 0 then
    redis.call('SET', blockedKey, 1, 'PX', blockDuration)
    redis.call('PEXPIRE', hitsKey, blockDuration)
    timeToBlockExpire = blockDuration
  elseif isNowBlocked then
    timeToBlockExpire = timeToExpire
  end

  return { totalHits, timeToExpire, isNowBlocked and 1 or 0, timeToBlockExpire }
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const tag = `{${key}:${throttlerName}}`;
    const result: unknown = await this.redis.eval(
      incrementScript,
      2,
      `${tag}:hits`,
      `${tag}:blocked`,
      ttl,
      limit,
      blockDuration,
    );
    if (!Array.isArray(result) || result.length !== 4) {
      throw new Error("Redis returned an invalid throttler result.");
    }

    const values = result.map(Number);
    const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] = values as [
      number,
      number,
      number,
      number,
    ];
    if (
      !Number.isFinite(totalHits) ||
      !Number.isFinite(timeToExpire) ||
      !Number.isFinite(isBlocked) ||
      !Number.isFinite(timeToBlockExpire)
    ) {
      throw new Error("Redis returned an invalid throttler result.");
    }

    return {
      totalHits,
      timeToExpire: Math.ceil(timeToExpire / 1000),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: Math.ceil(timeToBlockExpire / 1000),
    };
  }
}
