import { z } from 'zod';
import type { Redis } from 'ioredis';
import { getRedisClient } from './client.js';

// Health check configuration schema
export const HealthCheckConfigSchema = z.object({
  checkInterval: z.number().min(1000).default(30000), // 30 seconds
  timeout: z.number().min(1000).default(5000), // 5 seconds
  enableMetrics: z.boolean().default(true),
  thresholds: z.object({
    maxMemoryUsage: z.number().min(0).max(100).default(90), // percentage
    maxLatency: z.number().min(0).default(1000), // milliseconds
    minConnections: z.number().min(0).default(1),
  }).default({}),
});

export type HealthCheckConfig = z.infer<typeof HealthCheckConfigSchema>;

// Health status
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  uptime: number;
  checks: {
    connectivity: HealthCheck;
    memory: HealthCheck;
    latency: HealthCheck;
    commands: HealthCheck;
  };
  metrics: RedisMetrics;
}

// Individual health check result
export interface HealthCheck {
  status: 'pass' | 'warn' | 'fail';
  message: string;
  value?: number | string;
  threshold?: number;
  duration?: number;
}

// Redis metrics
export interface RedisMetrics {
  memory: {
    used: number;
    peak: number;
    percentage: number;
    fragmentation: number;
  };
  connections: {
    total: number;
    clients: number;
    blocked: number;
  };
  operations: {
    totalCommands: number;
    commandsPerSecond: number;
    hits: number;
    misses: number;
    hitRate: number;
  };
  keyspace: {
    totalKeys: number;
    expires: number;
    averageTTL: number;
  };
  replication: {
    role: string;
    connectedSlaves: number;
    replOffset?: number;
  };
}

// Redis health monitor
export class RedisHealthMonitor {
  private client: Redis;
  private config: HealthCheckConfig;
  private logger?: any;
  private startTime: number;
  private interval?: NodeJS.Timeout;
  private lastMetrics?: RedisMetrics;

  constructor(client?: Redis, config?: Partial<HealthCheckConfig>, logger?: any) {
    this.client = client || getRedisClient().getClient();
    this.config = HealthCheckConfigSchema.parse(config || {});
    this.logger = logger;
    this.startTime = Date.now();
  }

  // Start continuous health monitoring
  start(): void {
    if (this.interval) {
      this.logger?.warn('Health monitor already started');
      return;
    }

    this.interval = setInterval(async () => {
      try {
        const health = await this.check();
        this.logger?.debug('Health check completed', {
          status: health.status,
          duration: health.checks.connectivity.duration,
        });

        if (health.status === 'unhealthy') {
          this.logger?.error('Redis health check failed', { health });
        } else if (health.status === 'degraded') {
          this.logger?.warn('Redis health degraded', { health });
        }
      } catch (error) {
        this.logger?.error('Health check error', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, this.config.checkInterval);

    this.logger?.info('Redis health monitor started', {
      checkInterval: this.config.checkInterval,
    });
  }

  // Stop health monitoring
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
      this.logger?.info('Redis health monitor stopped');
    }
  }

  // Perform comprehensive health check
  async check(): Promise<HealthStatus> {
    const startTime = Date.now();
    const checks = {
      connectivity: await this.checkConnectivity(),
      memory: await this.checkMemory(),
      latency: await this.checkLatency(),
      commands: await this.checkCommands(),
    };

    const metrics = this.config.enableMetrics ? await this.collectMetrics() : this.getEmptyMetrics();
    this.lastMetrics = metrics;

    // Determine overall health status
    const failedChecks = Object.values(checks).filter(check => check.status === 'fail').length;
    const warnChecks = Object.values(checks).filter(check => check.status === 'warn').length;

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (failedChecks > 0) {
      status = 'unhealthy';
    } else if (warnChecks > 0) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      timestamp: new Date(),
      uptime: Date.now() - this.startTime,
      checks,
      metrics,
    };
  }

  // Check Redis connectivity
  private async checkConnectivity(): Promise<HealthCheck> {
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        this.client.ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), this.config.timeout)
        ),
      ]);

      const duration = Date.now() - startTime;

      if (result === 'PONG') {
        return {
          status: 'pass',
          message: 'Redis is responding to ping',
          duration,
        };
      }

      return {
        status: 'fail',
        message: 'Redis ping returned unexpected result',
        value: result,
        duration,
      };
    } catch (error) {
      return {
        status: 'fail',
        message: `Redis connectivity failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        duration: Date.now() - startTime,
      };
    }
  }

  // Check memory usage
  private async checkMemory(): Promise<HealthCheck> {
    try {
      const info = await this.client.info('memory');
      const lines = info.split('\r\n');
      const memoryData: Record<string, string> = {};

      for (const line of lines) {
        if (line.includes(':') && !line.startsWith('#')) {
          const [key, value] = line.split(':');
          memoryData[key] = value;
        }
      }

      const used = parseInt(memoryData.used_memory || '0');
      const maxMemory = parseInt(memoryData.maxmemory || '0');
      const percentage = maxMemory > 0 ? (used / maxMemory) * 100 : 0;

      if (percentage > this.config.thresholds.maxMemoryUsage) {
        return {
          status: 'fail',
          message: `Memory usage above threshold`,
          value: percentage,
          threshold: this.config.thresholds.maxMemoryUsage,
        };
      }

      if (percentage > this.config.thresholds.maxMemoryUsage * 0.8) {
        return {
          status: 'warn',
          message: `Memory usage approaching threshold`,
          value: percentage,
          threshold: this.config.thresholds.maxMemoryUsage,
        };
      }

      return {
        status: 'pass',
        message: 'Memory usage within limits',
        value: percentage,
        threshold: this.config.thresholds.maxMemoryUsage,
      };
    } catch (error) {
      return {
        status: 'fail',
        message: `Memory check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // Check command latency
  private async checkLatency(): Promise<HealthCheck> {
    const startTime = Date.now();

    try {
      // Test with simple SET/GET operations
      const testKey = `health_check:${Date.now()}`;
      const testValue = 'ping';

      await this.client.set(testKey, testValue, 'EX', 60);
      const result = await this.client.get(testKey);
      await this.client.del(testKey);

      const duration = Date.now() - startTime;

      if (result !== testValue) {
        return {
          status: 'fail',
          message: 'SET/GET operation returned incorrect value',
          duration,
        };
      }

      if (duration > this.config.thresholds.maxLatency) {
        return {
          status: 'fail',
          message: `Command latency above threshold`,
          value: duration,
          threshold: this.config.thresholds.maxLatency,
          duration,
        };
      }

      if (duration > this.config.thresholds.maxLatency * 0.8) {
        return {
          status: 'warn',
          message: `Command latency approaching threshold`,
          value: duration,
          threshold: this.config.thresholds.maxLatency,
          duration,
        };
      }

      return {
        status: 'pass',
        message: 'Command latency within limits',
        value: duration,
        threshold: this.config.thresholds.maxLatency,
        duration,
      };
    } catch (error) {
      return {
        status: 'fail',
        message: `Latency check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        duration: Date.now() - startTime,
      };
    }
  }

  // Check command execution
  private async checkCommands(): Promise<HealthCheck> {
    try {
      // Test basic Redis commands
      const testKey = `health_check:commands:${Date.now()}`;

      // Test STRING operations
      await this.client.set(testKey, 'test');
      const value = await this.client.get(testKey);

      // Test LIST operations
      await this.client.lpush(`${testKey}:list`, 'item1', 'item2');
      const listLength = await this.client.llen(`${testKey}:list`);

      // Test HASH operations
      await this.client.hset(`${testKey}:hash`, 'field1', 'value1');
      const hashValue = await this.client.hget(`${testKey}:hash`, 'field1');

      // Cleanup
      await this.client.del(testKey, `${testKey}:list`, `${testKey}:hash`);

      // Validate results
      if (value !== 'test' || listLength !== 2 || hashValue !== 'value1') {
        return {
          status: 'fail',
          message: 'Redis command operations returned unexpected results',
        };
      }

      return {
        status: 'pass',
        message: 'All Redis commands executed successfully',
      };
    } catch (error) {
      return {
        status: 'fail',
        message: `Command execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // Collect comprehensive Redis metrics
  async collectMetrics(): Promise<RedisMetrics> {
    try {
      const [memoryInfo, statsInfo, clientsInfo, keyspaceInfo, replicationInfo] = await Promise.all([
        this.client.info('memory'),
        this.client.info('stats'),
        this.client.info('clients'),
        this.client.info('keyspace'),
        this.client.info('replication'),
      ]);

      return {
        memory: this.parseMemoryInfo(memoryInfo),
        connections: this.parseClientsInfo(clientsInfo),
        operations: this.parseStatsInfo(statsInfo),
        keyspace: this.parseKeyspaceInfo(keyspaceInfo),
        replication: this.parseReplicationInfo(replicationInfo),
      };
    } catch (error) {
      this.logger?.error('Failed to collect Redis metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.getEmptyMetrics();
    }
  }

  // Parse memory info
  private parseMemoryInfo(info: string): RedisMetrics['memory'] {
    const data = this.parseInfoString(info);

    const used = parseInt(data.used_memory || '0');
    const peak = parseInt(data.used_memory_peak || '0');
    const maxMemory = parseInt(data.maxmemory || '0');
    const fragmentation = parseFloat(data.mem_fragmentation_ratio || '1');

    return {
      used,
      peak,
      percentage: maxMemory > 0 ? (used / maxMemory) * 100 : 0,
      fragmentation,
    };
  }

  // Parse clients info
  private parseClientsInfo(info: string): RedisMetrics['connections'] {
    const data = this.parseInfoString(info);

    return {
      total: parseInt(data.connected_clients || '0'),
      clients: parseInt(data.connected_clients || '0'),
      blocked: parseInt(data.blocked_clients || '0'),
    };
  }

  // Parse stats info
  private parseStatsInfo(info: string): RedisMetrics['operations'] {
    const data = this.parseInfoString(info);

    const totalCommands = parseInt(data.total_commands_processed || '0');
    const commandsPerSecond = parseFloat(data.instantaneous_ops_per_sec || '0');
    const hits = parseInt(data.keyspace_hits || '0');
    const misses = parseInt(data.keyspace_misses || '0');
    const hitRate = hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0;

    return {
      totalCommands,
      commandsPerSecond,
      hits,
      misses,
      hitRate,
    };
  }

  // Parse keyspace info
  private parseKeyspaceInfo(info: string): RedisMetrics['keyspace'] {
    const data = this.parseInfoString(info);

    let totalKeys = 0;
    let expires = 0;
    let averageTTL = 0;

    // Parse db0, db1, etc.
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('db')) {
        const match = value.match(/keys=(\d+),expires=(\d+),avg_ttl=(\d+)/);
        if (match) {
          totalKeys += parseInt(match[1]);
          expires += parseInt(match[2]);
          averageTTL = parseInt(match[3]); // Last value wins for simplicity
        }
      }
    }

    return {
      totalKeys,
      expires,
      averageTTL,
    };
  }

  // Parse replication info
  private parseReplicationInfo(info: string): RedisMetrics['replication'] {
    const data = this.parseInfoString(info);

    return {
      role: data.role || 'unknown',
      connectedSlaves: parseInt(data.connected_slaves || '0'),
      replOffset: data.master_repl_offset ? parseInt(data.master_repl_offset) : undefined,
    };
  }

  // Parse Redis INFO response
  private parseInfoString(info: string): Record<string, string> {
    const lines = info.split('\r\n');
    const result: Record<string, string> = {};

    for (const line of lines) {
      if (line.includes(':') && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        result[key] = value;
      }
    }

    return result;
  }

  // Get empty metrics structure
  private getEmptyMetrics(): RedisMetrics {
    return {
      memory: { used: 0, peak: 0, percentage: 0, fragmentation: 1 },
      connections: { total: 0, clients: 0, blocked: 0 },
      operations: { totalCommands: 0, commandsPerSecond: 0, hits: 0, misses: 0, hitRate: 0 },
      keyspace: { totalKeys: 0, expires: 0, averageTTL: 0 },
      replication: { role: 'unknown', connectedSlaves: 0 },
    };
  }

  // Get last collected metrics
  getLastMetrics(): RedisMetrics | undefined {
    return this.lastMetrics;
  }

  // Get configuration
  getConfig(): HealthCheckConfig {
    return { ...this.config };
  }

  // Update configuration
  updateConfig(newConfig: Partial<HealthCheckConfig>): void {
    this.config = HealthCheckConfigSchema.parse({
      ...this.config,
      ...newConfig,
    });

    // Restart monitoring with new config if running
    if (this.interval) {
      this.stop();
      this.start();
    }

    this.logger?.info('Health monitor configuration updated', {
      updatedKeys: Object.keys(newConfig),
    });
  }
}

// Default health monitor instance
let defaultMonitor: RedisHealthMonitor | null = null;

// Initialize default health monitor
export function initializeHealthMonitor(
  client?: Redis,
  config?: Partial<HealthCheckConfig>,
  logger?: any
): RedisHealthMonitor {
  if (defaultMonitor) {
    throw new Error('Health monitor already initialized. Use getHealthMonitor() to access it.');
  }

  defaultMonitor = new RedisHealthMonitor(client, config, logger);
  return defaultMonitor;
}

// Get default health monitor instance
export function getHealthMonitor(): RedisHealthMonitor {
  if (!defaultMonitor) {
    // Auto-initialize with default settings if not already done
    defaultMonitor = new RedisHealthMonitor();
  }
  return defaultMonitor;
}

// Create a new health monitor instance
export function createHealthMonitor(
  client?: Redis,
  config?: Partial<HealthCheckConfig>,
  logger?: any
): RedisHealthMonitor {
  return new RedisHealthMonitor(client, config, logger);
}

// Utility function to perform a quick health check
export async function quickHealthCheck(): Promise<HealthStatus> {
  return getHealthMonitor().check();
}

// Export health monitor class and utilities
export default RedisHealthMonitor;