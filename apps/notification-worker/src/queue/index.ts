import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { z } from 'zod';

// Redis connection configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
};

export const redisConnection = new Redis(redisConfig);

// Notification types
export enum NotificationType {
  FRIEND_REQUEST_RECEIVED = 'friend_request_received',
  FRIEND_REQUEST_ACCEPTED = 'friend_request_accepted',
  FRIEND_ATTENDED_CONCERT = 'friend_attended_concert',
  CONCERT_REMINDER = 'concert_reminder',
  NEW_CONCERTS_NEARBY = 'new_concerts_nearby',
  WEEKLY_DIGEST = 'weekly_digest',
}

// Job data schemas
export const NotificationJobDataSchema = z.object({
  type: z.nativeEnum(NotificationType),
  userId: z.string().uuid(),
  data: z.record(z.any()),
  scheduledFor: z.date().optional(),
  priority: z.number().min(0).max(10).default(5),
  retryCount: z.number().default(3),
});

export type NotificationJobData = z.infer<typeof NotificationJobDataSchema>;

// Specific notification data schemas
export const FriendRequestReceivedDataSchema = z.object({
  requesterId: z.string().uuid(),
  requesterName: z.string(),
  requesterUsername: z.string(),
  requesterAvatarUrl: z.string().optional(),
});

export const FriendRequestAcceptedDataSchema = z.object({
  accepterId: z.string().uuid(),
  accepterName: z.string(),
  accepterUsername: z.string(),
  accepterAvatarUrl: z.string().optional(),
});

export const FriendAttendedConcertDataSchema = z.object({
  friendId: z.string().uuid(),
  friendName: z.string(),
  friendUsername: z.string(),
  attendanceId: z.string().uuid(),
  artistName: z.string(),
  venueName: z.string(),
  venueCity: z.string(),
  concertDate: z.string(),
});

export const ConcertReminderDataSchema = z.object({
  concertId: z.string().uuid(),
  artistName: z.string(),
  venueName: z.string(),
  venueCity: z.string(),
  concertDate: z.string(),
  concertTime: z.string().optional(),
  hoursUntil: z.number(),
});

export const NewConcertsNearbyDataSchema = z.object({
  concertCount: z.number(),
  location: z.string(),
  dateRange: z.object({
    start: z.string(),
    end: z.string(),
  }),
  topArtists: z.array(z.string()).max(3),
});

export const WeeklyDigestDataSchema = z.object({
  friendsActivityCount: z.number(),
  newConcertsCount: z.number(),
  upcomingConcertsCount: z.number(),
  highlightedFriend: z.object({
    name: z.string(),
    activityCount: z.number(),
  }).optional(),
  highlightedConcert: z.object({
    artistName: z.string(),
    venueName: z.string(),
    date: z.string(),
  }).optional(),
});

export type FriendRequestReceivedData = z.infer<typeof FriendRequestReceivedDataSchema>;
export type FriendRequestAcceptedData = z.infer<typeof FriendRequestAcceptedDataSchema>;
export type FriendAttendedConcertData = z.infer<typeof FriendAttendedConcertDataSchema>;
export type ConcertReminderData = z.infer<typeof ConcertReminderDataSchema>;
export type NewConcertsNearbyData = z.infer<typeof NewConcertsNearbyDataSchema>;
export type WeeklyDigestData = z.infer<typeof WeeklyDigestDataSchema>;

// Queue configuration
export const NOTIFICATION_QUEUE_NAME = 'notifications';

export const queueConfig = {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 100,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
};

// Create the main notification queue
export const notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, queueConfig);

// Delivery status tracking
export interface NotificationDeliveryResult {
  jobId: string;
  userId: string;
  type: NotificationType;
  devices: Array<{
    deviceToken: string;
    status: 'sent' | 'failed' | 'invalid_token';
    error?: string;
    timestamp: Date;
  }>;
  totalDevices: number;
  successCount: number;
  failureCount: number;
  invalidTokenCount: number;
  processingTime: number;
}

// Queue manager for notifications
export class NotificationQueueManager {
  private queue: Queue;
  private workers: Map<string, Worker> = new Map();

  constructor() {
    this.queue = notificationQueue;
  }

  // Add notification job
  async addNotification(
    type: NotificationType,
    userId: string,
    data: Record<string, any>,
    options?: {
      scheduledFor?: Date;
      priority?: number;
      delay?: number;
    }
  ): Promise<Job> {
    // Validate job data
    const jobData: NotificationJobData = {
      type,
      userId,
      data,
      scheduledFor: options?.scheduledFor,
      priority: options?.priority || 5,
      retryCount: 3,
    };

    NotificationJobDataSchema.parse(jobData);

    const jobOptions: any = {
      priority: jobData.priority,
      delay: options?.delay,
      jobId: this.generateJobId(jobData),
    };

    // Add scheduled job
    if (options?.scheduledFor) {
      const delay = options.scheduledFor.getTime() - Date.now();
      if (delay > 0) {
        jobOptions.delay = delay;
      }
    }

    return this.queue.add(`${type}-${userId}`, jobData, jobOptions);
  }

  // Convenience methods for specific notification types
  async addFriendRequestReceived(
    userId: string,
    data: FriendRequestReceivedData
  ): Promise<Job> {
    FriendRequestReceivedDataSchema.parse(data);
    return this.addNotification(NotificationType.FRIEND_REQUEST_RECEIVED, userId, data, {
      priority: 8, // High priority for friend requests
    });
  }

  async addFriendRequestAccepted(
    userId: string,
    data: FriendRequestAcceptedData
  ): Promise<Job> {
    FriendRequestAcceptedDataSchema.parse(data);
    return this.addNotification(NotificationType.FRIEND_REQUEST_ACCEPTED, userId, data, {
      priority: 7, // High priority for acceptance
    });
  }

  async addFriendAttendedConcert(
    userId: string,
    data: FriendAttendedConcertData
  ): Promise<Job> {
    FriendAttendedConcertDataSchema.parse(data);
    return this.addNotification(NotificationType.FRIEND_ATTENDED_CONCERT, userId, data, {
      priority: 6, // Medium-high priority for friend activity
    });
  }

  async addConcertReminder(
    userId: string,
    data: ConcertReminderData,
    scheduledFor: Date
  ): Promise<Job> {
    ConcertReminderDataSchema.parse(data);
    return this.addNotification(NotificationType.CONCERT_REMINDER, userId, data, {
      scheduledFor,
      priority: 9, // Very high priority for reminders
    });
  }

  async addNewConcertsNearby(
    userId: string,
    data: NewConcertsNearbyData
  ): Promise<Job> {
    NewConcertsNearbyDataSchema.parse(data);
    return this.addNotification(NotificationType.NEW_CONCERTS_NEARBY, userId, data, {
      priority: 4, // Medium priority for discovery
    });
  }

  async addWeeklyDigest(
    userId: string,
    data: WeeklyDigestData,
    scheduledFor: Date
  ): Promise<Job> {
    WeeklyDigestDataSchema.parse(data);
    return this.addNotification(NotificationType.WEEKLY_DIGEST, userId, data, {
      scheduledFor,
      priority: 3, // Lower priority for digest
    });
  }

  // Batch notification methods
  async addBatchNotifications(
    notifications: Array<{
      type: NotificationType;
      userId: string;
      data: Record<string, any>;
      options?: any;
    }>
  ): Promise<Job[]> {
    const jobs = await Promise.all(
      notifications.map(notif =>
        this.addNotification(notif.type, notif.userId, notif.data, notif.options)
      )
    );

    return jobs;
  }

  // Cancel scheduled notification
  async cancelNotification(jobId: string): Promise<boolean> {
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        await job.remove();
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // Queue management
  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActive(),
      this.queue.getCompleted(),
      this.queue.getFailed(),
      this.queue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  async pauseQueue(): Promise<void> {
    await this.queue.pause();
  }

  async resumeQueue(): Promise<void> {
    await this.queue.resume();
  }

  async cleanQueue(grace: number = 5000): Promise<void> {
    await this.queue.clean(grace, 10, 'completed');
    await this.queue.clean(grace, 10, 'failed');
  }

  // Generate unique job ID
  private generateJobId(jobData: NotificationJobData): string {
    const timestamp = Date.now();
    const hash = Buffer.from(`${jobData.type}-${jobData.userId}-${timestamp}`)
      .toString('base64')
      .slice(0, 8);
    return `notif_${hash}_${timestamp}`;
  }

  // Shutdown
  async shutdown(): Promise<void> {
    // Close all workers
    for (const [name, worker] of this.workers) {
      console.log(`Closing notification worker: ${name}`);
      await worker.close();
    }

    // Close queue
    await this.queue.close();

    // Close Redis connection
    await redisConnection.quit();
  }
}

// Create singleton instance
export const notificationQueueManager = new NotificationQueueManager();

// Export notification data validation functions
export const validateNotificationData = {
  [NotificationType.FRIEND_REQUEST_RECEIVED]: FriendRequestReceivedDataSchema.parse,
  [NotificationType.FRIEND_REQUEST_ACCEPTED]: FriendRequestAcceptedDataSchema.parse,
  [NotificationType.FRIEND_ATTENDED_CONCERT]: FriendAttendedConcertDataSchema.parse,
  [NotificationType.CONCERT_REMINDER]: ConcertReminderDataSchema.parse,
  [NotificationType.NEW_CONCERTS_NEARBY]: NewConcertsNearbyDataSchema.parse,
  [NotificationType.WEEKLY_DIGEST]: WeeklyDigestDataSchema.parse,
};