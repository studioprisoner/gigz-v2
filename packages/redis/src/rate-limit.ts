import { z } from 'zod';
import type { Redis } from 'ioredis';
import { getRedisClient } from './client.js';

// Rate limit configuration schema
export const RateLimitConfigSchema = z.object({
  keyPrefix: z.string().default('rate_limit'),
  window: z.number().min(1).default(60), // seconds
  limit: z.number().min(1).default(10),
  blockDuration: z.number().min(0).default(0), // 0 = no blocking
  skipSuccessfulRequests: z.boolean().default(false),
  skipFailedRequests: z.boolean().default(false),
});

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

// Rate limit result
export interface RateLimitResult {
  allowed: boolean;
  count: number;
  remaining: number;
  resetTime: Date;
  retryAfter?: number; // seconds until allowed again
}

// Rate limit violation record
export interface RateLimitViolation {
  key: string;
  count: number;
  limit: number;
  window: number;
  timestamp: Date;
}

// Rate limit algorithm types
export type RateLimitAlgorithm = 'fixed-window' | 'sliding-window' | 'token-bucket';

// Rate limiting utility class
export class RedisRateLimiter {
  private client: Redis;
  private logger?: any;

  constructor(client?: Redis, logger?: any) {
    this.client = client || getRedisClient().getClient();
    this.logger = logger;
  }

  // Fixed window rate limiting (simple counter)
  async checkFixedWindow(
    key: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const windowKey = `${config.keyPrefix}:fixed:${key}`;
    const now = Date.now();
    const windowStart = Math.floor(now / (config.window * 1000)) * config.window;

    try {
      const pipeline = this.client.pipeline();

      // Get current count and increment
      pipeline.incr(windowKey);
      pipeline.ttl(windowKey);

      const results = await pipeline.exec();
      const count = results?.[0]?.[1] as number || 0;
      const ttl = results?.[1]?.[1] as number || 0;

      // Set expiration if this is the first request in the window
      if (count === 1) {
        await this.client.expire(windowKey, config.window);
      }

      const resetTime = new Date((windowStart + config.window) * 1000);
      const remaining = Math.max(0, config.limit - count);
      const allowed = count <= config.limit;

      if (!allowed && config.blockDuration > 0) {
        // Set block key if configured
        await this.setBlock(key, config.blockDuration);
      }

      this.logger?.debug('Fixed window rate limit check', {
        key,
        count,
        limit: config.limit,
        allowed,
        resetTime,
      });

      return {
        allowed,
        count,
        remaining,
        resetTime,
        retryAfter: !allowed && ttl > 0 ? ttl : undefined,
      };

    } catch (error) {
      this.logger?.error('Fixed window rate limit check failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Allow on error to prevent blocking legitimate requests
      return {
        allowed: true,
        count: 0,
        remaining: config.limit,
        resetTime: new Date(Date.now() + config.window * 1000),
      };
    }
  }

  // Sliding window rate limiting (more accurate)
  async checkSlidingWindow(
    key: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const windowKey = `${config.keyPrefix}:sliding:${key}`;
    const now = Date.now();
    const windowStart = now - (config.window * 1000);

    try {
      const pipeline = this.client.pipeline();

      // Remove old entries
      pipeline.zremrangebyscore(windowKey, 0, windowStart);

      // Count current entries
      pipeline.zcard(windowKey);

      // Add current request
      pipeline.zadd(windowKey, now, `${now}-${Math.random()}`);

      // Set expiration
      pipeline.expire(windowKey, config.window);

      const results = await pipeline.exec();
      const count = (results?.[1]?.[1] as number || 0) + 1; // +1 for current request

      const remaining = Math.max(0, config.limit - count);
      const allowed = count <= config.limit;
      const resetTime = new Date(now + config.window * 1000);

      if (!allowed) {
        // Remove the request we just added since it's not allowed
        await this.client.zrem(windowKey, `${now}-${Math.random()}`);

        if (config.blockDuration > 0) {
          await this.setBlock(key, config.blockDuration);
        }
      }

      this.logger?.debug('Sliding window rate limit check', {
        key,
        count,
        limit: config.limit,
        allowed,
        resetTime,
      });

      return {
        allowed,
        count,
        remaining,
        resetTime,
        retryAfter: !allowed ? config.window : undefined,
      };

    } catch (error) {
      this.logger?.error('Sliding window rate limit check failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        allowed: true,
        count: 0,
        remaining: config.limit,
        resetTime: new Date(now + config.window * 1000),
      };
    }
  }

  // Token bucket rate limiting (smooth rate limiting)
  async checkTokenBucket(
    key: string,
    config: RateLimitConfig,
    tokensRequested: number = 1
  ): Promise<RateLimitResult> {
    const bucketKey = `${config.keyPrefix}:bucket:${key}`;
    const now = Date.now();

    try {
      // Lua script for atomic token bucket operations
      const luaScript = `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local capacity = tonumber(ARGV[2])
        local refill_rate = tonumber(ARGV[3])
        local window = tonumber(ARGV[4])
        local tokens_requested = tonumber(ARGV[5])

        local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
        local tokens = tonumber(bucket[1]) or capacity
        local last_refill = tonumber(bucket[2]) or now

        -- Calculate tokens to add based on time elapsed
        local time_passed = math.max(0, now - last_refill)
        local tokens_to_add = math.floor(time_passed * refill_rate / 1000)
        tokens = math.min(capacity, tokens + tokens_to_add)

        -- Check if we can consume the requested tokens
        local allowed = tokens >= tokens_requested
        if allowed then
          tokens = tokens - tokens_requested
        end

        -- Update bucket state
        redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
        redis.call('EXPIRE', key, window)

        return {allowed and 1 or 0, tokens, capacity}
      `;

      const refillRate = config.limit / config.window; // tokens per second
      const result = await this.client.eval(
        luaScript,
        1,
        bucketKey,
        now,
        config.limit,
        refillRate,
        config.window,
        tokensRequested
      ) as [number, number, number];

      const allowed = result[0] === 1;
      const tokens = result[1];
      const capacity = result[2];

      const resetTime = new Date(now + config.window * 1000);
      const remaining = Math.floor(tokens);

      if (!allowed && config.blockDuration > 0) {
        await this.setBlock(key, config.blockDuration);
      }

      this.logger?.debug('Token bucket rate limit check', {
        key,
        tokensRequested,
        tokens,
        capacity,
        allowed,
      });

      return {
        allowed,
        count: capacity - remaining,
        remaining,
        resetTime,
        retryAfter: !allowed ? Math.ceil(tokensRequested / (config.limit / config.window)) : undefined,
      };

    } catch (error) {
      this.logger?.error('Token bucket rate limit check failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        allowed: true,
        count: 0,
        remaining: config.limit,
        resetTime: new Date(now + config.window * 1000),
      };
    }
  }

  // Check if key is blocked
  async isBlocked(key: string, keyPrefix: string = 'rate_limit'): Promise<boolean> {
    const blockKey = `${keyPrefix}:block:${key}`;

    try {
      const result = await this.client.exists(blockKey);
      return result === 1;
    } catch (error) {
      this.logger?.error('Block check failed', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // Set block for key
  private async setBlock(key: string, duration: number): Promise<void> {
    const blockKey = `rate_limit:block:${key}`;

    try {
      await this.client.setex(blockKey, duration, '1');
      this.logger?.debug('Rate limit block set', { key, duration });
    } catch (error) {
      this.logger?.error('Failed to set rate limit block', {
        key,
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Get rate limit status without incrementing
  async getStatus(
    key: string,
    config: RateLimitConfig,
    algorithm: RateLimitAlgorithm = 'sliding-window'
  ): Promise<Omit<RateLimitResult, 'allowed'>> {
    const windowKey = `${config.keyPrefix}:${algorithm === 'sliding-window' ? 'sliding' : 'fixed'}:${key}`;

    try {
      if (algorithm === 'sliding-window') {
        const now = Date.now();
        const windowStart = now - (config.window * 1000);

        await this.client.zremrangebyscore(windowKey, 0, windowStart);
        const count = await this.client.zcard(windowKey);

        return {
          count,
          remaining: Math.max(0, config.limit - count),
          resetTime: new Date(now + config.window * 1000),
        };
      } else {
        const count = await this.client.get(windowKey);
        const currentCount = count ? parseInt(count, 10) : 0;

        return {
          count: currentCount,
          remaining: Math.max(0, config.limit - currentCount),
          resetTime: new Date(Date.now() + config.window * 1000),
        };
      }
    } catch (error) {
      this.logger?.error('Failed to get rate limit status', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        count: 0,
        remaining: config.limit,
        resetTime: new Date(Date.now() + config.window * 1000),
      };
    }
  }

  // Reset rate limit for key
  async reset(key: string, keyPrefix: string = 'rate_limit'): Promise<void> {
    const patterns = [
      `${keyPrefix}:fixed:${key}`,
      `${keyPrefix}:sliding:${key}`,
      `${keyPrefix}:bucket:${key}`,
      `${keyPrefix}:block:${key}`,
    ];

    try {
      await this.client.del(...patterns);
      this.logger?.debug('Rate limit reset', { key });
    } catch (error) {
      this.logger?.error('Failed to reset rate limit', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Get rate limit violations (for monitoring)
  async getViolations(keyPrefix: string = 'rate_limit', limit: number = 100): Promise<RateLimitViolation[]> {
    const violationKey = `${keyPrefix}:violations`;

    try {
      const violations = await this.client.lrange(violationKey, 0, limit - 1);

      return violations.map(violation => {
        try {
          return JSON.parse(violation);
        } catch {
          return null;
        }
      }).filter(Boolean);

    } catch (error) {
      this.logger?.error('Failed to get rate limit violations', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  // Record rate limit violation (for monitoring)
  async recordViolation(violation: RateLimitViolation, keyPrefix: string = 'rate_limit'): Promise<void> {
    const violationKey = `${keyPrefix}:violations`;

    try {
      await this.client.lpush(violationKey, JSON.stringify(violation));
      await this.client.ltrim(violationKey, 0, 999); // Keep last 1000 violations
      await this.client.expire(violationKey, 24 * 60 * 60); // Expire after 24 hours

      this.logger?.debug('Rate limit violation recorded', violation);

    } catch (error) {
      this.logger?.error('Failed to record rate limit violation', {
        violation,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Cleanup expired rate limit data
  async cleanup(olderThanSeconds: number = 3600): Promise<number> {
    const cutoffTime = Date.now() - (olderThanSeconds * 1000);
    let cleanedCount = 0;

    try {
      // Get all sliding window keys
      const slidingKeys = await this.client.keys('rate_limit:sliding:*');

      for (const key of slidingKeys) {
        const removed = await this.client.zremrangebyscore(key, 0, cutoffTime);
        cleanedCount += removed;
      }

      this.logger?.info('Rate limit cleanup completed', {
        cleanedCount,
        olderThanSeconds,
      });

      return cleanedCount;

    } catch (error) {
      this.logger?.error('Rate limit cleanup failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }
}

// Default rate limiter instance
let defaultRateLimiter: RedisRateLimiter | null = null;

// Initialize default rate limiter
export function initializeRateLimiter(client?: Redis, logger?: any): RedisRateLimiter {
  if (defaultRateLimiter) {
    throw new Error('Rate limiter already initialized. Use getRateLimiter() to access it.');
  }

  defaultRateLimiter = new RedisRateLimiter(client, logger);
  return defaultRateLimiter;
}

// Get default rate limiter instance
export function getRateLimiter(): RedisRateLimiter {
  if (!defaultRateLimiter) {
    // Auto-initialize with default settings if not already done
    defaultRateLimiter = new RedisRateLimiter();
  }
  return defaultRateLimiter;
}

// Create a new rate limiter instance
export function createRateLimiter(client?: Redis, logger?: any): RedisRateLimiter {
  return new RedisRateLimiter(client, logger);
}

// Utility functions for common rate limiting operations

// Simple fixed window rate limit check
export async function checkRateLimit(
  key: string,
  limit: number,
  window: number = 60
): Promise<RateLimitResult> {
  const config = RateLimitConfigSchema.parse({ limit, window });
  return getRateLimiter().checkFixedWindow(key, config);
}

// Sliding window rate limit check
export async function checkSlidingRateLimit(
  key: string,
  limit: number,
  window: number = 60
): Promise<RateLimitResult> {
  const config = RateLimitConfigSchema.parse({ limit, window });
  return getRateLimiter().checkSlidingWindow(key, config);
}

// Token bucket rate limit check
export async function checkTokenBucket(
  key: string,
  limit: number,
  window: number = 60,
  tokensRequested: number = 1
): Promise<RateLimitResult> {
  const config = RateLimitConfigSchema.parse({ limit, window });
  return getRateLimiter().checkTokenBucket(key, config, tokensRequested);
}

// Rate limiter middleware factory
export function createRateLimitMiddleware(
  keyGenerator: (...args: any[]) => string,
  config: RateLimitConfig,
  algorithm: RateLimitAlgorithm = 'sliding-window'
) {
  return async (...args: any[]) => {
    const key = keyGenerator(...args);
    const rateLimiter = getRateLimiter();

    // Check if blocked first
    if (await rateLimiter.isBlocked(key, config.keyPrefix)) {
      throw new Error('Rate limit exceeded - currently blocked');
    }

    let result: RateLimitResult;

    switch (algorithm) {
      case 'fixed-window':
        result = await rateLimiter.checkFixedWindow(key, config);
        break;
      case 'sliding-window':
        result = await rateLimiter.checkSlidingWindow(key, config);
        break;
      case 'token-bucket':
        result = await rateLimiter.checkTokenBucket(key, config);
        break;
      default:
        result = await rateLimiter.checkSlidingWindow(key, config);
    }

    if (!result.allowed) {
      // Record violation for monitoring
      await rateLimiter.recordViolation({
        key,
        count: result.count,
        limit: config.limit,
        window: config.window,
        timestamp: new Date(),
      });

      throw new Error(`Rate limit exceeded. Try again in ${result.retryAfter || config.window} seconds.`);
    }

    return result;
  };
}

// Export rate limiter class and utilities
export default RedisRateLimiter;