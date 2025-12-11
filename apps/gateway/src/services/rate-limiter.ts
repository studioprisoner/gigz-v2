import { z } from 'zod';

// Rate limit configuration schema
export const RateLimitConfigSchema = z.object({
  requests: z.number().min(1),
  window: z.number().min(1), // seconds
  skipSuccessfulRequests: z.boolean().default(false),
  skipFailedRequests: z.boolean().default(false),
});

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

// Rate limit result
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  retryAfter?: number; // seconds
}

// Rate limit violation record
export interface RateLimitViolation {
  identifier: string;
  type: 'ip' | 'user' | 'endpoint';
  path: string;
  method: string;
  timestamp: Date;
  requestCount: number;
  windowSize: number;
}

// Default rate limits based on GIG-119 specification
const DEFAULT_RATE_LIMITS = {
  // Per-IP limits (unauthenticated users)
  anonymous: {
    requests: 60,
    window: 60, // 60 requests per minute
  },

  // Per-user limits (authenticated users)
  authenticated: {
    requests: 300,
    window: 60, // 300 requests per minute
  },

  // Endpoint-specific limits
  endpoints: {
    '/auth/apple': {
      requests: 10,
      window: 60, // 10 requests per minute for Apple Auth
    },
    '/auth/refresh': {
      requests: 20,
      window: 60, // 20 requests per minute for token refresh
    },
    '/search': {
      requests: 100,
      window: 60, // 100 requests per minute for search
    },
  },
};

// API Gateway Rate Limiter
export class GatewayRateLimiter {
  private redisClient: any;
  private logger: any;
  private rateLimits: typeof DEFAULT_RATE_LIMITS;

  constructor(redisClient: any, logger: any) {
    this.redisClient = redisClient;
    this.logger = logger;
    this.rateLimits = DEFAULT_RATE_LIMITS;
  }

  // Check rate limit for incoming request
  async checkRateLimit(
    request: Request,
    userId?: string
  ): Promise<RateLimitResult> {
    const url = new URL(request.url);
    const clientIP = this.getClientIP(request);
    const method = request.method;
    const path = url.pathname;

    try {
      // Get applicable rate limit configurations
      const limitConfigs = this.getRateLimitConfigs(path, !!userId);

      // Check each rate limit (most restrictive wins)
      const checks = await Promise.all([
        // Global IP-based limit
        this.checkLimit(`ip:${clientIP}`, limitConfigs.global, `${method} ${path}`),

        // User-based limit (if authenticated)
        userId ? this.checkLimit(`user:${userId}`, limitConfigs.user, `${method} ${path}`) : null,

        // Endpoint-specific limit
        limitConfigs.endpoint ? this.checkLimit(`endpoint:${path}:${userId || clientIP}`, limitConfigs.endpoint, `${method} ${path}`) : null,
      ].filter(Boolean));

      // Return most restrictive result
      const blocked = checks.find(result => !result.allowed);
      if (blocked) {
        // Log violation
        await this.recordViolation({
          identifier: userId || clientIP,
          type: userId ? 'user' : 'ip',
          path,
          method,
          timestamp: new Date(),
          requestCount: 0, // Will be filled by specific check
          windowSize: limitConfigs.global.window,
        });

        this.logger.warn('Rate limit exceeded', {
          identifier: userId || clientIP,
          path,
          method,
          remaining: blocked.remaining,
          resetTime: blocked.resetTime,
        });

        return blocked;
      }

      // Return least permissive allowed result
      return checks.reduce((min, current) =>
        current.remaining < min.remaining ? current : min
      );

    } catch (error) {
      this.logger.error('Rate limit check failed', {
        identifier: userId || clientIP,
        path,
        method,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Allow request on error to prevent blocking legitimate traffic
      return {
        allowed: true,
        remaining: 999,
        resetTime: new Date(Date.now() + 60000),
      };
    }
  }

  // Record successful request to increment counters
  async recordRequest(
    request: Request,
    userId?: string,
    statusCode?: number
  ): Promise<void> {
    const url = new URL(request.url);
    const clientIP = this.getClientIP(request);
    const path = url.pathname;

    // Skip recording based on configuration
    if (statusCode) {
      const isSuccess = statusCode >= 200 && statusCode < 400;
      const isFailure = statusCode >= 400;

      // Check if we should skip this request based on status
      const limitConfigs = this.getRateLimitConfigs(path, !!userId);
      if ((isSuccess && limitConfigs.global.skipSuccessfulRequests) ||
          (isFailure && limitConfigs.global.skipFailedRequests)) {
        return;
      }
    }

    const keys = [
      `ip:${clientIP}`,
      userId ? `user:${userId}` : null,
      this.getEndpointRateLimitConfig(path) ? `endpoint:${path}:${userId || clientIP}` : null,
    ].filter(Boolean);

    try {
      await Promise.all(keys.map(key => this.incrementCounter(key)));

      this.logger.debug('Request recorded for rate limiting', {
        identifier: userId || clientIP,
        path,
        statusCode,
      });

    } catch (error) {
      this.logger.warn('Failed to record request for rate limiting', {
        identifier: userId || clientIP,
        path,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Get current rate limit status for monitoring
  async getRateLimitStatus(identifier: string): Promise<{
    remaining: number;
    resetTime: Date;
    config: RateLimitConfig;
  } | null> {
    try {
      // Determine if identifier is user or IP
      const isUser = identifier.includes('@') || identifier.match(/^[a-f0-9-]{36}$/);
      const config = isUser ? this.rateLimits.authenticated : this.rateLimits.anonymous;

      const key = isUser ? `user:${identifier}` : `ip:${identifier}`;
      const now = Date.now();
      const windowStart = now - (config.window * 1000);

      // Count current requests in window
      const currentCount = await this.redisClient.zcount(key, windowStart, now);
      const remaining = Math.max(0, config.requests - currentCount);
      const resetTime = new Date(now + (config.window * 1000));

      return {
        remaining,
        resetTime,
        config,
      };

    } catch (error) {
      this.logger.error('Failed to get rate limit status', {
        identifier,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  // Get rate limit statistics for monitoring
  async getRateLimitStats(): Promise<{
    violations: RateLimitViolation[];
    topIPs: Array<{ ip: string; count: number }>;
    topUsers: Array<{ userId: string; count: number }>;
  }> {
    try {
      // Get recent violations
      const violations = await this.getRecentViolations(100);

      // TODO: Implement top IPs and users analytics
      const topIPs: Array<{ ip: string; count: number }> = [];
      const topUsers: Array<{ userId: string; count: number }> = [];

      return {
        violations,
        topIPs,
        topUsers,
      };

    } catch (error) {
      this.logger.error('Failed to get rate limit stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        violations: [],
        topIPs: [],
        topUsers: [],
      };
    }
  }

  // Update rate limit configuration
  updateRateLimits(newLimits: Partial<typeof DEFAULT_RATE_LIMITS>): void {
    this.rateLimits = {
      ...this.rateLimits,
      ...newLimits,
    };

    this.logger.info('Rate limits updated', {
      updatedKeys: Object.keys(newLimits),
    });
  }

  // Private helper methods

  private async checkLimit(
    key: string,
    config: RateLimitConfig,
    context: string
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - (config.window * 1000);

    try {
      // Use Redis sorted set for sliding window
      const pipeline = this.redisClient.pipeline();

      // Remove old entries
      pipeline.zremrangebyscore(key, 0, windowStart);

      // Count current entries
      pipeline.zcard(key);

      // Set expiration
      pipeline.expire(key, config.window);

      const results = await pipeline.exec();
      const currentCount = results[1][1];

      const remaining = Math.max(0, config.requests - currentCount);
      const resetTime = new Date(now + (config.window * 1000));

      if (currentCount >= config.requests) {
        return {
          allowed: false,
          remaining: 0,
          resetTime,
          retryAfter: config.window,
        };
      }

      return {
        allowed: true,
        remaining,
        resetTime,
      };

    } catch (error) {
      this.logger.error('Rate limit check failed', {
        key,
        context,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Allow on error
      return {
        allowed: true,
        remaining: config.requests,
        resetTime: new Date(now + (config.window * 1000)),
      };
    }
  }

  private async incrementCounter(key: string): Promise<void> {
    try {
      const now = Date.now();
      const score = now;
      const member = `${now}-${Math.random()}`;

      await this.redisClient.zadd(key, score, member);
    } catch (error) {
      this.logger.warn('Failed to increment rate limit counter', { key, error });
    }
  }

  private getRateLimitConfigs(path: string, isAuthenticated: boolean) {
    const global = isAuthenticated ? this.rateLimits.authenticated : this.rateLimits.anonymous;
    const user = isAuthenticated ? this.rateLimits.authenticated : null;
    const endpoint = this.getEndpointRateLimitConfig(path);

    return { global, user, endpoint };
  }

  private getEndpointRateLimitConfig(path: string): RateLimitConfig | null {
    // Check for exact path match
    if (this.rateLimits.endpoints[path]) {
      return this.rateLimits.endpoints[path];
    }

    // Check for prefix matches (e.g., /auth/* paths)
    for (const [endpointPath, config] of Object.entries(this.rateLimits.endpoints)) {
      if (path.startsWith(endpointPath.replace('*', ''))) {
        return config;
      }
    }

    return null;
  }

  private getClientIP(request: Request): string {
    // Try to get real IP from headers (considering proxies)
    const headers = request.headers;

    // Check common proxy headers
    const xForwardedFor = headers.get('x-forwarded-for');
    if (xForwardedFor) {
      return xForwardedFor.split(',')[0].trim();
    }

    const xRealIP = headers.get('x-real-ip');
    if (xRealIP) {
      return xRealIP;
    }

    const cfConnectingIP = headers.get('cf-connecting-ip'); // Cloudflare
    if (cfConnectingIP) {
      return cfConnectingIP;
    }

    // Fallback - this might not work in production behind proxies
    return '127.0.0.1'; // Default for development
  }

  private async recordViolation(violation: RateLimitViolation): Promise<void> {
    try {
      const key = 'gateway:rate_limit_violations';
      const violationData = JSON.stringify(violation);

      await this.redisClient.lpush(key, violationData);
      await this.redisClient.ltrim(key, 0, 999); // Keep last 1000 violations
      await this.redisClient.expire(key, 24 * 60 * 60); // Expire after 24 hours

    } catch (error) {
      this.logger.warn('Failed to record rate limit violation', {
        violation,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async getRecentViolations(limit: number): Promise<RateLimitViolation[]> {
    try {
      const key = 'gateway:rate_limit_violations';
      const violationStrings = await this.redisClient.lrange(key, 0, limit - 1);

      return violationStrings.map((str: string) => {
        const parsed = JSON.parse(str);
        return {
          ...parsed,
          timestamp: new Date(parsed.timestamp),
        };
      });

    } catch (error) {
      this.logger.warn('Failed to get recent violations', { error });
      return [];
    }
  }

  // Cleanup old rate limit data
  async cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    try {
      const cutoff = Date.now() - olderThanMs;
      let cleanedCount = 0;

      // Get all rate limit keys
      const patterns = ['ip:*', 'user:*', 'endpoint:*'];

      for (const pattern of patterns) {
        const keys = await this.redisClient.keys(pattern);

        for (const key of keys) {
          const removed = await this.redisClient.zremrangebyscore(key, 0, cutoff);
          cleanedCount += removed;
        }
      }

      this.logger.info('Rate limit cleanup completed', {
        cleanedCount,
        olderThanMs,
      });

      return cleanedCount;

    } catch (error) {
      this.logger.error('Rate limit cleanup failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }
}