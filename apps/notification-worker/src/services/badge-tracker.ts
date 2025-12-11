import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { NotificationType, NotificationDeliveryResult } from '../queue/index.js';

// Badge count categories
export enum BadgeCategory {
  FRIEND_REQUESTS = 'friend_requests',
  UNREAD_NOTIFICATIONS = 'unread_notifications',
  MISSED_ACTIVITY = 'missed_activity',
}

// Badge count record interface
export interface BadgeCountRecord {
  userId: string;
  friendRequests: number;
  unreadNotifications: number;
  missedActivity: number;
  lastUpdated: Date;
}

// Delivery tracking record interface
export interface DeliveryTrackingRecord {
  id: string;
  jobId: string;
  userId: string;
  notificationType: NotificationType;
  deviceToken: string;
  status: 'sent' | 'failed' | 'invalid_token';
  error?: string;
  messageId?: string;
  sentAt: Date;
  processingTime: number;
}

// Badge increment request
export const BadgeIncrementSchema = z.object({
  userId: z.string().uuid(),
  category: z.nativeEnum(BadgeCategory),
  amount: z.number().min(1).default(1),
});

export type BadgeIncrement = z.infer<typeof BadgeIncrementSchema>;

// Delivery analytics
export interface DeliveryAnalytics {
  totalNotifications: number;
  successRate: number;
  failureRate: number;
  invalidTokenRate: number;
  averageProcessingTime: number;
  notificationsByType: Record<NotificationType, number>;
  deliveriesByHour: Record<number, number>;
  recentFailures: Array<{
    userId: string;
    notificationType: NotificationType;
    error: string;
    timestamp: Date;
  }>;
}

// Badge and delivery tracking service
export class BadgeTracker {
  private dbClient: any;
  private redisClient: any;
  private logger: any;

  constructor(dbClient: any, redisClient: any, logger: any) {
    this.dbClient = dbClient;
    this.redisClient = redisClient;
    this.logger = logger;
  }

  // Get total badge count for a user
  async getBadgeCount(userId: string): Promise<number> {
    try {
      const counts = await this.getBadgeCountBreakdown(userId);
      const total = counts.friendRequests + counts.unreadNotifications + counts.missedActivity;

      this.logger.debug('Badge count calculated', {
        userId,
        breakdown: counts,
        total,
      });

      // Cache the result for 1 minute to reduce database load
      await this.cacheBadgeCount(userId, total, 60);

      return Math.min(total, 99); // iOS shows 99+ for values over 99

    } catch (error) {
      this.logger.error('Failed to get badge count', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  // Get badge count breakdown by category
  async getBadgeCountBreakdown(userId: string): Promise<BadgeCountRecord> {
    try {
      // First try to get from cache
      const cached = await this.getCachedBadgeCountBreakdown(userId);
      if (cached) {
        return cached;
      }

      // Calculate from database
      const [friendRequests, unreadNotifications, missedActivity] = await Promise.all([
        this.getFriendRequestCount(userId),
        this.getUnreadNotificationCount(userId),
        this.getMissedActivityCount(userId),
      ]);

      const breakdown: BadgeCountRecord = {
        userId,
        friendRequests,
        unreadNotifications,
        missedActivity,
        lastUpdated: new Date(),
      };

      // Cache the breakdown
      await this.cacheBadgeCountBreakdown(userId, breakdown, 60);

      return breakdown;

    } catch (error) {
      this.logger.error('Failed to get badge count breakdown', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        userId,
        friendRequests: 0,
        unreadNotifications: 0,
        missedActivity: 0,
        lastUpdated: new Date(),
      };
    }
  }

  // Increment badge count for specific category
  async incrementBadgeCount(increment: BadgeIncrement): Promise<number> {
    BadgeIncrementSchema.parse(increment);

    try {
      this.logger.debug('Incrementing badge count', {
        userId: increment.userId,
        category: increment.category,
        amount: increment.amount,
      });

      // Increment in database
      await this.incrementBadgeCountInDB(increment);

      // Invalidate cache
      await this.invalidateBadgeCache(increment.userId);

      // Get new total count
      const newCount = await this.getBadgeCount(increment.userId);

      this.logger.debug('Badge count incremented', {
        userId: increment.userId,
        category: increment.category,
        newTotal: newCount,
      });

      return newCount;

    } catch (error) {
      this.logger.error('Failed to increment badge count', {
        userId: increment.userId,
        category: increment.category,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  // Reset badge count for specific category
  async resetBadgeCount(userId: string, category?: BadgeCategory): Promise<void> {
    try {
      if (category) {
        // Reset specific category
        this.logger.debug('Resetting badge count category', { userId, category });
        await this.resetBadgeCountInDB(userId, category);
      } else {
        // Reset all categories
        this.logger.debug('Resetting all badge counts', { userId });
        await this.resetAllBadgeCountsInDB(userId);
      }

      // Invalidate cache
      await this.invalidateBadgeCache(userId);

      this.logger.info('Badge count reset', { userId, category });

    } catch (error) {
      this.logger.error('Failed to reset badge count', {
        userId,
        category,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Track notification delivery
  async trackDelivery(result: NotificationDeliveryResult): Promise<void> {
    try {
      this.logger.debug('Tracking notification delivery', {
        jobId: result.jobId,
        userId: result.userId,
        type: result.type,
        deviceCount: result.devices.length,
      });

      // Create delivery records
      const deliveryRecords: DeliveryTrackingRecord[] = result.devices.map(device => ({
        id: uuidv4(),
        jobId: result.jobId,
        userId: result.userId,
        notificationType: result.type,
        deviceToken: this.maskToken(device.deviceToken),
        status: device.status,
        error: device.error,
        messageId: undefined, // Could be extracted from APNs response
        sentAt: device.timestamp,
        processingTime: result.processingTime,
      }));

      // Store in database
      await this.storeDeliveryRecords(deliveryRecords);

      // Update analytics cache
      await this.updateDeliveryAnalytics(result);

      this.logger.debug('Notification delivery tracked', {
        jobId: result.jobId,
        recordCount: deliveryRecords.length,
      });

    } catch (error) {
      this.logger.error('Failed to track notification delivery', {
        jobId: result.jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Get delivery analytics
  async getDeliveryAnalytics(timeRange?: { start: Date; end: Date }): Promise<DeliveryAnalytics> {
    try {
      // TODO: Implement actual database queries
      const defaultAnalytics: DeliveryAnalytics = {
        totalNotifications: 0,
        successRate: 0,
        failureRate: 0,
        invalidTokenRate: 0,
        averageProcessingTime: 0,
        notificationsByType: {} as Record<NotificationType, number>,
        deliveriesByHour: {},
        recentFailures: [],
      };

      return defaultAnalytics;

    } catch (error) {
      this.logger.error('Failed to get delivery analytics', {
        timeRange,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        totalNotifications: 0,
        successRate: 0,
        failureRate: 0,
        invalidTokenRate: 0,
        averageProcessingTime: 0,
        notificationsByType: {} as Record<NotificationType, number>,
        deliveriesByHour: {},
        recentFailures: [],
      };
    }
  }

  // Get user delivery history
  async getUserDeliveryHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<DeliveryTrackingRecord[]> {
    try {
      // TODO: Implement actual database query
      // const records = await this.dbClient.query.deliveryTracking.findMany({
      //   where: eq(deliveryTracking.userId, userId),
      //   orderBy: desc(deliveryTracking.sentAt),
      //   limit,
      //   offset
      // });

      const records: DeliveryTrackingRecord[] = [];

      return records;

    } catch (error) {
      this.logger.error('Failed to get user delivery history', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  // Private helper methods

  private async getFriendRequestCount(userId: string): Promise<number> {
    try {
      // TODO: Implement actual database query
      // const count = await this.dbClient.query.friendRequests.findMany({
      //   where: and(
      //     eq(friendRequests.receiverId, userId),
      //     eq(friendRequests.status, 'pending')
      //   )
      // }).length;

      return 0;

    } catch (error) {
      this.logger.error('Failed to get friend request count', { userId, error });
      return 0;
    }
  }

  private async getUnreadNotificationCount(userId: string): Promise<number> {
    try {
      // TODO: Implement actual database query for unread notifications
      return 0;

    } catch (error) {
      this.logger.error('Failed to get unread notification count', { userId, error });
      return 0;
    }
  }

  private async getMissedActivityCount(userId: string): Promise<number> {
    try {
      // TODO: Implement actual database query for missed friend activity
      return 0;

    } catch (error) {
      this.logger.error('Failed to get missed activity count', { userId, error });
      return 0;
    }
  }

  private async incrementBadgeCountInDB(increment: BadgeIncrement): Promise<void> {
    try {
      // TODO: Implement actual database increment
      // Example:
      // const field = this.getCategoryField(increment.category);
      // await this.dbClient.query.execute(`
      //   INSERT INTO badge_counts (user_id, ${field})
      //   VALUES (?, ?)
      //   ON DUPLICATE KEY UPDATE ${field} = ${field} + ?
      // `, [increment.userId, increment.amount, increment.amount]);

    } catch (error) {
      this.logger.error('Failed to increment badge count in database', { increment, error });
      throw error;
    }
  }

  private async resetBadgeCountInDB(userId: string, category: BadgeCategory): Promise<void> {
    try {
      // TODO: Implement actual database reset
      // const field = this.getCategoryField(category);
      // await this.dbClient.update(badgeCounts)
      //   .set({ [field]: 0 })
      //   .where(eq(badgeCounts.userId, userId));

    } catch (error) {
      this.logger.error('Failed to reset badge count in database', { userId, category, error });
      throw error;
    }
  }

  private async resetAllBadgeCountsInDB(userId: string): Promise<void> {
    try {
      // TODO: Implement actual database reset
      // await this.dbClient.update(badgeCounts)
      //   .set({
      //     friendRequests: 0,
      //     unreadNotifications: 0,
      //     missedActivity: 0
      //   })
      //   .where(eq(badgeCounts.userId, userId));

    } catch (error) {
      this.logger.error('Failed to reset all badge counts in database', { userId, error });
      throw error;
    }
  }

  private async storeDeliveryRecords(records: DeliveryTrackingRecord[]): Promise<void> {
    try {
      // TODO: Implement actual database insert
      // await this.dbClient.insert(deliveryTracking).values(records);

    } catch (error) {
      this.logger.error('Failed to store delivery records', { recordCount: records.length, error });
    }
  }

  private async updateDeliveryAnalytics(result: NotificationDeliveryResult): Promise<void> {
    try {
      // Update analytics in Redis for real-time dashboards
      const key = 'delivery_analytics';
      const hour = new Date().getHours();

      await Promise.all([
        this.redisClient.hincrby(key, 'total_notifications', result.totalDevices),
        this.redisClient.hincrby(key, 'successful_deliveries', result.successCount),
        this.redisClient.hincrby(key, 'failed_deliveries', result.failureCount),
        this.redisClient.hincrby(key, 'invalid_tokens', result.invalidTokenCount),
        this.redisClient.hincrby(key, `hour_${hour}`, result.totalDevices),
        this.redisClient.hincrby(key, `type_${result.type}`, result.totalDevices),
      ]);

      // Set expiration for analytics data (7 days)
      await this.redisClient.expire(key, 7 * 24 * 60 * 60);

    } catch (error) {
      this.logger.error('Failed to update delivery analytics', { error });
    }
  }

  // Cache methods

  private async cacheBadgeCount(userId: string, count: number, ttlSeconds: number): Promise<void> {
    try {
      await this.redisClient.setex(`badge_count:${userId}`, ttlSeconds, count.toString());
    } catch (error) {
      this.logger.warn('Failed to cache badge count', { userId, error });
    }
  }

  private async getCachedBadgeCount(userId: string): Promise<number | null> {
    try {
      const cached = await this.redisClient.get(`badge_count:${userId}`);
      return cached ? parseInt(cached, 10) : null;
    } catch (error) {
      this.logger.warn('Failed to get cached badge count', { userId, error });
      return null;
    }
  }

  private async cacheBadgeCountBreakdown(
    userId: string,
    breakdown: BadgeCountRecord,
    ttlSeconds: number
  ): Promise<void> {
    try {
      await this.redisClient.setex(
        `badge_breakdown:${userId}`,
        ttlSeconds,
        JSON.stringify(breakdown)
      );
    } catch (error) {
      this.logger.warn('Failed to cache badge count breakdown', { userId, error });
    }
  }

  private async getCachedBadgeCountBreakdown(userId: string): Promise<BadgeCountRecord | null> {
    try {
      const cached = await this.redisClient.get(`badge_breakdown:${userId}`);
      if (!cached) return null;

      const parsed = JSON.parse(cached);
      return {
        ...parsed,
        lastUpdated: new Date(parsed.lastUpdated),
      };
    } catch (error) {
      this.logger.warn('Failed to get cached badge count breakdown', { userId, error });
      return null;
    }
  }

  private async invalidateBadgeCache(userId: string): Promise<void> {
    try {
      await Promise.all([
        this.redisClient.del(`badge_count:${userId}`),
        this.redisClient.del(`badge_breakdown:${userId}`),
      ]);
    } catch (error) {
      this.logger.warn('Failed to invalidate badge cache', { userId, error });
    }
  }

  // Utility methods

  private getCategoryField(category: BadgeCategory): string {
    switch (category) {
      case BadgeCategory.FRIEND_REQUESTS:
        return 'friend_requests';
      case BadgeCategory.UNREAD_NOTIFICATIONS:
        return 'unread_notifications';
      case BadgeCategory.MISSED_ACTIVITY:
        return 'missed_activity';
      default:
        return 'unread_notifications';
    }
  }

  private maskToken(token: string): string {
    if (token.length <= 8) return '***';
    return `${token.substring(0, 8)}...${token.substring(token.length - 4)}`;
  }
}