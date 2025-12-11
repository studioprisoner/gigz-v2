import { z } from 'zod';
import { NotificationType } from '../queue/index.js';

// Rate limit configuration
export const RateLimitConfigSchema = z.object({
  windowSizeMs: z.number().min(1000), // Minimum 1 second window
  maxRequests: z.number().min(1),
  blockDurationMs: z.number().min(1000), // Minimum 1 second block
});

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

// Rate limit check result
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  retryAfterMs?: number;
}

// Rate limit violation record
export interface RateLimitViolation {
  identifier: string;
  type: 'user' | 'global' | 'notification_type';
  timestamp: Date;
  requestCount: number;
  windowSizeMs: number;
}

// Default rate limits
const DEFAULT_RATE_LIMITS = {
  // Per user limits
  userGlobal: {
    windowSizeMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 100, // 100 notifications per hour per user
    blockDurationMs: 60 * 60 * 1000, // Block for 1 hour
  },
  userFriendRequests: {
    windowSizeMs: 60 * 1000, // 1 minute
    maxRequests: 1, // 1 friend request notification per minute
    blockDurationMs: 60 * 1000, // Block for 1 minute
  },
  userConcertReminders: {
    windowSizeMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5, // 5 concert reminders per 15 minutes
    blockDurationMs: 15 * 60 * 1000,
  },

  // Global limits (system-wide)
  globalNotifications: {
    windowSizeMs: 60 * 1000, // 1 minute
    maxRequests: 10000, // 10k notifications per minute globally
    blockDurationMs: 60 * 1000,
  },
  globalFriendRequests: {
    windowSizeMs: 60 * 1000, // 1 minute
    maxRequests: 1000, // 1k friend request notifications per minute
    blockDurationMs: 60 * 1000,
  },
};

// Rate limiter service
export class RateLimiter {
  private redisClient: any;
  private logger: any;
  private rateLimits: Record<string, RateLimitConfig>;

  constructor(redisClient: any, logger: any) {
    this.redisClient = redisClient;
    this.logger = logger;
    this.rateLimits = DEFAULT_RATE_LIMITS;
  }

  // Check if request is allowed for a user
  async checkUserRateLimit(
    userId: string,
    notificationType: NotificationType
  ): Promise<RateLimitResult> {
    const checks = [
      // Global user limit
      this.checkRateLimit(`user:${userId}`, this.rateLimits.userGlobal),

      // Notification type specific limit
      this.checkNotificationTypeLimit(userId, notificationType),
    ];

    const results = await Promise.all(checks);

    // If any check fails, return the most restrictive result
    const blocked = results.find(result => !result.allowed);
    if (blocked) {
      this.logger.warn('User rate limited', {
        userId,
        notificationType,
        remaining: blocked.remaining,
        resetTime: blocked.resetTime,
      });

      // Record violation
      await this.recordViolation({
        identifier: userId,
        type: 'user',
        timestamp: new Date(),
        requestCount: 0, // Will be filled by the specific check
        windowSizeMs: this.rateLimits.userGlobal.windowSizeMs,
      });

      return blocked;
    }

    // Return the most restrictive allowed result
    const mostRestrictive = results.reduce((min, current) =>
      current.remaining < min.remaining ? current : min
    );

    return mostRestrictive;
  }

  // Check global rate limits
  async checkGlobalRateLimit(notificationType: NotificationType): Promise<RateLimitResult> {
    const checks = [
      // Global notifications limit
      this.checkRateLimit('global:notifications', this.rateLimits.globalNotifications),

      // Global notification type limit
      this.checkGlobalNotificationTypeLimit(notificationType),
    ];

    const results = await Promise.all(checks);

    // If any check fails, return the failure
    const blocked = results.find(result => !result.allowed);
    if (blocked) {
      this.logger.warn('Global rate limit exceeded', {
        notificationType,
        remaining: blocked.remaining,
        resetTime: blocked.resetTime,
      });

      // Record violation
      await this.recordViolation({
        identifier: 'global',
        type: 'global',
        timestamp: new Date(),
        requestCount: 0,
        windowSizeMs: this.rateLimits.globalNotifications.windowSizeMs,
      });

      return blocked;
    }

    return results.reduce((min, current) =>
      current.remaining < min.remaining ? current : min
    );
  }

  // Increment usage counters after successful notification
  async recordUsage(userId: string, notificationType: NotificationType): Promise<void> {
    const keys = [
      `user:${userId}`,
      `global:notifications`,
      this.getNotificationTypeKey(userId, notificationType),
      this.getGlobalNotificationTypeKey(notificationType),
    ];

    try {
      await Promise.all(keys.map(key => this.incrementCounter(key)));

      this.logger.debug('Usage recorded', {
        userId,
        notificationType,
      });

    } catch (error) {
      this.logger.error('Failed to record usage', {
        userId,
        notificationType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Get rate limit statistics for monitoring
  async getRateLimitStats(): Promise<{
    violations: RateLimitViolation[];
    topUsers: Array<{ userId: string; count: number }>;
    notificationTypeStats: Record<NotificationType, { count: number; violations: number }>;
  }> {
    try {
      // Get recent violations
      const violations = await this.getRecentViolations(100);

      // Get top users by notification count
      const topUsers = await this.getTopUsers(10);

      // Get stats by notification type
      const notificationTypeStats = await this.getNotificationTypeStats();

      return {
        violations,
        topUsers,
        notificationTypeStats,
      };

    } catch (error) {
      this.logger.error('Failed to get rate limit stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        violations: [],
        topUsers: [],
        notificationTypeStats: {} as Record<NotificationType, { count: number; violations: number }>,
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

  private async checkRateLimit(
    key: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - config.windowSizeMs;

    try {
      // Use Redis sorted set to track requests in time window
      const pipeline = this.redisClient.pipeline();

      // Remove old entries
      pipeline.zremrangebyscore(key, 0, windowStart);

      // Count current entries
      pipeline.zcard(key);

      // Set expiration
      pipeline.expire(key, Math.ceil(config.windowSizeMs / 1000));

      const results = await pipeline.exec();
      const currentCount = results[1][1]; // Result of zcard

      const remaining = Math.max(0, config.maxRequests - currentCount);
      const resetTime = new Date(now + config.windowSizeMs);

      if (currentCount >= config.maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          resetTime,
          retryAfterMs: config.blockDurationMs,
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
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Allow on error to prevent blocking notifications
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetTime: new Date(now + config.windowSizeMs),
      };
    }
  }

  private async incrementCounter(key: string): Promise<void> {
    try {
      const now = Date.now();
      await this.redisClient.zadd(key, now, `${now}-${Math.random()}`);
    } catch (error) {
      this.logger.warn('Failed to increment counter', { key, error });
    }
  }

  private async checkNotificationTypeLimit(
    userId: string,
    notificationType: NotificationType
  ): Promise<RateLimitResult> {
    const key = this.getNotificationTypeKey(userId, notificationType);
    const config = this.getNotificationTypeConfig(notificationType);

    return this.checkRateLimit(key, config);
  }

  private async checkGlobalNotificationTypeLimit(
    notificationType: NotificationType
  ): Promise<RateLimitResult> {
    const key = this.getGlobalNotificationTypeKey(notificationType);
    const config = this.getGlobalNotificationTypeConfig(notificationType);

    return this.checkRateLimit(key, config);
  }

  private getNotificationTypeKey(userId: string, notificationType: NotificationType): string {
    return `user:${userId}:${notificationType}`;
  }

  private getGlobalNotificationTypeKey(notificationType: NotificationType): string {
    return `global:${notificationType}`;
  }

  private getNotificationTypeConfig(notificationType: NotificationType): RateLimitConfig {
    switch (notificationType) {
      case NotificationType.FRIEND_REQUEST_RECEIVED:
      case NotificationType.FRIEND_REQUEST_ACCEPTED:
        return this.rateLimits.userFriendRequests;

      case NotificationType.CONCERT_REMINDER:
        return this.rateLimits.userConcertReminders;

      default:
        return this.rateLimits.userGlobal;
    }
  }

  private getGlobalNotificationTypeConfig(notificationType: NotificationType): RateLimitConfig {
    switch (notificationType) {
      case NotificationType.FRIEND_REQUEST_RECEIVED:
      case NotificationType.FRIEND_REQUEST_ACCEPTED:
        return this.rateLimits.globalFriendRequests;

      default:
        return this.rateLimits.globalNotifications;
    }
  }

  private async recordViolation(violation: RateLimitViolation): Promise<void> {
    try {
      const key = 'violations:rate_limit';
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
      const key = 'violations:rate_limit';
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

  private async getTopUsers(limit: number): Promise<Array<{ userId: string; count: number }>> {
    try {
      // This would require more sophisticated tracking in a real implementation
      // For now, return empty array
      return [];

    } catch (error) {
      this.logger.warn('Failed to get top users', { error });
      return [];
    }
  }

  private async getNotificationTypeStats(): Promise<Record<NotificationType, { count: number; violations: number }>> {
    try {
      // This would require more sophisticated tracking in a real implementation
      // For now, return empty object
      return {} as Record<NotificationType, { count: number; violations: number }>;

    } catch (error) {
      this.logger.warn('Failed to get notification type stats', { error });
      return {} as Record<NotificationType, { count: number; violations: number }>;
    }
  }

  // Cleanup old rate limit data
  async cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    try {
      const cutoff = Date.now() - olderThanMs;
      let cleanedCount = 0;

      // Get all rate limit keys
      const pattern = 'user:*';
      const keys = await this.redisClient.keys(pattern);

      // Clean old entries from each key
      for (const key of keys) {
        const removed = await this.redisClient.zremrangebyscore(key, 0, cutoff);
        cleanedCount += removed;
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