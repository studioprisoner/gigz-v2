import { z } from 'zod';
import type { Redis } from 'ioredis';
import { getRedisClient } from './client.js';

// Cache configuration schema
export const CacheConfigSchema = z.object({
  namespace: z.string().default('cache'),
  defaultTTL: z.number().min(1).default(3600), // 1 hour
  serializer: z.enum(['json', 'string', 'buffer']).default('json'),
  compression: z.boolean().default(false),
  keyPrefix: z.string().default(''),
});

export type CacheConfig = z.infer<typeof CacheConfigSchema>;

// Cache entry metadata
export interface CacheEntry<T> {
  value: T;
  createdAt: Date;
  expiresAt: Date;
  hits: number;
  size?: number;
}

// Cache statistics
export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
  totalKeys: number;
  memoryUsage: number;
}

// Cache invalidation pattern
export interface InvalidationPattern {
  pattern: string;
  type: 'prefix' | 'suffix' | 'contains' | 'regex';
}

// Redis cache utility class
export class RedisCache {
  private client: Redis;
  private config: CacheConfig;
  private logger?: any;
  private stats: CacheStats;

  constructor(client?: Redis, config?: Partial<CacheConfig>, logger?: any) {
    this.client = client || getRedisClient().getClient();
    this.config = CacheConfigSchema.parse(config || {});
    this.logger = logger;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0,
      totalKeys: 0,
      memoryUsage: 0,
    };
  }

  // Generate cache key with namespace and prefix
  private generateKey(key: string): string {
    const parts = [this.config.namespace];

    if (this.config.keyPrefix) {
      parts.push(this.config.keyPrefix);
    }

    parts.push(key);
    return parts.join(':');
  }

  // Serialize value for storage
  private serialize(value: any): string {
    switch (this.config.serializer) {
      case 'json':
        return JSON.stringify(value);
      case 'string':
        return String(value);
      case 'buffer':
        return Buffer.from(value).toString('base64');
      default:
        return JSON.stringify(value);
    }
  }

  // Deserialize value from storage
  private deserialize<T>(value: string): T {
    try {
      switch (this.config.serializer) {
        case 'json':
          return JSON.parse(value);
        case 'string':
          return value as T;
        case 'buffer':
          return Buffer.from(value, 'base64') as T;
        default:
          return JSON.parse(value);
      }
    } catch (error) {
      this.logger?.error('Failed to deserialize cache value', {
        error: error instanceof Error ? error.message : 'Unknown error',
        value: value.substring(0, 100) + '...',
      });
      throw new Error('Cache deserialization failed');
    }
  }

  // Set cache value with TTL
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const cacheKey = this.generateKey(key);
    const serializedValue = this.serialize(value);
    const cacheTTL = ttl || this.config.defaultTTL;

    try {
      await this.client.setex(cacheKey, cacheTTL, serializedValue);

      this.stats.sets++;
      this.updateHitRate();

      this.logger?.debug('Cache value set', {
        key: cacheKey,
        ttl: cacheTTL,
        size: serializedValue.length,
      });

    } catch (error) {
      this.logger?.error('Failed to set cache value', {
        key: cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Get cache value
  async get<T>(key: string): Promise<T | null> {
    const cacheKey = this.generateKey(key);

    try {
      const value = await this.client.get(cacheKey);

      if (value === null) {
        this.stats.misses++;
        this.updateHitRate();
        return null;
      }

      this.stats.hits++;
      this.updateHitRate();

      this.logger?.debug('Cache value retrieved', { key: cacheKey });

      return this.deserialize<T>(value);

    } catch (error) {
      this.logger?.error('Failed to get cache value', {
        key: cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }
  }

  // Get cache value with metadata
  async getWithMetadata<T>(key: string): Promise<CacheEntry<T> | null> {
    const cacheKey = this.generateKey(key);

    try {
      const [value, ttl] = await this.client.multi()
        .get(cacheKey)
        .ttl(cacheKey)
        .exec();

      if (!value || value[1] === null) {
        this.stats.misses++;
        this.updateHitRate();
        return null;
      }

      this.stats.hits++;
      this.updateHitRate();

      const deserializedValue = this.deserialize<T>(value[1] as string);
      const remainingTTL = ttl[1] as number;
      const now = new Date();

      return {
        value: deserializedValue,
        createdAt: new Date(now.getTime() - ((this.config.defaultTTL - remainingTTL) * 1000)),
        expiresAt: new Date(now.getTime() + (remainingTTL * 1000)),
        hits: 1, // Would need separate tracking for actual hit count
        size: (value[1] as string).length,
      };

    } catch (error) {
      this.logger?.error('Failed to get cache value with metadata', {
        key: cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }
  }

  // Get or set cache value (cache-aside pattern)
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);

    if (cached !== null) {
      return cached;
    }

    this.logger?.debug('Cache miss, fetching value', { key });

    try {
      const value = await fetcher();
      await this.set(key, value, ttl);
      return value;
    } catch (error) {
      this.logger?.error('Failed to fetch value for cache', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Delete cache value
  async delete(key: string): Promise<boolean> {
    const cacheKey = this.generateKey(key);

    try {
      const result = await this.client.del(cacheKey);

      if (result > 0) {
        this.stats.deletes++;
        this.logger?.debug('Cache value deleted', { key: cacheKey });
        return true;
      }

      return false;

    } catch (error) {
      this.logger?.error('Failed to delete cache value', {
        key: cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // Check if key exists in cache
  async exists(key: string): Promise<boolean> {
    const cacheKey = this.generateKey(key);

    try {
      const result = await this.client.exists(cacheKey);
      return result === 1;
    } catch (error) {
      this.logger?.error('Failed to check cache key existence', {
        key: cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // Get remaining TTL for a key
  async getTTL(key: string): Promise<number> {
    const cacheKey = this.generateKey(key);

    try {
      return await this.client.ttl(cacheKey);
    } catch (error) {
      this.logger?.error('Failed to get cache TTL', {
        key: cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return -1;
    }
  }

  // Extend TTL for a key
  async extend(key: string, ttl: number): Promise<boolean> {
    const cacheKey = this.generateKey(key);

    try {
      const result = await this.client.expire(cacheKey, ttl);
      return result === 1;
    } catch (error) {
      this.logger?.error('Failed to extend cache TTL', {
        key: cacheKey,
        ttl,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // Set multiple values at once
  async setMany<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    const pipeline = this.client.pipeline();

    for (const entry of entries) {
      const cacheKey = this.generateKey(entry.key);
      const serializedValue = this.serialize(entry.value);
      const ttl = entry.ttl || this.config.defaultTTL;

      pipeline.setex(cacheKey, ttl, serializedValue);
    }

    try {
      await pipeline.exec();
      this.stats.sets += entries.length;
      this.updateHitRate();

      this.logger?.debug('Multiple cache values set', { count: entries.length });

    } catch (error) {
      this.logger?.error('Failed to set multiple cache values', {
        count: entries.length,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Get multiple values at once
  async getMany<T>(keys: string[]): Promise<(T | null)[]> {
    const cacheKeys = keys.map(key => this.generateKey(key));

    try {
      const values = await this.client.mget(...cacheKeys);

      const results = values.map((value, index) => {
        if (value === null) {
          this.stats.misses++;
          return null;
        }

        this.stats.hits++;

        try {
          return this.deserialize<T>(value);
        } catch (error) {
          this.logger?.error('Failed to deserialize cache value', {
            key: cacheKeys[index],
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          this.stats.misses++;
          return null;
        }
      });

      this.updateHitRate();
      return results;

    } catch (error) {
      this.logger?.error('Failed to get multiple cache values', {
        keys: cacheKeys,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Return array of nulls on error
      this.stats.misses += keys.length;
      this.updateHitRate();
      return new Array(keys.length).fill(null);
    }
  }

  // Delete multiple keys
  async deleteMany(keys: string[]): Promise<number> {
    const cacheKeys = keys.map(key => this.generateKey(key));

    try {
      const result = await this.client.del(...cacheKeys);
      this.stats.deletes += result;

      this.logger?.debug('Multiple cache values deleted', {
        requested: keys.length,
        deleted: result,
      });

      return result;

    } catch (error) {
      this.logger?.error('Failed to delete multiple cache values', {
        keys: cacheKeys,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  // Invalidate cache by pattern
  async invalidate(pattern: InvalidationPattern): Promise<number> {
    try {
      let searchPattern: string;

      switch (pattern.type) {
        case 'prefix':
          searchPattern = `${this.generateKey(pattern.pattern)}*`;
          break;
        case 'suffix':
          searchPattern = `${this.generateKey('')}*${pattern.pattern}`;
          break;
        case 'contains':
          searchPattern = `${this.generateKey('')}*${pattern.pattern}*`;
          break;
        case 'regex':
          searchPattern = this.generateKey(pattern.pattern);
          break;
        default:
          searchPattern = this.generateKey(pattern.pattern);
      }

      const keys = await this.client.keys(searchPattern);

      if (keys.length === 0) {
        return 0;
      }

      const deleted = await this.client.del(...keys);
      this.stats.deletes += deleted;

      this.logger?.info('Cache invalidated by pattern', {
        pattern: pattern.pattern,
        type: pattern.type,
        keysFound: keys.length,
        deleted,
      });

      return deleted;

    } catch (error) {
      this.logger?.error('Failed to invalidate cache by pattern', {
        pattern,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  // Clear all cache in namespace
  async clear(): Promise<number> {
    try {
      const pattern = `${this.config.namespace}:*`;
      const keys = await this.client.keys(pattern);

      if (keys.length === 0) {
        return 0;
      }

      const deleted = await this.client.del(...keys);
      this.stats.deletes += deleted;

      this.logger?.warn('Cache cleared', {
        namespace: this.config.namespace,
        deleted,
      });

      return deleted;

    } catch (error) {
      this.logger?.error('Failed to clear cache', {
        namespace: this.config.namespace,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  // Get cache statistics
  getStats(): CacheStats {
    return { ...this.stats };
  }

  // Reset cache statistics
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0,
      totalKeys: 0,
      memoryUsage: 0,
    };
  }

  // Update hit rate calculation
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  // Get cache configuration
  getConfig(): CacheConfig {
    return { ...this.config };
  }

  // Update cache configuration
  updateConfig(newConfig: Partial<CacheConfig>): void {
    this.config = {
      ...this.config,
      ...CacheConfigSchema.parse({ ...this.config, ...newConfig }),
    };

    this.logger?.info('Cache configuration updated', {
      updatedKeys: Object.keys(newConfig),
    });
  }
}

// Default cache instance
let defaultCache: RedisCache | null = null;

// Initialize default cache
export function initializeCache(
  client?: Redis,
  config?: Partial<CacheConfig>,
  logger?: any
): RedisCache {
  if (defaultCache) {
    throw new Error('Cache already initialized. Use getCache() to access it.');
  }

  defaultCache = new RedisCache(client, config, logger);
  return defaultCache;
}

// Get default cache instance
export function getCache(): RedisCache {
  if (!defaultCache) {
    // Auto-initialize with default settings if not already done
    defaultCache = new RedisCache();
  }
  return defaultCache;
}

// Create a new cache instance
export function createCache(
  client?: Redis,
  config?: Partial<CacheConfig>,
  logger?: any
): RedisCache {
  return new RedisCache(client, config, logger);
}

// Utility functions for common cache operations

// Simple cache-aside function
export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl?: number
): Promise<T> {
  return getCache().getOrSet(key, fetcher, ttl);
}

// Cached function decorator
export function cached<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  keyGenerator: (...args: Parameters<T>) => string,
  ttl?: number
): T {
  return (async (...args: Parameters<T>) => {
    const key = keyGenerator(...args);
    const cache = getCache();

    const cached = await cache.get(key);
    if (cached !== null) {
      return cached;
    }

    const result = await fn(...args);
    await cache.set(key, result, ttl);
    return result;
  }) as T;
}

// Export cache class and utilities
export default RedisCache;