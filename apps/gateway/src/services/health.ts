import { z } from 'zod';

// Health check status levels
export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  UNKNOWN = 'unknown',
}

// Individual service health check result
export interface ServiceHealthCheck {
  name: string;
  status: HealthStatus;
  responseTime: number;
  lastCheck: Date;
  error?: string;
  metadata?: Record<string, any>;
}

// Overall health check result
export interface GatewayHealthCheck {
  status: HealthStatus;
  version: string;
  timestamp: Date;
  uptime: number;
  services: ServiceHealthCheck[];
  dependencies: {
    redis: ServiceHealthCheck;
  };
  metrics: {
    totalRequests: number;
    successRate: number;
    avgResponseTime: number;
    errorRate: number;
  };
}

// Monitoring statistics
export interface GatewayMonitoringStats {
  gateway: {
    uptime: number;
    version: string;
    environment: string;
    startTime: Date;
    pid: number;
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    cpu: {
      usage: number;
    };
  };
  requests: {
    total: number;
    successful: number;
    failed: number;
    inProgress: number;
    rate: number; // requests per minute
    avgResponseTime: number;
    slowRequests: number;
  };
  services: Array<{
    name: string;
    target: string;
    status: HealthStatus;
    responseTime: number;
    successRate: number;
    circuitBreakerStatus: 'open' | 'closed' | 'half-open';
    lastCheck: Date;
  }>;
  rateLimiting: {
    totalRequests: number;
    blockedRequests: number;
    topViolators: Array<{
      identifier: string;
      violations: number;
    }>;
  };
  errors: Array<{
    type: string;
    count: number;
    lastOccurred: Date;
  }>;
}

// Health check configuration
export const HealthConfigSchema = z.object({
  checkInterval: z.number().min(5000).default(30000), // 30 seconds
  timeout: z.number().min(1000).default(5000), // 5 seconds
  retries: z.number().min(0).max(3).default(1),
  degradedThreshold: z.number().min(0).max(100).default(70), // % of services healthy
  unhealthyThreshold: z.number().min(0).max(100).default(30), // % of services healthy
});

export type HealthConfig = z.infer<typeof HealthConfigSchema>;

// Gateway health monitor
export class GatewayHealthMonitor {
  private config: HealthConfig;
  private logger: any;
  private router: any; // GatewayRouter instance
  private redisClient: any;
  private rateLimiter: any; // GatewayRateLimiter instance
  private gatewayLogger: any; // GatewayLogger instance
  private startTime: Date;
  private serviceHealthCache: Map<string, ServiceHealthCheck>;

  constructor(
    router: any,
    redisClient: any,
    rateLimiter: any,
    gatewayLogger: any,
    pinoLogger: any,
    config?: Partial<HealthConfig>
  ) {
    this.config = {
      ...HealthConfigSchema.parse({}),
      ...config,
    };
    this.logger = pinoLogger;
    this.router = router;
    this.redisClient = redisClient;
    this.rateLimiter = rateLimiter;
    this.gatewayLogger = gatewayLogger;
    this.startTime = new Date();
    this.serviceHealthCache = new Map();

    // Start periodic health checks
    this.startHealthChecks();
  }

  // Get comprehensive health check status
  async getHealthStatus(): Promise<GatewayHealthCheck> {
    const startTime = Date.now();

    try {
      // Check all services in parallel
      const [servicesHealth, redisHealth] = await Promise.all([
        this.checkAllServices(),
        this.checkRedisHealth(),
      ]);

      // Calculate overall status
      const healthyServices = servicesHealth.filter(s => s.status === HealthStatus.HEALTHY).length;
      const totalServices = servicesHealth.length;
      const healthPercentage = totalServices > 0 ? (healthyServices / totalServices) * 100 : 100;

      let overallStatus = HealthStatus.HEALTHY;
      if (healthPercentage < this.config.unhealthyThreshold) {
        overallStatus = HealthStatus.UNHEALTHY;
      } else if (healthPercentage < this.config.degradedThreshold) {
        overallStatus = HealthStatus.DEGRADED;
      }

      // If Redis is unhealthy, mark overall as degraded at minimum
      if (redisHealth.status === HealthStatus.UNHEALTHY && overallStatus === HealthStatus.HEALTHY) {
        overallStatus = HealthStatus.DEGRADED;
      }

      // Get request metrics
      const metrics = this.gatewayLogger.getMetrics();
      const totalRequests = metrics.totalRequests || 1; // Avoid division by zero

      const healthCheck: GatewayHealthCheck = {
        status: overallStatus,
        version: '1.0.0',
        timestamp: new Date(),
        uptime: Date.now() - this.startTime.getTime(),
        services: servicesHealth,
        dependencies: {
          redis: redisHealth,
        },
        metrics: {
          totalRequests: metrics.totalRequests,
          successRate: (metrics.successfulRequests / totalRequests) * 100,
          avgResponseTime: metrics.avgResponseTime,
          errorRate: (metrics.failedRequests / totalRequests) * 100,
        },
      };

      const checkDuration = Date.now() - startTime;
      this.logger.debug('Health check completed', {
        status: overallStatus,
        duration: checkDuration,
        servicesChecked: totalServices,
        healthyServices,
      });

      return healthCheck;

    } catch (error) {
      this.logger.error('Health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        status: HealthStatus.UNKNOWN,
        version: '1.0.0',
        timestamp: new Date(),
        uptime: Date.now() - this.startTime.getTime(),
        services: [],
        dependencies: {
          redis: {
            name: 'redis',
            status: HealthStatus.UNKNOWN,
            responseTime: 0,
            lastCheck: new Date(),
            error: 'Health check system failure',
          },
        },
        metrics: {
          totalRequests: 0,
          successRate: 0,
          avgResponseTime: 0,
          errorRate: 100,
        },
      };
    }
  }

  // Get comprehensive monitoring statistics
  async getMonitoringStats(): Promise<GatewayMonitoringStats> {
    try {
      // Get process metrics
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      // Get service statistics
      const routingStats = this.router.getRoutingStats();
      const requestMetrics = this.gatewayLogger.getMetrics();
      const rateLimitStats = await this.rateLimiter.getRateLimitStats();

      // Calculate request rate (requests per minute)
      const uptimeMinutes = (Date.now() - this.startTime.getTime()) / 60000;
      const requestRate = uptimeMinutes > 0 ? requestMetrics.totalRequests / uptimeMinutes : 0;

      const stats: GatewayMonitoringStats = {
        gateway: {
          uptime: Date.now() - this.startTime.getTime(),
          version: '1.0.0',
          environment: process.env.NODE_ENV || 'development',
          startTime: this.startTime,
          pid: process.pid,
          memory: {
            used: memoryUsage.heapUsed,
            total: memoryUsage.heapTotal,
            percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
          },
          cpu: {
            usage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
          },
        },
        requests: {
          total: requestMetrics.totalRequests,
          successful: requestMetrics.successfulRequests,
          failed: requestMetrics.failedRequests,
          inProgress: this.getInProgressRequestCount(),
          rate: requestRate,
          avgResponseTime: requestMetrics.avgResponseTime,
          slowRequests: requestMetrics.slowRequests,
        },
        services: routingStats.routes.map(route => ({
          name: route.path,
          target: route.target,
          status: route.healthy ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
          responseTime: this.serviceHealthCache.get(route.target)?.responseTime || 0,
          successRate: this.calculateServiceSuccessRate(route.target),
          circuitBreakerStatus: route.circuitOpen ? 'open' : 'closed',
          lastCheck: this.serviceHealthCache.get(route.target)?.lastCheck || new Date(),
        })),
        rateLimiting: {
          totalRequests: requestMetrics.totalRequests,
          blockedRequests: rateLimitStats.violations.length,
          topViolators: rateLimitStats.violations
            .reduce((acc, violation) => {
              const existing = acc.find(v => v.identifier === violation.identifier);
              if (existing) {
                existing.violations++;
              } else {
                acc.push({ identifier: violation.identifier, violations: 1 });
              }
              return acc;
            }, [] as Array<{ identifier: string; violations: number }>)
            .sort((a, b) => b.violations - a.violations)
            .slice(0, 10),
        },
        errors: Object.entries(requestMetrics.errorsByStatus).map(([status, count]) => ({
          type: `HTTP ${status}`,
          count,
          lastOccurred: new Date(), // In a real implementation, track actual timestamps
        })),
      };

      return stats;

    } catch (error) {
      this.logger.error('Failed to get monitoring stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Return default stats on error
      return this.getDefaultMonitoringStats();
    }
  }

  // Get simple readiness check (for load balancer probes)
  async getReadinessCheck(): Promise<{ ready: boolean; checks: Record<string, boolean> }> {
    try {
      const [redisReady] = await Promise.all([
        this.checkRedisReadiness(),
      ]);

      const checks = {
        redis: redisReady,
      };

      const ready = Object.values(checks).every(Boolean);

      return { ready, checks };

    } catch (error) {
      this.logger.error('Readiness check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        ready: false,
        checks: { redis: false },
      };
    }
  }

  // Get simple liveness check (for container orchestration)
  getLivenessCheck(): { alive: boolean; uptime: number } {
    const uptime = Date.now() - this.startTime.getTime();

    return {
      alive: true,
      uptime,
    };
  }

  // Private helper methods

  private startHealthChecks(): void {
    // Perform initial health check
    this.performPeriodicHealthCheck();

    // Set up periodic health checks
    setInterval(() => {
      this.performPeriodicHealthCheck();
    }, this.config.checkInterval);

    this.logger.info('Health monitoring started', {
      checkInterval: this.config.checkInterval,
      timeout: this.config.timeout,
    });
  }

  private async performPeriodicHealthCheck(): Promise<void> {
    try {
      const services = await this.checkAllServices();

      // Update cache
      for (const service of services) {
        this.serviceHealthCache.set(service.name, service);
      }

      const healthyCount = services.filter(s => s.status === HealthStatus.HEALTHY).length;

      this.logger.debug('Periodic health check completed', {
        totalServices: services.length,
        healthyServices: healthyCount,
      });

    } catch (error) {
      this.logger.error('Periodic health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async checkAllServices(): Promise<ServiceHealthCheck[]> {
    const routes = this.router.getRoutes();
    const uniqueServices = new Map<string, string>();

    // Get unique services from routes
    for (const [path, config] of Object.entries(routes)) {
      if (config.healthCheck) {
        uniqueServices.set(config.target, `${config.target}${config.healthCheck}`);
      }
    }

    // Check each service health
    const healthChecks = Array.from(uniqueServices.entries()).map(async ([target, healthUrl]) => {
      return this.checkServiceHealth(target, healthUrl);
    });

    const results = await Promise.allSettled(healthChecks);

    return results.map(result => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          name: 'unknown',
          status: HealthStatus.UNKNOWN,
          responseTime: 0,
          lastCheck: new Date(),
          error: 'Health check promise rejected',
        };
      }
    });
  }

  private async checkServiceHealth(target: string, healthUrl: string): Promise<ServiceHealthCheck> {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Gigz-Gateway-HealthCheck/1.0',
          'X-Health-Check': 'true',
        },
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      let status = HealthStatus.HEALTHY;
      let metadata: Record<string, any> | undefined;

      if (!response.ok) {
        status = HealthStatus.UNHEALTHY;
      } else {
        // Try to parse health response for additional metadata
        try {
          const contentType = response.headers.get('content-type');
          if (contentType?.includes('application/json')) {
            const healthData = await response.json();
            metadata = healthData;

            // Check if service reports itself as unhealthy
            if (healthData.status && healthData.status !== 'healthy') {
              status = HealthStatus.DEGRADED;
            }
          }
        } catch {
          // Ignore JSON parsing errors for simple health checks
        }
      }

      return {
        name: target,
        status,
        responseTime,
        lastCheck: new Date(),
        metadata,
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;

      return {
        name: target,
        status: HealthStatus.UNHEALTHY,
        responseTime,
        lastCheck: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async checkRedisHealth(): Promise<ServiceHealthCheck> {
    const startTime = Date.now();

    try {
      await this.redisClient.ping();
      const responseTime = Date.now() - startTime;

      return {
        name: 'redis',
        status: HealthStatus.HEALTHY,
        responseTime,
        lastCheck: new Date(),
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;

      return {
        name: 'redis',
        status: HealthStatus.UNHEALTHY,
        responseTime,
        lastCheck: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async checkRedisReadiness(): Promise<boolean> {
    try {
      await this.redisClient.ping();
      return true;
    } catch {
      return false;
    }
  }

  private getInProgressRequestCount(): number {
    // This would be tracked by the gateway logger in a real implementation
    return 0;
  }

  private calculateServiceSuccessRate(serviceTarget: string): number {
    // This would be calculated from actual request logs in a real implementation
    const health = this.serviceHealthCache.get(serviceTarget);
    return health?.status === HealthStatus.HEALTHY ? 100 : 0;
  }

  private getDefaultMonitoringStats(): GatewayMonitoringStats {
    return {
      gateway: {
        uptime: Date.now() - this.startTime.getTime(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        startTime: this.startTime,
        pid: process.pid,
        memory: { used: 0, total: 0, percentage: 0 },
        cpu: { usage: 0 },
      },
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        inProgress: 0,
        rate: 0,
        avgResponseTime: 0,
        slowRequests: 0,
      },
      services: [],
      rateLimiting: {
        totalRequests: 0,
        blockedRequests: 0,
        topViolators: [],
      },
      errors: [],
    };
  }
}