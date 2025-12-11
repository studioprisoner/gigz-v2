import { z } from 'zod';
import type { Redis } from 'ioredis';
import { getRedisClient } from './client.js';

// Event schema for type-safe events
export const EventSchema = z.object({
  type: z.string().min(1),
  data: z.any(),
  timestamp: z.date().default(() => new Date()),
  source: z.string().optional(),
  correlationId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export type Event = z.infer<typeof EventSchema>;

// Event handler function type
export type EventHandler<T = any> = (event: Event<T>) => Promise<void> | void;

// Subscription options
export interface SubscriptionOptions {
  pattern?: boolean; // Whether to use pattern matching
  autoReconnect?: boolean;
  maxRetries?: number;
  retryDelay?: number;
}

// Subscription info
export interface Subscription {
  channel: string;
  pattern: boolean;
  handler: EventHandler;
  options: SubscriptionOptions;
  active: boolean;
  messageCount: number;
  errorCount: number;
  lastMessage?: Date;
  lastError?: Date;
}

// Publisher configuration
export interface PublisherConfig {
  defaultTTL?: number;
  compression?: boolean;
  retryAttempts?: number;
  retryDelay?: number;
}

// Subscriber configuration
export interface SubscriberConfig {
  maxRetries?: number;
  retryDelay?: number;
  autoReconnect?: boolean;
  bufferMaxEntries?: number;
}

// Pub/Sub statistics
export interface PubSubStats {
  published: number;
  received: number;
  errors: number;
  activeSubscriptions: number;
  patterns: number;
  channels: number;
}

// Redis Pub/Sub manager
export class RedisPubSub {
  private publisher: Redis;
  private subscriber: Redis;
  private logger?: any;
  private subscriptions: Map<string, Subscription> = new Map();
  private stats: PubSubStats;
  private publisherConfig: PublisherConfig;
  private subscriberConfig: SubscriberConfig;

  constructor(
    publisherClient?: Redis,
    subscriberClient?: Redis,
    publisherConfig?: PublisherConfig,
    subscriberConfig?: SubscriberConfig,
    logger?: any
  ) {
    // Use separate clients for pub/sub to avoid blocking
    this.publisher = publisherClient || getRedisClient().getClient();
    this.subscriber = subscriberClient || getRedisClient().getClient().duplicate();
    this.logger = logger;

    this.publisherConfig = {
      defaultTTL: 60,
      compression: false,
      retryAttempts: 3,
      retryDelay: 1000,
      ...publisherConfig,
    };

    this.subscriberConfig = {
      maxRetries: 3,
      retryDelay: 1000,
      autoReconnect: true,
      bufferMaxEntries: 10000,
      ...subscriberConfig,
    };

    this.stats = {
      published: 0,
      received: 0,
      errors: 0,
      activeSubscriptions: 0,
      patterns: 0,
      channels: 0,
    };

    this.setupSubscriberEvents();
  }

  // Publish event to channel
  async publish<T = any>(
    channel: string,
    event: Omit<Event<T>, 'timestamp'>,
    options?: {
      ttl?: number;
      retryOnFailure?: boolean;
    }
  ): Promise<number> {
    try {
      const fullEvent: Event<T> = {
        ...event,
        timestamp: new Date(),
      };

      // Validate event
      EventSchema.parse(fullEvent);

      const serializedEvent = JSON.stringify(fullEvent);

      let result: number;
      let attempts = 0;
      const maxAttempts = options?.retryOnFailure ? this.publisherConfig.retryAttempts! : 1;

      do {
        try {
          result = await this.publisher.publish(channel, serializedEvent);
          break;
        } catch (error) {
          attempts++;

          if (attempts >= maxAttempts) {
            throw error;
          }

          this.logger?.warn('Publish attempt failed, retrying', {
            channel,
            attempt: attempts,
            maxAttempts,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          await new Promise(resolve => setTimeout(resolve, this.publisherConfig.retryDelay));
        }
      } while (attempts < maxAttempts);

      this.stats.published++;

      this.logger?.debug('Event published', {
        channel,
        type: event.type,
        subscribers: result!,
        correlationId: event.correlationId,
      });

      return result!;

    } catch (error) {
      this.stats.errors++;

      this.logger?.error('Failed to publish event', {
        channel,
        type: event.type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  // Subscribe to channel
  async subscribe<T = any>(
    channel: string,
    handler: EventHandler<T>,
    options: SubscriptionOptions = {}
  ): Promise<void> {
    const subscriptionKey = options.pattern ? `pattern:${channel}` : `channel:${channel}`;

    if (this.subscriptions.has(subscriptionKey)) {
      throw new Error(`Already subscribed to ${options.pattern ? 'pattern' : 'channel'}: ${channel}`);
    }

    try {
      if (options.pattern) {
        await this.subscriber.psubscribe(channel);
        this.stats.patterns++;
      } else {
        await this.subscriber.subscribe(channel);
        this.stats.channels++;
      }

      const subscription: Subscription = {
        channel,
        pattern: options.pattern || false,
        handler,
        options: {
          autoReconnect: true,
          maxRetries: 3,
          retryDelay: 1000,
          ...options,
        },
        active: true,
        messageCount: 0,
        errorCount: 0,
      };

      this.subscriptions.set(subscriptionKey, subscription);
      this.stats.activeSubscriptions++;

      this.logger?.info('Subscribed to channel', {
        channel,
        pattern: options.pattern,
        totalSubscriptions: this.stats.activeSubscriptions,
      });

    } catch (error) {
      this.stats.errors++;

      this.logger?.error('Failed to subscribe to channel', {
        channel,
        pattern: options.pattern,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  // Unsubscribe from channel
  async unsubscribe(channel: string, pattern: boolean = false): Promise<void> {
    const subscriptionKey = pattern ? `pattern:${channel}` : `channel:${channel}`;
    const subscription = this.subscriptions.get(subscriptionKey);

    if (!subscription) {
      this.logger?.warn('Subscription not found', { channel, pattern });
      return;
    }

    try {
      if (pattern) {
        await this.subscriber.punsubscribe(channel);
        this.stats.patterns--;
      } else {
        await this.subscriber.unsubscribe(channel);
        this.stats.channels--;
      }

      subscription.active = false;
      this.subscriptions.delete(subscriptionKey);
      this.stats.activeSubscriptions--;

      this.logger?.info('Unsubscribed from channel', {
        channel,
        pattern,
        messageCount: subscription.messageCount,
        errorCount: subscription.errorCount,
      });

    } catch (error) {
      this.stats.errors++;

      this.logger?.error('Failed to unsubscribe from channel', {
        channel,
        pattern,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  // Unsubscribe from all channels
  async unsubscribeAll(): Promise<void> {
    try {
      const subscriptions = Array.from(this.subscriptions.values());

      for (const subscription of subscriptions) {
        if (subscription.active) {
          await this.unsubscribe(subscription.channel, subscription.pattern);
        }
      }

      this.logger?.info('Unsubscribed from all channels');

    } catch (error) {
      this.logger?.error('Failed to unsubscribe from all channels', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  // Setup subscriber event handlers
  private setupSubscriberEvents(): void {
    // Handle regular messages
    this.subscriber.on('message', async (channel: string, message: string) => {
      await this.handleMessage(channel, message, false);
    });

    // Handle pattern messages
    this.subscriber.on('pmessage', async (pattern: string, channel: string, message: string) => {
      await this.handleMessage(pattern, message, true, channel);
    });

    // Handle subscription events
    this.subscriber.on('subscribe', (channel: string, count: number) => {
      this.logger?.debug('Subscribed to channel', { channel, totalSubscriptions: count });
    });

    this.subscriber.on('psubscribe', (pattern: string, count: number) => {
      this.logger?.debug('Subscribed to pattern', { pattern, totalSubscriptions: count });
    });

    this.subscriber.on('unsubscribe', (channel: string, count: number) => {
      this.logger?.debug('Unsubscribed from channel', { channel, remainingSubscriptions: count });
    });

    this.subscriber.on('punsubscribe', (pattern: string, count: number) => {
      this.logger?.debug('Unsubscribed from pattern', { pattern, remainingSubscriptions: count });
    });

    // Handle connection events
    this.subscriber.on('connect', () => {
      this.logger?.info('Subscriber connected');
    });

    this.subscriber.on('ready', () => {
      this.logger?.info('Subscriber ready');
    });

    this.subscriber.on('error', (error: Error) => {
      this.stats.errors++;
      this.logger?.error('Subscriber error', { error: error.message });
    });

    this.subscriber.on('close', () => {
      this.logger?.warn('Subscriber connection closed');
    });

    this.subscriber.on('reconnecting', (delay: number) => {
      this.logger?.info('Subscriber reconnecting', { delay });
    });
  }

  // Handle incoming messages
  private async handleMessage(
    channelOrPattern: string,
    message: string,
    isPattern: boolean,
    actualChannel?: string
  ): Promise<void> {
    const subscriptionKey = isPattern ? `pattern:${channelOrPattern}` : `channel:${channelOrPattern}`;
    const subscription = this.subscriptions.get(subscriptionKey);

    if (!subscription || !subscription.active) {
      this.logger?.debug('Message received for inactive subscription', {
        channel: channelOrPattern,
        pattern: isPattern,
      });
      return;
    }

    try {
      // Parse event
      let event: Event;
      try {
        const parsed = JSON.parse(message);
        event = EventSchema.parse(parsed);
      } catch (parseError) {
        throw new Error(`Invalid event format: ${parseError}`);
      }

      subscription.messageCount++;
      subscription.lastMessage = new Date();
      this.stats.received++;

      this.logger?.debug('Event received', {
        channel: actualChannel || channelOrPattern,
        type: event.type,
        correlationId: event.correlationId,
        pattern: isPattern,
      });

      // Execute handler with retry logic
      let attempts = 0;
      const maxAttempts = subscription.options.maxRetries || 1;

      do {
        try {
          await subscription.handler(event);
          break;
        } catch (handlerError) {
          attempts++;

          if (attempts >= maxAttempts) {
            throw handlerError;
          }

          this.logger?.warn('Event handler failed, retrying', {
            channel: actualChannel || channelOrPattern,
            type: event.type,
            attempt: attempts,
            maxAttempts,
            error: handlerError instanceof Error ? handlerError.message : 'Unknown error',
          });

          await new Promise(resolve => setTimeout(resolve, subscription.options.retryDelay || 1000));
        }
      } while (attempts < maxAttempts);

    } catch (error) {
      subscription.errorCount++;
      subscription.lastError = new Date();
      this.stats.errors++;

      this.logger?.error('Failed to handle message', {
        channel: actualChannel || channelOrPattern,
        pattern: isPattern,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Don't re-throw to avoid breaking the subscription
    }
  }

  // Get subscription info
  getSubscription(channel: string, pattern: boolean = false): Subscription | undefined {
    const subscriptionKey = pattern ? `pattern:${channel}` : `channel:${channel}`;
    return this.subscriptions.get(subscriptionKey);
  }

  // Get all subscriptions
  getSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values());
  }

  // Get active subscriptions
  getActiveSubscriptions(): Subscription[] {
    return this.getSubscriptions().filter(sub => sub.active);
  }

  // Get pub/sub statistics
  getStats(): PubSubStats {
    return { ...this.stats };
  }

  // Reset statistics
  resetStats(): void {
    this.stats = {
      published: 0,
      received: 0,
      errors: 0,
      activeSubscriptions: this.stats.activeSubscriptions,
      patterns: this.stats.patterns,
      channels: this.stats.channels,
    };
  }

  // Check if subscribed to channel
  isSubscribed(channel: string, pattern: boolean = false): boolean {
    const subscriptionKey = pattern ? `pattern:${channel}` : `channel:${channel}`;
    const subscription = this.subscriptions.get(subscriptionKey);
    return subscription?.active || false;
  }

  // Get number of subscribers for channel
  async getSubscriberCount(channel: string): Promise<number> {
    try {
      const result = await this.publisher.pubsub('NUMSUB', channel);
      return Array.isArray(result) ? (result[1] as number) || 0 : 0;
    } catch (error) {
      this.logger?.error('Failed to get subscriber count', {
        channel,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  // Get active channels
  async getActiveChannels(): Promise<string[]> {
    try {
      const channels = await this.publisher.pubsub('CHANNELS');
      return Array.isArray(channels) ? channels : [];
    } catch (error) {
      this.logger?.error('Failed to get active channels', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  // Close connections
  async close(): Promise<void> {
    try {
      await this.unsubscribeAll();
      await this.subscriber.disconnect();

      this.logger?.info('PubSub connections closed');

    } catch (error) {
      this.logger?.error('Error closing PubSub connections', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

// Default pub/sub instance
let defaultPubSub: RedisPubSub | null = null;

// Initialize default pub/sub
export function initializePubSub(
  publisherClient?: Redis,
  subscriberClient?: Redis,
  publisherConfig?: PublisherConfig,
  subscriberConfig?: SubscriberConfig,
  logger?: any
): RedisPubSub {
  if (defaultPubSub) {
    throw new Error('PubSub already initialized. Use getPubSub() to access it.');
  }

  defaultPubSub = new RedisPubSub(publisherClient, subscriberClient, publisherConfig, subscriberConfig, logger);
  return defaultPubSub;
}

// Get default pub/sub instance
export function getPubSub(): RedisPubSub {
  if (!defaultPubSub) {
    // Auto-initialize with default settings if not already done
    defaultPubSub = new RedisPubSub();
  }
  return defaultPubSub;
}

// Create a new pub/sub instance
export function createPubSub(
  publisherClient?: Redis,
  subscriberClient?: Redis,
  publisherConfig?: PublisherConfig,
  subscriberConfig?: SubscriberConfig,
  logger?: any
): RedisPubSub {
  return new RedisPubSub(publisherClient, subscriberClient, publisherConfig, subscriberConfig, logger);
}

// Utility functions for common pub/sub operations

// Publish event
export async function publishEvent<T = any>(
  channel: string,
  type: string,
  data: T,
  options?: {
    source?: string;
    correlationId?: string;
    metadata?: Record<string, any>;
    ttl?: number;
    retryOnFailure?: boolean;
  }
): Promise<number> {
  const event: Omit<Event<T>, 'timestamp'> = {
    type,
    data,
    source: options?.source,
    correlationId: options?.correlationId,
    metadata: options?.metadata,
  };

  return getPubSub().publish<T>(channel, event, {
    ttl: options?.ttl,
    retryOnFailure: options?.retryOnFailure,
  });
}

// Subscribe to events
export async function subscribeToEvents<T = any>(
  channel: string,
  handler: EventHandler<T>,
  options?: SubscriptionOptions
): Promise<void> {
  return getPubSub().subscribe<T>(channel, handler, options);
}

// Subscribe to event patterns
export async function subscribeToPattern<T = any>(
  pattern: string,
  handler: EventHandler<T>,
  options?: Omit<SubscriptionOptions, 'pattern'>
): Promise<void> {
  return getPubSub().subscribe<T>(pattern, handler, { ...options, pattern: true });
}

// Event emitter class for type-safe events
export class TypedEventEmitter<TEvents extends Record<string, any> = Record<string, any>> {
  private pubsub: RedisPubSub;
  private namespace: string;

  constructor(namespace: string, pubsub?: RedisPubSub) {
    this.pubsub = pubsub || getPubSub();
    this.namespace = namespace;
  }

  // Emit typed event
  async emit<K extends keyof TEvents>(
    eventType: K,
    data: TEvents[K],
    options?: {
      correlationId?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<number> {
    const channel = `${this.namespace}:${String(eventType)}`;

    return this.pubsub.publish(channel, {
      type: String(eventType),
      data,
      correlationId: options?.correlationId,
      metadata: options?.metadata,
    });
  }

  // Listen to typed event
  async on<K extends keyof TEvents>(
    eventType: K,
    handler: (data: TEvents[K], event: Event) => Promise<void> | void,
    options?: SubscriptionOptions
  ): Promise<void> {
    const channel = `${this.namespace}:${String(eventType)}`;

    return this.pubsub.subscribe(
      channel,
      async (event) => {
        await handler(event.data, event);
      },
      options
    );
  }

  // Remove typed event listener
  async off<K extends keyof TEvents>(eventType: K): Promise<void> {
    const channel = `${this.namespace}:${String(eventType)}`;
    return this.pubsub.unsubscribe(channel);
  }
}

// Export pub/sub class and utilities
export default RedisPubSub;