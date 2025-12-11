import { z } from 'zod';
import { NotificationType } from '../queue/index.js';

// Notification preference categories
export enum PreferenceCategory {
  FRIEND_REQUESTS = 'friend_requests',
  FRIEND_ACTIVITY = 'friend_activity',
  CONCERT_REMINDERS = 'concert_reminders',
  DISCOVERIES = 'discoveries',
  WEEKLY_DIGEST = 'weekly_digest',
  EMERGENCY = 'emergency',
}

// Quiet hours configuration
export const QuietHoursSchema = z.object({
  enabled: z.boolean().default(false),
  startHour: z.number().min(0).max(23).default(22),
  endHour: z.number().min(0).max(23).default(7),
  timezone: z.string().default('UTC'),
});

export type QuietHours = z.infer<typeof QuietHoursSchema>;

// Notification frequency settings
export enum NotificationFrequency {
  IMMEDIATE = 'immediate',
  BATCHED_HOURLY = 'batched_hourly',
  BATCHED_DAILY = 'batched_daily',
  DISABLED = 'disabled',
}

// Individual preference setting
export const PreferenceSettingSchema = z.object({
  category: z.nativeEnum(PreferenceCategory),
  enabled: z.boolean(),
  frequency: z.nativeEnum(NotificationFrequency).default(NotificationFrequency.IMMEDIATE),
  quietHoursRespected: z.boolean().default(true),
  soundEnabled: z.boolean().default(true),
  vibrationEnabled: z.boolean().default(true),
});

export type PreferenceSetting = z.infer<typeof PreferenceSettingSchema>;

// Complete user notification preferences
export const UserPreferencesSchema = z.object({
  userId: z.string().uuid(),
  enabled: z.boolean().default(true),
  preferences: z.array(PreferenceSettingSchema),
  quietHours: QuietHoursSchema,
  allowCritical: z.boolean().default(true),
  lastUpdated: z.date(),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

// Preference update request
export const PreferenceUpdateSchema = z.object({
  userId: z.string().uuid(),
  category: z.nativeEnum(PreferenceCategory).optional(),
  enabled: z.boolean().optional(),
  frequency: z.nativeEnum(NotificationFrequency).optional(),
  quietHours: QuietHoursSchema.partial().optional(),
  allowCritical: z.boolean().optional(),
  preferences: z.array(PreferenceSettingSchema).optional(),
});

export type PreferenceUpdate = z.infer<typeof PreferenceUpdateSchema>;

// Notification delivery check result
export interface DeliveryCheckResult {
  shouldDeliver: boolean;
  reason?: string;
  suggestedDelay?: number; // Minutes to delay if during quiet hours
  frequency: NotificationFrequency;
}

// Default preferences for new users
const DEFAULT_PREFERENCES: PreferenceSetting[] = [
  {
    category: PreferenceCategory.FRIEND_REQUESTS,
    enabled: true,
    frequency: NotificationFrequency.IMMEDIATE,
    quietHoursRespected: false, // Friend requests can interrupt quiet hours
    soundEnabled: true,
    vibrationEnabled: true,
  },
  {
    category: PreferenceCategory.FRIEND_ACTIVITY,
    enabled: true,
    frequency: NotificationFrequency.IMMEDIATE,
    quietHoursRespected: true,
    soundEnabled: true,
    vibrationEnabled: false,
  },
  {
    category: PreferenceCategory.CONCERT_REMINDERS,
    enabled: true,
    frequency: NotificationFrequency.IMMEDIATE,
    quietHoursRespected: false, // Concert reminders are time-sensitive
    soundEnabled: true,
    vibrationEnabled: true,
  },
  {
    category: PreferenceCategory.DISCOVERIES,
    enabled: true,
    frequency: NotificationFrequency.BATCHED_DAILY,
    quietHoursRespected: true,
    soundEnabled: false,
    vibrationEnabled: false,
  },
  {
    category: PreferenceCategory.WEEKLY_DIGEST,
    enabled: true,
    frequency: NotificationFrequency.IMMEDIATE,
    quietHoursRespected: true,
    soundEnabled: false,
    vibrationEnabled: false,
  },
  {
    category: PreferenceCategory.EMERGENCY,
    enabled: true,
    frequency: NotificationFrequency.IMMEDIATE,
    quietHoursRespected: false,
    soundEnabled: true,
    vibrationEnabled: true,
  },
];

// Notification preferences service
export class NotificationPreferencesService {
  private dbClient: any;
  private redisClient: any;
  private logger: any;

  constructor(dbClient: any, redisClient: any, logger: any) {
    this.dbClient = dbClient;
    this.redisClient = redisClient;
    this.logger = logger;
  }

  // Get user's notification preferences
  async getUserPreferences(userId: string): Promise<UserPreferences> {
    try {
      // Try cache first
      const cached = await this.getCachedPreferences(userId);
      if (cached) {
        return cached;
      }

      // Get from database
      const preferences = await this.getPreferencesFromDB(userId);

      // Cache the result
      await this.cachePreferences(preferences, 300); // Cache for 5 minutes

      return preferences;

    } catch (error) {
      this.logger.error('Failed to get user preferences', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Return safe defaults
      return this.getDefaultPreferences(userId);
    }
  }

  // Update user's notification preferences
  async updateUserPreferences(update: PreferenceUpdate): Promise<UserPreferences> {
    PreferenceUpdateSchema.parse(update);

    try {
      this.logger.info('Updating notification preferences', {
        userId: update.userId,
        updates: Object.keys(update).filter(key => key !== 'userId' && update[key as keyof PreferenceUpdate] !== undefined),
      });

      // Get current preferences
      const currentPreferences = await this.getUserPreferences(update.userId);

      // Apply updates
      const updatedPreferences: UserPreferences = {
        ...currentPreferences,
        lastUpdated: new Date(),
      };

      if (update.enabled !== undefined) {
        updatedPreferences.enabled = update.enabled;
      }

      if (update.allowCritical !== undefined) {
        updatedPreferences.allowCritical = update.allowCritical;
      }

      if (update.quietHours) {
        updatedPreferences.quietHours = {
          ...updatedPreferences.quietHours,
          ...update.quietHours,
        };
      }

      if (update.preferences) {
        updatedPreferences.preferences = update.preferences;
      } else if (update.category && (update.enabled !== undefined || update.frequency !== undefined)) {
        // Update specific category
        const categoryIndex = updatedPreferences.preferences.findIndex(
          pref => pref.category === update.category
        );

        if (categoryIndex >= 0) {
          const categoryPref = { ...updatedPreferences.preferences[categoryIndex] };

          if (update.enabled !== undefined) {
            categoryPref.enabled = update.enabled;
          }

          if (update.frequency !== undefined) {
            categoryPref.frequency = update.frequency;
          }

          updatedPreferences.preferences[categoryIndex] = categoryPref;
        }
      }

      // Validate updated preferences
      UserPreferencesSchema.parse(updatedPreferences);

      // Save to database
      await this.savePreferencesToDB(updatedPreferences);

      // Invalidate cache
      await this.invalidatePreferencesCache(update.userId);

      this.logger.info('Notification preferences updated', {
        userId: update.userId,
      });

      return updatedPreferences;

    } catch (error) {
      this.logger.error('Failed to update user preferences', {
        userId: update.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Check if notification should be delivered based on preferences
  async shouldDeliverNotification(
    userId: string,
    notificationType: NotificationType,
    currentTime?: Date
  ): Promise<DeliveryCheckResult> {
    try {
      const preferences = await this.getUserPreferences(userId);
      const now = currentTime || new Date();

      // Check if notifications are globally disabled
      if (!preferences.enabled) {
        return {
          shouldDeliver: false,
          reason: 'Notifications disabled by user',
          frequency: NotificationFrequency.DISABLED,
        };
      }

      // Get category for this notification type
      const category = this.mapNotificationTypeToCategory(notificationType);
      const categoryPreference = preferences.preferences.find(pref => pref.category === category);

      if (!categoryPreference) {
        this.logger.warn('No preference found for notification category', {
          userId,
          notificationType,
          category,
        });
        return {
          shouldDeliver: true,
          frequency: NotificationFrequency.IMMEDIATE,
        };
      }

      // Check if category is disabled
      if (!categoryPreference.enabled) {
        return {
          shouldDeliver: false,
          reason: `${category} notifications disabled`,
          frequency: categoryPreference.frequency,
        };
      }

      // Check frequency setting
      if (categoryPreference.frequency === NotificationFrequency.DISABLED) {
        return {
          shouldDeliver: false,
          reason: 'Frequency set to disabled',
          frequency: categoryPreference.frequency,
        };
      }

      // Check quiet hours (only if category respects them)
      if (categoryPreference.quietHoursRespected && preferences.quietHours.enabled) {
        const quietHoursCheck = this.isInQuietHours(now, preferences.quietHours);
        if (quietHoursCheck.inQuietHours) {
          // Check if this is a critical notification that can override quiet hours
          const isCritical = this.isNotificationCritical(notificationType);
          if (isCritical && preferences.allowCritical) {
            return {
              shouldDeliver: true,
              reason: 'Critical notification overriding quiet hours',
              frequency: categoryPreference.frequency,
            };
          }

          return {
            shouldDeliver: false,
            reason: 'In quiet hours',
            suggestedDelay: quietHoursCheck.minutesUntilEnd,
            frequency: categoryPreference.frequency,
          };
        }
      }

      // Check frequency-based delivery
      if (categoryPreference.frequency !== NotificationFrequency.IMMEDIATE) {
        return {
          shouldDeliver: false,
          reason: `Batched delivery (${categoryPreference.frequency})`,
          frequency: categoryPreference.frequency,
        };
      }

      // All checks passed
      return {
        shouldDeliver: true,
        frequency: categoryPreference.frequency,
      };

    } catch (error) {
      this.logger.error('Failed to check delivery preferences', {
        userId,
        notificationType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Default to allow delivery on error
      return {
        shouldDeliver: true,
        frequency: NotificationFrequency.IMMEDIATE,
      };
    }
  }

  // Get users who should receive batched notifications
  async getUsersForBatchedDelivery(
    frequency: NotificationFrequency.BATCHED_HOURLY | NotificationFrequency.BATCHED_DAILY,
    category: PreferenceCategory
  ): Promise<string[]> {
    try {
      // TODO: Implement database query to find users with batched preferences
      // Example:
      // const users = await this.dbClient.query.notificationPreferences.findMany({
      //   where: and(
      //     eq(preferences.category, category),
      //     eq(preferences.frequency, frequency),
      //     eq(preferences.enabled, true)
      //   ),
      //   columns: { userId: true }
      // });

      return [];

    } catch (error) {
      this.logger.error('Failed to get users for batched delivery', {
        frequency,
        category,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  // Private helper methods

  private async getPreferencesFromDB(userId: string): Promise<UserPreferences> {
    try {
      // TODO: Implement actual database query
      // const dbPreferences = await this.dbClient.query.userNotificationPreferences.findFirst({
      //   where: eq(userNotificationPreferences.userId, userId)
      // });

      // If no preferences found, return defaults
      return this.getDefaultPreferences(userId);

    } catch (error) {
      this.logger.error('Failed to get preferences from database', { userId, error });
      return this.getDefaultPreferences(userId);
    }
  }

  private async savePreferencesToDB(preferences: UserPreferences): Promise<void> {
    try {
      // TODO: Implement actual database upsert
      // await this.dbClient.insert(userNotificationPreferences)
      //   .values(preferences)
      //   .onDuplicateKeyUpdate({ ...preferences, lastUpdated: new Date() });

    } catch (error) {
      this.logger.error('Failed to save preferences to database', {
        userId: preferences.userId,
        error,
      });
      throw error;
    }
  }

  private getDefaultPreferences(userId: string): UserPreferences {
    return {
      userId,
      enabled: true,
      preferences: [...DEFAULT_PREFERENCES],
      quietHours: {
        enabled: false,
        startHour: 22,
        endHour: 7,
        timezone: 'UTC',
      },
      allowCritical: true,
      lastUpdated: new Date(),
    };
  }

  private mapNotificationTypeToCategory(type: NotificationType): PreferenceCategory {
    switch (type) {
      case NotificationType.FRIEND_REQUEST_RECEIVED:
      case NotificationType.FRIEND_REQUEST_ACCEPTED:
        return PreferenceCategory.FRIEND_REQUESTS;

      case NotificationType.FRIEND_ATTENDED_CONCERT:
        return PreferenceCategory.FRIEND_ACTIVITY;

      case NotificationType.CONCERT_REMINDER:
        return PreferenceCategory.CONCERT_REMINDERS;

      case NotificationType.NEW_CONCERTS_NEARBY:
        return PreferenceCategory.DISCOVERIES;

      case NotificationType.WEEKLY_DIGEST:
        return PreferenceCategory.WEEKLY_DIGEST;

      default:
        return PreferenceCategory.FRIEND_ACTIVITY;
    }
  }

  private isNotificationCritical(type: NotificationType): boolean {
    switch (type) {
      case NotificationType.FRIEND_REQUEST_RECEIVED:
      case NotificationType.CONCERT_REMINDER:
        return true;
      default:
        return false;
    }
  }

  private isInQuietHours(currentTime: Date, quietHours: QuietHours): {
    inQuietHours: boolean;
    minutesUntilEnd?: number;
  } {
    if (!quietHours.enabled) {
      return { inQuietHours: false };
    }

    const hour = currentTime.getHours();
    const { startHour, endHour } = quietHours;

    let inQuietHours = false;
    let minutesUntilEnd = 0;

    if (startHour <= endHour) {
      // Same day quiet hours (e.g., 22:00 - 07:00 next day)
      inQuietHours = hour >= startHour || hour < endHour;
      if (inQuietHours) {
        if (hour >= startHour) {
          // Currently after start time
          minutesUntilEnd = (24 - hour + endHour) * 60 - currentTime.getMinutes();
        } else {
          // Currently before end time
          minutesUntilEnd = (endHour - hour) * 60 - currentTime.getMinutes();
        }
      }
    } else {
      // Cross-day quiet hours (e.g., 10:00 - 16:00)
      inQuietHours = hour >= startHour && hour < endHour;
      if (inQuietHours) {
        minutesUntilEnd = (endHour - hour) * 60 - currentTime.getMinutes();
      }
    }

    return { inQuietHours, minutesUntilEnd: Math.max(0, minutesUntilEnd) };
  }

  // Cache methods

  private async getCachedPreferences(userId: string): Promise<UserPreferences | null> {
    try {
      const cached = await this.redisClient.get(`prefs:${userId}`);
      if (!cached) return null;

      const parsed = JSON.parse(cached);
      return {
        ...parsed,
        lastUpdated: new Date(parsed.lastUpdated),
      };
    } catch (error) {
      this.logger.warn('Failed to get cached preferences', { userId, error });
      return null;
    }
  }

  private async cachePreferences(preferences: UserPreferences, ttlSeconds: number): Promise<void> {
    try {
      await this.redisClient.setex(
        `prefs:${preferences.userId}`,
        ttlSeconds,
        JSON.stringify(preferences)
      );
    } catch (error) {
      this.logger.warn('Failed to cache preferences', { userId: preferences.userId, error });
    }
  }

  private async invalidatePreferencesCache(userId: string): Promise<void> {
    try {
      await this.redisClient.del(`prefs:${userId}`);
    } catch (error) {
      this.logger.warn('Failed to invalidate preferences cache', { userId, error });
    }
  }
}