import type { Notification } from '@parse/node-apn';
import { ApnsProvider } from '../apns/provider.js';
import {
  NotificationType,
  type FriendRequestReceivedData,
  type FriendRequestAcceptedData,
  type FriendAttendedConcertData,
  type ConcertReminderData,
  type NewConcertsNearbyData,
  type WeeklyDigestData,
} from '../queue/index.js';

// Notification categories for iOS interactive notifications
export enum NotificationCategory {
  FRIEND_REQUEST = 'FRIEND_REQUEST',
  CONCERT_REMINDER = 'CONCERT_REMINDER',
  SOCIAL_UPDATE = 'SOCIAL_UPDATE',
  DISCOVERY = 'DISCOVERY',
  DIGEST = 'DIGEST',
}

// Thread IDs for notification grouping
export enum NotificationThread {
  FRIEND_REQUESTS = 'friend-requests',
  CONCERT_REMINDERS = 'concert-reminders',
  FRIEND_ACTIVITY = 'friend-activity',
  DISCOVERIES = 'discoveries',
  WEEKLY_DIGEST = 'weekly-digest',
}

// Notification message builder interface
export interface NotificationMessage {
  alert: string | { title?: string; body: string; subtitle?: string };
  badge?: number;
  sound?: string;
  payload?: Record<string, any>;
  category?: string;
  threadId?: string;
  expiry?: Date;
}

// Base notification builder class
abstract class BaseNotificationBuilder {
  protected apnsProvider: ApnsProvider;
  protected logger: any;

  constructor(apnsProvider: ApnsProvider, logger: any) {
    this.apnsProvider = apnsProvider;
    this.logger = logger;
  }

  // Create notification from message
  protected createNotification(message: NotificationMessage, badge: number): Notification {
    return this.apnsProvider.createNotification({
      alert: message.alert,
      badge,
      sound: message.sound || 'default',
      payload: message.payload,
      category: message.category,
      threadId: message.threadId,
      expiry: message.expiry || new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });
  }

  // Format time difference for display
  protected formatTimeUntil(hours: number): string {
    if (hours < 1) {
      const minutes = Math.round(hours * 60);
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else if (hours < 24) {
      const wholeHours = Math.floor(hours);
      return `${wholeHours} hour${wholeHours !== 1 ? 's' : ''}`;
    } else {
      const days = Math.floor(hours / 24);
      return `${days} day${days !== 1 ? 's' : ''}`;
    }
  }

  // Format date for display
  protected formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      const concertDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

      if (concertDate.getTime() === today.getTime()) {
        return 'today';
      } else if (concertDate.getTime() === tomorrow.getTime()) {
        return 'tomorrow';
      } else {
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
        });
      }
    } catch {
      return dateString;
    }
  }
}

// Friend request received notification builder
export class FriendRequestReceivedBuilder extends BaseNotificationBuilder {
  build(data: FriendRequestReceivedData, badge: number): Notification {
    const message: NotificationMessage = {
      alert: {
        title: 'Friend Request',
        body: `${data.requesterName} wants to be friends`,
      },
      payload: {
        type: NotificationType.FRIEND_REQUEST_RECEIVED,
        requesterId: data.requesterId,
        requesterUsername: data.requesterUsername,
      },
      category: NotificationCategory.FRIEND_REQUEST,
      threadId: NotificationThread.FRIEND_REQUESTS,
      sound: 'default',
    };

    this.logger.debug('Building friend request received notification', {
      requesterName: data.requesterName,
      requesterId: data.requesterId,
    });

    return this.createNotification(message, badge);
  }
}

// Friend request accepted notification builder
export class FriendRequestAcceptedBuilder extends BaseNotificationBuilder {
  build(data: FriendRequestAcceptedData, badge: number): Notification {
    const message: NotificationMessage = {
      alert: {
        title: 'Friend Request Accepted',
        body: `${data.accepterName} accepted your friend request`,
      },
      payload: {
        type: NotificationType.FRIEND_REQUEST_ACCEPTED,
        accepterId: data.accepterId,
        accepterUsername: data.accepterUsername,
      },
      category: NotificationCategory.SOCIAL_UPDATE,
      threadId: NotificationThread.FRIEND_REQUESTS,
      sound: 'default',
    };

    this.logger.debug('Building friend request accepted notification', {
      accepterName: data.accepterName,
      accepterId: data.accepterId,
    });

    return this.createNotification(message, badge);
  }
}

// Friend attended concert notification builder
export class FriendAttendedConcertBuilder extends BaseNotificationBuilder {
  build(data: FriendAttendedConcertData, badge: number): Notification {
    const concertDate = this.formatDate(data.concertDate);

    const message: NotificationMessage = {
      alert: {
        title: 'Friend Activity',
        body: `${data.friendName} was at ${data.artistName} @ ${data.venueName}`,
        subtitle: concertDate === 'today' ? undefined : `on ${concertDate}`,
      },
      payload: {
        type: NotificationType.FRIEND_ATTENDED_CONCERT,
        friendId: data.friendId,
        attendanceId: data.attendanceId,
        artistName: data.artistName,
        venueName: data.venueName,
      },
      category: NotificationCategory.SOCIAL_UPDATE,
      threadId: NotificationThread.FRIEND_ACTIVITY,
      sound: 'default',
    };

    this.logger.debug('Building friend attended concert notification', {
      friendName: data.friendName,
      artistName: data.artistName,
      venueName: data.venueName,
    });

    return this.createNotification(message, badge);
  }
}

// Concert reminder notification builder
export class ConcertReminderBuilder extends BaseNotificationBuilder {
  build(data: ConcertReminderData, badge: number): Notification {
    const timeUntil = this.formatTimeUntil(data.hoursUntil);
    const concertTime = data.concertTime ? ` at ${data.concertTime}` : '';

    const message: NotificationMessage = {
      alert: {
        title: 'Concert Reminder',
        body: `${data.artistName} is performing in ${timeUntil}`,
        subtitle: `${data.venueName}, ${data.venueCity}${concertTime}`,
      },
      payload: {
        type: NotificationType.CONCERT_REMINDER,
        concertId: data.concertId,
        artistName: data.artistName,
        venueName: data.venueName,
      },
      category: NotificationCategory.CONCERT_REMINDER,
      threadId: NotificationThread.CONCERT_REMINDERS,
      sound: 'default',
    };

    this.logger.debug('Building concert reminder notification', {
      artistName: data.artistName,
      venueName: data.venueName,
      hoursUntil: data.hoursUntil,
    });

    return this.createNotification(message, badge);
  }
}

// New concerts nearby notification builder
export class NewConcertsNearbyBuilder extends BaseNotificationBuilder {
  build(data: NewConcertsNearbyData, badge: number): Notification {
    const { concertCount, location, topArtists } = data;

    let body: string;
    if (concertCount === 1) {
      body = `1 new concert near ${location}`;
    } else {
      body = `${concertCount} new concerts near ${location}`;
    }

    let subtitle: string | undefined;
    if (topArtists.length > 0) {
      if (topArtists.length === 1) {
        subtitle = `including ${topArtists[0]}`;
      } else if (topArtists.length === 2) {
        subtitle = `including ${topArtists[0]} and ${topArtists[1]}`;
      } else {
        subtitle = `including ${topArtists[0]}, ${topArtists[1]} and others`;
      }
    }

    const message: NotificationMessage = {
      alert: {
        title: 'New Concerts',
        body,
        subtitle,
      },
      payload: {
        type: NotificationType.NEW_CONCERTS_NEARBY,
        concertCount,
        location,
        topArtists,
      },
      category: NotificationCategory.DISCOVERY,
      threadId: NotificationThread.DISCOVERIES,
      sound: 'default',
    };

    this.logger.debug('Building new concerts nearby notification', {
      concertCount,
      location,
      topArtists,
    });

    return this.createNotification(message, badge);
  }
}

// Weekly digest notification builder
export class WeeklyDigestBuilder extends BaseNotificationBuilder {
  build(data: WeeklyDigestData, badge: number): Notification {
    const { friendsActivityCount, newConcertsCount, upcomingConcertsCount } = data;

    let body: string;
    const activities: string[] = [];

    if (friendsActivityCount > 0) {
      activities.push(`${friendsActivityCount} friend${friendsActivityCount !== 1 ? 's' : ''} active`);
    }

    if (newConcertsCount > 0) {
      activities.push(`${newConcertsCount} new concert${newConcertsCount !== 1 ? 's' : ''}`);
    }

    if (upcomingConcertsCount > 0) {
      activities.push(`${upcomingConcertsCount} upcoming show${upcomingConcertsCount !== 1 ? 's' : ''}`);
    }

    if (activities.length === 0) {
      body = 'Your weekly music recap is ready';
    } else {
      body = `This week: ${activities.join(', ')}`;
    }

    let subtitle: string | undefined;
    if (data.highlightedFriend) {
      subtitle = `${data.highlightedFriend.name} attended ${data.highlightedFriend.activityCount} show${data.highlightedFriend.activityCount !== 1 ? 's' : ''}`;
    } else if (data.highlightedConcert) {
      subtitle = `Don't miss ${data.highlightedConcert.artistName} at ${data.highlightedConcert.venueName}`;
    }

    const message: NotificationMessage = {
      alert: {
        title: 'Weekly Recap',
        body,
        subtitle,
      },
      payload: {
        type: NotificationType.WEEKLY_DIGEST,
        friendsActivityCount,
        newConcertsCount,
        upcomingConcertsCount,
        highlightedFriend: data.highlightedFriend,
        highlightedConcert: data.highlightedConcert,
      },
      category: NotificationCategory.DIGEST,
      threadId: NotificationThread.WEEKLY_DIGEST,
      sound: 'default',
    };

    this.logger.debug('Building weekly digest notification', {
      friendsActivityCount,
      newConcertsCount,
      upcomingConcertsCount,
    });

    return this.createNotification(message, badge);
  }
}

// Notification builder factory
export class NotificationBuilderFactory {
  private apnsProvider: ApnsProvider;
  private logger: any;
  private builders: Map<NotificationType, BaseNotificationBuilder>;

  constructor(apnsProvider: ApnsProvider, logger: any) {
    this.apnsProvider = apnsProvider;
    this.logger = logger;

    // Initialize builders
    this.builders = new Map([
      [NotificationType.FRIEND_REQUEST_RECEIVED, new FriendRequestReceivedBuilder(apnsProvider, logger)],
      [NotificationType.FRIEND_REQUEST_ACCEPTED, new FriendRequestAcceptedBuilder(apnsProvider, logger)],
      [NotificationType.FRIEND_ATTENDED_CONCERT, new FriendAttendedConcertBuilder(apnsProvider, logger)],
      [NotificationType.CONCERT_REMINDER, new ConcertReminderBuilder(apnsProvider, logger)],
      [NotificationType.NEW_CONCERTS_NEARBY, new NewConcertsNearbyBuilder(apnsProvider, logger)],
      [NotificationType.WEEKLY_DIGEST, new WeeklyDigestBuilder(apnsProvider, logger)],
    ]);
  }

  // Build notification for a specific type
  buildNotification(
    type: NotificationType,
    data: any,
    badge: number
  ): Notification | null {
    const builder = this.builders.get(type);
    if (!builder) {
      this.logger.error(`No builder found for notification type: ${type}`);
      return null;
    }

    try {
      return builder.build(data, badge);
    } catch (error) {
      this.logger.error('Error building notification', {
        type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  // Get all supported notification types
  getSupportedTypes(): NotificationType[] {
    return Array.from(this.builders.keys());
  }
}