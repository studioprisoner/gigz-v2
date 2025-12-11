import apn from '@parse/node-apn';
import { z } from 'zod';

// APNs configuration schema
export const ApnsConfigSchema = z.object({
  keyPath: z.string().describe('Path to APNs auth key (.p8 file)'),
  keyId: z.string().describe('APNs key ID'),
  teamId: z.string().describe('Apple Developer Team ID'),
  topic: z.string().describe('App bundle identifier'),
  production: z.boolean().default(false).describe('Use production APNs servers'),
});

export type ApnsConfig = z.infer<typeof ApnsConfigSchema>;

// Push notification result interface
export interface PushResult {
  deviceToken: string;
  status: 'sent' | 'failed' | 'invalid_token';
  error?: string;
  messageId?: string;
}

// Batch push result interface
export interface BatchPushResult {
  totalDevices: number;
  successCount: number;
  failureCount: number;
  invalidTokenCount: number;
  results: PushResult[];
  processingTime: number;
}

// APNs provider wrapper
export class ApnsProvider {
  private provider: apn.Provider;
  private config: ApnsConfig;
  private logger: any;
  private isShuttingDown = false;

  constructor(config: ApnsConfig, logger: any) {
    this.config = ApnsConfigSchema.parse(config);
    this.logger = logger;

    // Initialize APNs provider
    this.provider = new apn.Provider({
      token: {
        key: this.config.keyPath,
        keyId: this.config.keyId,
        teamId: this.config.teamId,
      },
      production: this.config.production,
    });

    // Log configuration (without sensitive data)
    this.logger.info('APNs provider initialized', {
      keyId: this.config.keyId,
      teamId: this.config.teamId,
      topic: this.config.topic,
      production: this.config.production,
    });
  }

  // Send notification to a single device
  async sendNotification(
    deviceToken: string,
    notification: apn.Notification
  ): Promise<PushResult> {
    if (this.isShuttingDown) {
      return {
        deviceToken,
        status: 'failed',
        error: 'Provider is shutting down',
      };
    }

    try {
      this.logger.debug('Sending push notification', {
        deviceToken: this.maskDeviceToken(deviceToken),
        topic: notification.topic,
        alert: notification.alert,
      });

      const result = await this.provider.send(notification, deviceToken);

      // Check for failures
      if (result.failed.length > 0) {
        const failure = result.failed[0];
        const isInvalidToken = failure.response?.reason === 'BadDeviceToken' ||
                              failure.response?.reason === 'Unregistered' ||
                              failure.response?.reason === 'InvalidProviderToken';

        this.logger.warn('Push notification failed', {
          deviceToken: this.maskDeviceToken(deviceToken),
          reason: failure.response?.reason,
          status: failure.status,
          isInvalidToken,
        });

        return {
          deviceToken,
          status: isInvalidToken ? 'invalid_token' : 'failed',
          error: failure.response?.reason || 'Unknown error',
        };
      }

      // Check for successful sends
      if (result.sent.length > 0) {
        const sent = result.sent[0];

        this.logger.debug('Push notification sent successfully', {
          deviceToken: this.maskDeviceToken(deviceToken),
          messageId: sent.messageId,
        });

        return {
          deviceToken,
          status: 'sent',
          messageId: sent.messageId,
        };
      }

      // No result (shouldn't happen)
      return {
        deviceToken,
        status: 'failed',
        error: 'No result from APNs',
      };

    } catch (error) {
      this.logger.error('Error sending push notification', {
        deviceToken: this.maskDeviceToken(deviceToken),
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        deviceToken,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Send notification to multiple devices (batch)
  async sendBatchNotifications(
    deviceTokens: string[],
    notification: apn.Notification
  ): Promise<BatchPushResult> {
    const startTime = Date.now();

    this.logger.info('Sending batch push notifications', {
      deviceCount: deviceTokens.length,
      topic: notification.topic,
      alert: notification.alert,
    });

    if (this.isShuttingDown) {
      return {
        totalDevices: deviceTokens.length,
        successCount: 0,
        failureCount: deviceTokens.length,
        invalidTokenCount: 0,
        results: deviceTokens.map(token => ({
          deviceToken: token,
          status: 'failed' as const,
          error: 'Provider is shutting down',
        })),
        processingTime: Date.now() - startTime,
      };
    }

    try {
      // Send to all devices
      const result = await this.provider.send(notification, deviceTokens);

      const results: PushResult[] = [];
      let successCount = 0;
      let failureCount = 0;
      let invalidTokenCount = 0;

      // Process successful sends
      for (const sent of result.sent) {
        results.push({
          deviceToken: sent.device,
          status: 'sent',
          messageId: sent.messageId,
        });
        successCount++;
      }

      // Process failures
      for (const failure of result.failed) {
        const isInvalidToken = failure.response?.reason === 'BadDeviceToken' ||
                              failure.response?.reason === 'Unregistered' ||
                              failure.response?.reason === 'InvalidProviderToken';

        results.push({
          deviceToken: failure.device,
          status: isInvalidToken ? 'invalid_token' : 'failed',
          error: failure.response?.reason || 'Unknown error',
        });

        if (isInvalidToken) {
          invalidTokenCount++;
        } else {
          failureCount++;
        }
      }

      const processingTime = Date.now() - startTime;

      this.logger.info('Batch push notifications completed', {
        totalDevices: deviceTokens.length,
        successCount,
        failureCount,
        invalidTokenCount,
        processingTime,
      });

      return {
        totalDevices: deviceTokens.length,
        successCount,
        failureCount,
        invalidTokenCount,
        results,
        processingTime,
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;

      this.logger.error('Error sending batch push notifications', {
        deviceCount: deviceTokens.length,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime,
      });

      return {
        totalDevices: deviceTokens.length,
        successCount: 0,
        failureCount: deviceTokens.length,
        invalidTokenCount: 0,
        results: deviceTokens.map(token => ({
          deviceToken: token,
          status: 'failed' as const,
          error: error instanceof Error ? error.message : 'Unknown error',
        })),
        processingTime,
      };
    }
  }

  // Create a notification object
  createNotification(options: {
    alert: string | { title?: string; body: string; subtitle?: string };
    badge?: number;
    sound?: string;
    payload?: Record<string, any>;
    category?: string;
    threadId?: string;
    expiry?: Date;
    priority?: number;
  }): apn.Notification {
    const notification = new apn.Notification();

    // Set topic (required)
    notification.topic = this.config.topic;

    // Set alert
    if (typeof options.alert === 'string') {
      notification.alert = options.alert;
    } else {
      notification.alert = {
        title: options.alert.title,
        body: options.alert.body,
        subtitle: options.alert.subtitle,
      };
    }

    // Set other properties
    if (options.badge !== undefined) {
      notification.badge = options.badge;
    }

    if (options.sound !== undefined) {
      notification.sound = options.sound;
    } else {
      notification.sound = 'default'; // Default sound
    }

    if (options.payload) {
      notification.payload = options.payload;
    }

    if (options.category) {
      notification.category = options.category;
    }

    if (options.threadId) {
      notification.threadId = options.threadId;
    }

    if (options.expiry) {
      notification.expiry = Math.floor(options.expiry.getTime() / 1000);
    }

    if (options.priority) {
      notification.priority = options.priority;
    }

    return notification;
  }

  // Helper method to create silent notification (badge only)
  createSilentNotification(badge: number, payload?: Record<string, any>): apn.Notification {
    const notification = new apn.Notification();
    notification.topic = this.config.topic;
    notification.badge = badge;
    notification.contentAvailable = true;

    if (payload) {
      notification.payload = payload;
    }

    return notification;
  }

  // Get provider statistics
  getStats() {
    return {
      topic: this.config.topic,
      production: this.config.production,
      isShuttingDown: this.isShuttingDown,
    };
  }

  // Check if provider is healthy
  async isHealthy(): Promise<boolean> {
    try {
      // Create a test notification (won't be sent)
      const testNotification = this.createNotification({
        alert: 'Test',
        badge: 0,
      });

      // If we can create a notification, provider is healthy
      return !this.isShuttingDown && !!testNotification;
    } catch (error) {
      this.logger.warn('APNs provider health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // Mask device token for logging (show first 8 and last 4 characters)
  private maskDeviceToken(token: string): string {
    if (token.length <= 12) return '***';
    return `${token.substring(0, 8)}...${token.substring(token.length - 4)}`;
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('Shutting down APNs provider...');

    try {
      await this.provider.shutdown();
      this.logger.info('APNs provider shutdown completed');
    } catch (error) {
      this.logger.error('Error during APNs provider shutdown', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

// Factory function to create APNs provider from environment
export function createApnsProvider(logger: any): ApnsProvider {
  const config: ApnsConfig = {
    keyPath: process.env.APNS_KEY_PATH || '',
    keyId: process.env.APNS_KEY_ID || '',
    teamId: process.env.APNS_TEAM_ID || '',
    topic: process.env.APNS_TOPIC || 'app.gigz.ios',
    production: process.env.NODE_ENV === 'production',
  };

  return new ApnsProvider(config, logger);
}