// Redis Package - Comprehensive Redis utilities for Gigz v2
// Provides caching, queuing, rate limiting, pub/sub, and health monitoring

// === Client Management ===
export {
  RedisConnectionManager,
  RedisConfigSchema,
  type RedisConfig,
  type ConnectionStatus,
} from './client.js';

// === Caching ===
// Note: Caching functionality not implemented yet
// export { } from './cache.js';

// === Rate Limiting ===
// Note: Rate limiting functionality not implemented yet
// export { } from './rate-limit.js';

// === Queue Management ===
export {
  RedisQueueFactory,
  initializeQueueFactory,
  getQueueFactory,
  createQueueFactory,
  QueueConfigSchema,
  WorkerConfigSchema,
  type QueueConfig,
  type WorkerConfig,
  type JobProcessor,
  type JobData,
  type JobResult,
  type ScheduleJobOptions,
  type QueueStats,
  type QueueInfo,
} from './queue.js';

// === Pub/Sub ===
// Note: Pub/Sub functionality not implemented yet
// export { } from './pubsub.js';

// === Settings Management ===
export {
  ScraperSettingsManager,
  scraperSettings,
  type ScraperServiceConfig,
  type ScraperSettings,
} from './settings.js';

// === Health Monitoring ===
// Note: Health monitoring not implemented yet
// export { } from './health.js';

// === Utility Types ===

// Common Redis operation result
export interface RedisOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  duration?: number;
}

// Redis connection pool configuration
export interface RedisPoolConfig {
  min: number;
  max: number;
  acquireTimeoutMillis: number;
  createTimeoutMillis: number;
  destroyTimeoutMillis: number;
  idleTimeoutMillis: number;
  reapIntervalMillis: number;
  createRetryIntervalMillis: number;
  propagateCreateError: boolean;
}

// Redis cluster configuration
export interface RedisClusterConfig {
  nodes: Array<{ host: string; port: number }>;
  options?: {
    enableOfflineQueue?: boolean;
    redisOptions?: Record<string, any>;
    maxRetriesPerRequest?: number;
    retryDelayOnFailover?: number;
    clusterRetryDelay?: number;
    scaleReads?: 'master' | 'slave' | 'all';
  };
}

// Redis sentinel configuration
export interface RedisSentinelConfig {
  sentinels: Array<{ host: string; port: number }>;
  name: string;
  role?: 'master' | 'slave';
  sentinelRetryStrategy?: (times: number) => number;
  sentinelReconnectStrategy?: (times: number) => number;
}

// Redis monitoring metrics aggregation
export interface RedisMetricsAggregation {
  timestamp: Date;
  period: 'minute' | 'hour' | 'day';
  metrics: {
    avgLatency: number;
    maxLatency: number;
    totalOperations: number;
    errorRate: number;
    memoryUsage: number;
    hitRate: number;
    connectionsCount: number;
  };
}

// Redis backup configuration
export interface RedisBackupConfig {
  enabled: boolean;
  schedule?: string; // cron expression
  retention?: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  compression?: boolean;
  encryption?: {
    enabled: boolean;
    key?: string;
  };
}

// === Utility Functions ===

// Create Redis key with namespace
export function createRedisKey(namespace: string, ...parts: (string | number)[]): string {
  return [namespace, ...parts.map(String)].join(':');
}

// Parse Redis key
export function parseRedisKey(key: string): { namespace: string; parts: string[] } {
  const parts = key.split(':');
  const namespace = parts[0];
  return { namespace, parts: parts.slice(1) };
}

// Convert expiry to TTL
export function expiryToTTL(expiry: Date | number | string): number {
  const now = Date.now();

  if (typeof expiry === 'number') {
    return Math.max(0, Math.floor((expiry - now) / 1000));
  }

  if (typeof expiry === 'string') {
    const expiryTime = new Date(expiry).getTime();
    return Math.max(0, Math.floor((expiryTime - now) / 1000));
  }

  if (expiry instanceof Date) {
    return Math.max(0, Math.floor((expiry.getTime() - now) / 1000));
  }

  return 0;
}

// Format bytes
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Generate correlation ID
export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Validate Redis key
export function isValidRedisKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  if (key.length === 0 || key.length > 512 * 1024 * 1024) return false; // Redis max key size
  return true;
}

// === Constants ===

// Default TTL values (in seconds)
export const DEFAULT_TTL = {
  SHORT: 300,      // 5 minutes
  MEDIUM: 3600,    // 1 hour
  LONG: 86400,     // 24 hours
  EXTENDED: 604800, // 7 days
} as const;

// Rate limit presets
export const RATE_LIMIT_PRESETS = {
  STRICT: { limit: 10, window: 60 },
  NORMAL: { limit: 100, window: 60 },
  RELAXED: { limit: 1000, window: 60 },
  BURST: { limit: 50, window: 10 },
} as const;

// Queue priority levels
export const QUEUE_PRIORITIES = {
  CRITICAL: 1,
  HIGH: 2,
  NORMAL: 3,
  LOW: 4,
  BACKGROUND: 5,
} as const;

// Health check thresholds
export const HEALTH_THRESHOLDS = {
  MEMORY_USAGE: 90,     // percentage
  LATENCY: 1000,        // milliseconds
  ERROR_RATE: 5,        // percentage
  CONNECTION_COUNT: 100, // number of connections
} as const;

// === Version Information ===
export const REDIS_PACKAGE_VERSION = '1.0.0';
export const SUPPORTED_REDIS_VERSION = '6.0.0';

// Default export for convenient access
// Note: Simplified to avoid import issues during development
export default {};
