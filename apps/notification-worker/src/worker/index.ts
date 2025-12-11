import { Worker, Job } from 'bullmq';
import {
  NotificationType,
  NOTIFICATION_QUEUE_NAME,
  type NotificationJobData,
  type NotificationDeliveryResult,
  redisConnection,
  validateNotificationData,
} from '../queue/index.js';
import { ApnsProvider, type BatchPushResult } from '../apns/provider.js';
import { NotificationBuilderFactory } from '../notifications/builders.js';

// Device token interface (placeholder - will be from database)
interface UserDevice {
  id: string;
  userId: string;
  token: string;
  platform: 'ios' | 'android';
  active: boolean;
  createdAt: Date;
  lastUsed: Date;
}

// User preferences interface (placeholder - will be from database)
interface NotificationPreferences {
  userId: string;
  friendRequests: boolean;
  friendActivity: boolean;
  concertReminders: boolean;
  discoveries: boolean;
  weeklyDigest: boolean;
  enabled: boolean;
}

// Job statistics interface
interface JobStats {
  notificationsProcessed: number;
  devicesNotified: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  invalidTokens: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

// Notification worker class
export class NotificationWorker {
  private worker: Worker;
  private apnsProvider: ApnsProvider;
  private notificationBuilder: NotificationBuilderFactory;
  private logger: any;
  private dbClient: any; // Database client (placeholder)
  private isShuttingDown = false;

  constructor(
    apnsProvider: ApnsProvider,
    dbClient: any,
    redisConnection: any,
    logger: any
  ) {
    this.apnsProvider = apnsProvider;
    this.dbClient = dbClient;
    this.logger = logger;

    // Initialize notification builder factory
    this.notificationBuilder = new NotificationBuilderFactory(apnsProvider, logger);

    // Create BullMQ worker
    this.worker = new Worker(NOTIFICATION_QUEUE_NAME, this.processJob.bind(this), {
      connection: redisConnection,
      concurrency: 5, // Process 5 notifications concurrently
    });

    // Worker event handlers
    this.setupEventHandlers();
  }

  // Setup worker event handlers
  private setupEventHandlers(): void {
    this.worker.on('ready', () => {
      this.logger.info('Notification worker is ready and waiting for jobs');
    });

    this.worker.on('active', (job: Job) => {
      this.logger.info(`Processing notification job ${job.id}`, {
        jobName: job.name,
        userId: job.data.userId,
        type: job.data.type,
      });
    });

    this.worker.on('completed', (job: Job, result: NotificationDeliveryResult) => {
      this.logger.info(`Notification job ${job.id} completed`, {
        jobName: job.name,
        userId: result.userId,
        type: result.type,
        successCount: result.successCount,
        failureCount: result.failureCount,
        invalidTokenCount: result.invalidTokenCount,
        processingTime: result.processingTime,
      });
    });

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      this.logger.error(`Notification job ${job?.id || 'unknown'} failed`, {
        jobName: job?.name,
        userId: job?.data?.userId,
        type: job?.data?.type,
        error: error.message,
        stack: error.stack,
      });
    });

    this.worker.on('error', (error: Error) => {
      this.logger.error('Notification worker error', {
        error: error.message,
        stack: error.stack,
      });
    });

    this.worker.on('stalled', (jobId: string) => {
      this.logger.warn(`Notification job ${jobId} stalled`);
    });
  }

  // Main job processing function
  private async processJob(job: Job<NotificationJobData>): Promise<NotificationDeliveryResult> {
    const startTime = Date.now();
    const { type, userId, data } = job.data;

    this.logger.info(`Processing notification job`, {
      jobId: job.id,
      type,
      userId,
    });

    if (this.isShuttingDown) {
      throw new Error('Worker is shutting down');
    }

    try {
      // Validate notification data
      const validator = validateNotificationData[type];
      if (!validator) {
        throw new Error(`No validator found for notification type: ${type}`);
      }

      validator(data);

      // Check notification preferences
      const preferences = await this.getNotificationPreferences(userId);
      if (!this.shouldSendNotification(type, preferences)) {
        this.logger.info(`Notification skipped due to user preferences`, {
          jobId: job.id,
          userId,
          type,
        });

        return {
          jobId: job.id!,
          userId,
          type,
          devices: [],
          totalDevices: 0,
          successCount: 0,
          failureCount: 0,
          invalidTokenCount: 0,
          processingTime: Date.now() - startTime,
        };
      }

      // Get user's device tokens
      const devices = await this.getUserDevices(userId);

      if (devices.length === 0) {
        this.logger.info(`No devices found for user`, {
          jobId: job.id,
          userId,
          type,
        });

        return {
          jobId: job.id!,
          userId,
          type,
          devices: [],
          totalDevices: 0,
          successCount: 0,
          failureCount: 0,
          invalidTokenCount: 0,
          processingTime: Date.now() - startTime,
        };
      }

      // Get user's current badge count
      const badgeCount = await this.getBadgeCount(userId);

      // Build notification
      const notification = this.notificationBuilder.buildNotification(type, data, badgeCount);
      if (!notification) {
        throw new Error(`Failed to build notification for type: ${type}`);
      }

      // Send notification to devices
      const deviceTokens = devices.map(device => device.token);
      const batchResult = await this.apnsProvider.sendBatchNotifications(deviceTokens, notification);

      // Handle invalid tokens
      await this.handleInvalidTokens(batchResult);

      // Create delivery result
      const deliveryResult: NotificationDeliveryResult = {
        jobId: job.id!,
        userId,
        type,
        devices: devices.map(device => {
          const result = batchResult.results.find(r => r.deviceToken === device.token);
          return {
            deviceToken: device.token,
            status: result?.status || 'failed',
            error: result?.error,
            timestamp: new Date(),
          };
        }),
        totalDevices: devices.length,
        successCount: batchResult.successCount,
        failureCount: batchResult.failureCount,
        invalidTokenCount: batchResult.invalidTokenCount,
        processingTime: Date.now() - startTime,
      };

      // Log delivery tracking
      await this.logDelivery(deliveryResult);

      return deliveryResult;

    } catch (error) {
      this.logger.error(`Failed to process notification job`, {
        jobId: job.id,
        userId,
        type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  // Check if notification should be sent based on user preferences
  private shouldSendNotification(
    type: NotificationType,
    preferences: NotificationPreferences
  ): boolean {
    if (!preferences.enabled) {
      return false;
    }

    switch (type) {
      case NotificationType.FRIEND_REQUEST_RECEIVED:
      case NotificationType.FRIEND_REQUEST_ACCEPTED:
        return preferences.friendRequests;

      case NotificationType.FRIEND_ATTENDED_CONCERT:
        return preferences.friendActivity;

      case NotificationType.CONCERT_REMINDER:
        return preferences.concertReminders;

      case NotificationType.NEW_CONCERTS_NEARBY:
        return preferences.discoveries;

      case NotificationType.WEEKLY_DIGEST:
        return preferences.weeklyDigest;

      default:
        return true; // Send by default for unknown types
    }
  }

  // Get user's device tokens from database (placeholder implementation)
  private async getUserDevices(userId: string): Promise<UserDevice[]> {
    try {
      // TODO: Replace with actual database query
      // Example query:
      // const devices = await this.dbClient.query.userDevices.findMany({
      //   where: and(
      //     eq(userDevices.userId, userId),
      //     eq(userDevices.platform, 'ios'),
      //     eq(userDevices.active, true)
      //   )
      // });

      // Placeholder implementation
      const devices: UserDevice[] = [];

      this.logger.debug(`Retrieved ${devices.length} devices for user ${userId}`);
      return devices;

    } catch (error) {
      this.logger.error('Error retrieving user devices', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  // Get user's notification preferences from database (placeholder implementation)
  private async getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
    try {
      // TODO: Replace with actual database query
      // Example query:
      // const prefs = await this.dbClient.query.notificationPreferences.findFirst({
      //   where: eq(notificationPreferences.userId, userId)
      // });

      // Placeholder implementation - default to all enabled
      const defaultPreferences: NotificationPreferences = {
        userId,
        friendRequests: true,
        friendActivity: true,
        concertReminders: true,
        discoveries: true,
        weeklyDigest: true,
        enabled: true,
      };

      this.logger.debug(`Retrieved notification preferences for user ${userId}`, defaultPreferences);
      return defaultPreferences;

    } catch (error) {
      this.logger.error('Error retrieving notification preferences', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Return safe defaults on error
      return {
        userId,
        friendRequests: true,
        friendActivity: true,
        concertReminders: true,
        discoveries: false,
        weeklyDigest: false,
        enabled: true,
      };
    }
  }

  // Get user's current badge count (placeholder implementation)
  private async getBadgeCount(userId: string): Promise<number> {
    try {
      // TODO: Replace with actual database query
      // This should count unread notifications, messages, friend requests, etc.

      // Placeholder implementation
      return 1; // Always show at least 1 for now

    } catch (error) {
      this.logger.error('Error retrieving badge count', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  // Handle invalid device tokens by removing them from database
  private async handleInvalidTokens(batchResult: BatchPushResult): Promise<void> {
    const invalidTokens = batchResult.results
      .filter(result => result.status === 'invalid_token')
      .map(result => result.deviceToken);

    if (invalidTokens.length === 0) {
      return;
    }

    this.logger.info(`Cleaning up ${invalidTokens.length} invalid device tokens`);

    try {
      // TODO: Replace with actual database update
      // Example query:
      // await this.dbClient.update(userDevices)
      //   .set({ active: false, updatedAt: new Date() })
      //   .where(inArray(userDevices.token, invalidTokens));

      this.logger.info(`Marked ${invalidTokens.length} device tokens as inactive`);

    } catch (error) {
      this.logger.error('Error cleaning up invalid device tokens', {
        invalidTokenCount: invalidTokens.length,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Log notification delivery for tracking and analytics
  private async logDelivery(result: NotificationDeliveryResult): Promise<void> {
    try {
      // TODO: Store delivery results in database or analytics system
      // This could be useful for:
      // - Delivery rate monitoring
      // - User engagement analytics
      // - Debugging notification issues

      this.logger.info('Notification delivery logged', {
        jobId: result.jobId,
        userId: result.userId,
        type: result.type,
        totalDevices: result.totalDevices,
        successCount: result.successCount,
        failureCount: result.failureCount,
        invalidTokenCount: result.invalidTokenCount,
        processingTime: result.processingTime,
      });

    } catch (error) {
      this.logger.warn('Error logging notification delivery', {
        jobId: result.jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Rate limiting check (placeholder implementation)
  private async checkRateLimit(userId: string, type: NotificationType): Promise<boolean> {
    try {
      // TODO: Implement rate limiting logic
      // Examples:
      // - Max 10 notifications per hour per user
      // - Max 1 friend request notification per minute
      // - Max 1 weekly digest per week

      return true; // Allow all for now

    } catch (error) {
      this.logger.error('Error checking rate limit', {
        userId,
        type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false; // Deny on error to be safe
    }
  }

  // Get worker statistics
  getStats() {
    return {
      isRunning: !this.worker.closing,
      concurrency: this.worker.concurrency,
      isShuttingDown: this.isShuttingDown,
      supportedNotificationTypes: this.notificationBuilder.getSupportedTypes(),
    };
  }

  // Health check
  async isHealthy(): Promise<boolean> {
    try {
      // Check worker status
      if (this.worker.closing || this.isShuttingDown) {
        return false;
      }

      // Check APNs provider
      const apnsHealthy = await this.apnsProvider.isHealthy();
      if (!apnsHealthy) {
        return false;
      }

      // Check Redis connection
      await redisConnection.ping();

      return true;

    } catch (error) {
      this.logger.warn('Notification worker health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('Shutting down notification worker...');

    try {
      // Close the worker (waits for current jobs to complete)
      await this.worker.close();
      this.logger.info('Notification worker closed');

      // Shutdown APNs provider
      await this.apnsProvider.shutdown();
      this.logger.info('APNs provider shutdown');

    } catch (error) {
      this.logger.error('Error during notification worker shutdown', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    this.logger.info('Notification worker shutdown complete');
  }
}