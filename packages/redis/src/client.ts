import Redis, { RedisOptions } from 'ioredis';
import { z } from 'zod';

// Redis configuration schema
export const RedisConfigSchema = z.object({
  url: z.string().url().optional(),
  host: z.string().default('localhost'),
  port: z.number().min(1).max(65535).default(6379),
  password: z.string().optional(),
  db: z.number().min(0).max(15).default(0),
  maxRetriesPerRequest: z.number().min(0).default(3),
  retryDelayOnFailover: z.number().min(0).default(100),
  connectTimeout: z.number().min(1000).default(10000),
  commandTimeout: z.number().min(1000).default(5000),
  lazyConnect: z.boolean().default(true),
  maxMemoryPolicy: z.enum(['noeviction', 'allkeys-lru', 'volatile-lru', 'allkeys-random', 'volatile-random', 'volatile-ttl']).optional(),
  keyPrefix: z.string().optional(),
  enableReadyCheck: z.boolean().default(true),
  keepAlive: z.boolean().default(true),
});

export type RedisConfig = z.infer<typeof RedisConfigSchema>;

// Connection status
export interface ConnectionStatus {
  connected: boolean;
  ready: boolean;
  host: string;
  port: number;
  db: number;
  uptime: number;
  lastError?: string;
  connectionCount: number;
}

// Redis connection manager
export class RedisConnectionManager {
  private client: Redis;
  private config: RedisConfig;
  private logger?: any;
  private connectionStartTime: number;
  private connectionCount = 0;
  private lastError?: string;

  constructor(config: Partial<RedisConfig>, logger?: any) {
    this.config = RedisConfigSchema.parse(config);
    this.logger = logger;
    this.connectionStartTime = Date.now();

    const redisOptions: RedisOptions = {
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db,
      maxRetriesPerRequest: this.config.maxRetriesPerRequest,
      retryDelayOnFailover: this.config.retryDelayOnFailover,
      connectTimeout: this.config.connectTimeout,
      commandTimeout: this.config.commandTimeout,
      lazyConnect: this.config.lazyConnect,
      keyPrefix: this.config.keyPrefix,
      enableReadyCheck: this.config.enableReadyCheck,
      keepAlive: this.config.keepAlive,
    };

    // If URL is provided, parse it and override individual options
    if (this.config.url) {
      this.client = new Redis(this.config.url, redisOptions);
    } else {
      this.client = new Redis(redisOptions);
    }

    this.setupEventHandlers();
  }

  // Setup Redis event handlers
  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      this.connectionCount++;
      this.logger?.info('Redis client connected', {
        host: this.config.host,
        port: this.config.port,
        db: this.config.db,
        connectionCount: this.connectionCount,
      });
    });

    this.client.on('ready', () => {
      this.logger?.info('Redis client ready for commands');
    });

    this.client.on('error', (error) => {
      this.lastError = error.message;
      this.logger?.error('Redis client error', {
        error: error.message,
        stack: error.stack,
      });
    });

    this.client.on('close', () => {
      this.logger?.warn('Redis client connection closed');
    });

    this.client.on('reconnecting', (delay) => {
      this.logger?.info('Redis client reconnecting', { delay });
    });

    this.client.on('end', () => {
      this.logger?.warn('Redis client connection ended');
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => this.disconnect());
    process.on('SIGINT', () => this.disconnect());
  }

  // Connect to Redis
  async connect(): Promise<void> {
    try {
      if (this.config.lazyConnect) {
        await this.client.connect();
      }
      this.logger?.info('Redis connection established successfully');
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      this.logger?.error('Failed to connect to Redis', { error: this.lastError });
      throw error;
    }
  }

  // Disconnect from Redis
  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
      this.logger?.info('Redis client disconnected gracefully');
    } catch (error) {
      this.logger?.error('Error during Redis disconnection', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Force disconnect if graceful quit fails
      this.client.disconnect();
    }
  }

  // Get the Redis client instance
  getClient(): Redis {
    return this.client;
  }

  // Health check
  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      return false;
    }
  }

  // Get connection status
  getStatus(): ConnectionStatus {
    return {
      connected: this.client.status === 'ready' || this.client.status === 'connecting',
      ready: this.client.status === 'ready',
      host: this.config.host,
      port: this.config.port,
      db: this.config.db,
      uptime: Date.now() - this.connectionStartTime,
      lastError: this.lastError,
      connectionCount: this.connectionCount,
    };
  }

  // Get server info
  async getServerInfo(): Promise<Record<string, string>> {
    try {
      const info = await this.client.info();
      const lines = info.split('\r\n');
      const result: Record<string, string> = {};

      for (const line of lines) {
        if (line.includes(':') && !line.startsWith('#')) {
          const [key, value] = line.split(':');
          result[key] = value;
        }
      }

      return result;
    } catch (error) {
      this.logger?.error('Failed to get Redis server info', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {};
    }
  }

  // Get memory usage
  async getMemoryUsage(): Promise<{
    used: number;
    peak: number;
    percentage: number;
  }> {
    try {
      const info = await this.getServerInfo();
      const used = parseInt(info['used_memory'] || '0');
      const peak = parseInt(info['used_memory_peak'] || '0');
      const total = parseInt(info['maxmemory'] || '0');

      return {
        used,
        peak,
        percentage: total > 0 ? (used / total) * 100 : 0,
      };
    } catch (error) {
      this.logger?.error('Failed to get Redis memory usage', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { used: 0, peak: 0, percentage: 0 };
    }
  }

  // Execute Redis command with retry logic
  async executeCommand<T>(command: () => Promise<T>, retries = 3): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await command();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === retries) {
          this.logger?.error('Redis command failed after all retries', {
            error: lastError.message,
            attempts: retries,
          });
          break;
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));

        this.logger?.warn('Redis command failed, retrying', {
          error: lastError.message,
          attempt,
          maxRetries: retries,
          delay,
        });
      }
    }

    throw lastError || new Error('Redis command failed');
  }

  // Flush database (be careful!)
  async flushdb(): Promise<void> {
    try {
      await this.client.flushdb();
      this.logger?.warn('Redis database flushed');
    } catch (error) {
      this.logger?.error('Failed to flush Redis database', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Get configuration
  getConfig(): RedisConfig {
    return { ...this.config };
  }
}

// Default Redis client instance
let defaultClient: RedisConnectionManager | null = null;

// Initialize default Redis client
export function initializeRedis(config: Partial<RedisConfig>, logger?: any): RedisConnectionManager {
  if (defaultClient) {
    throw new Error('Redis client already initialized. Use getRedisClient() to access it.');
  }

  defaultClient = new RedisConnectionManager(config, logger);
  return defaultClient;
}

// Get default Redis client
export function getRedisClient(): RedisConnectionManager {
  if (!defaultClient) {
    throw new Error('Redis client not initialized. Call initializeRedis() first.');
  }
  return defaultClient;
}

// Create a new Redis client instance
export function createRedisClient(config: Partial<RedisConfig>, logger?: any): RedisConnectionManager {
  return new RedisConnectionManager(config, logger);
}

// Helper function to get client from environment
export function createRedisFromEnv(logger?: any): RedisConnectionManager {
  const config: Partial<RedisConfig> = {};

  if (process.env.REDIS_URL) {
    config.url = process.env.REDIS_URL;
  } else {
    config.host = process.env.REDIS_HOST || 'localhost';
    config.port = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379;
    config.password = process.env.REDIS_PASSWORD;
    config.db = process.env.REDIS_DB ? parseInt(process.env.REDIS_DB) : 0;
  }

  return new RedisConnectionManager(config, logger);
}

// Export the Redis client type for external use
export type { Redis };

// Export default for backward compatibility
export default RedisConnectionManager;