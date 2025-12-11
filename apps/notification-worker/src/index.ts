import { Elysia } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { cors } from '@elysiajs/cors';
import { pino } from 'pino';
import { ApnsProvider } from './apns/provider.js';
import { NotificationWorker } from './worker/index.js';
import { NotificationQueueManager } from './queue/index.js';
import { DeviceManager } from './services/device-manager.js';
import { BadgeTracker } from './services/badge-tracker.js';
import { NotificationPreferencesService } from './services/preferences.js';
import { RateLimiter } from './services/rate-limiter.js';
import { redisConnection } from './queue/index.js';

// Environment validation
const requiredEnvVars = [
  'APNS_KEY_ID',
  'APNS_TEAM_ID',
  'APNS_PRIVATE_KEY_PATH',
  'APNS_BUNDLE_ID',
  'DATABASE_URL',
  'REDIS_URL',
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Environment configuration
const config = {
  port: Number(process.env.PORT) || 3006,
  nodeEnv: process.env.NODE_ENV || 'development',
  apns: {
    keyId: process.env.APNS_KEY_ID!,
    teamId: process.env.APNS_TEAM_ID!,
    privateKeyPath: process.env.APNS_PRIVATE_KEY_PATH!,
    bundleId: process.env.APNS_BUNDLE_ID!,
    production: process.env.NODE_ENV === 'production',
  },
  database: {
    url: process.env.DATABASE_URL!,
  },
  redis: {
    url: process.env.REDIS_URL!,
  },
};

// Logger setup
const logger = pino({
  level: config.nodeEnv === 'development' ? 'debug' : 'info',
  transport: config.nodeEnv === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: true,
        },
      }
    : undefined,
});

// Service instances
let dbClient: any; // TODO: Initialize with actual database client
let apnsProvider: ApnsProvider;
let notificationWorker: NotificationWorker;
let queueManager: NotificationQueueManager;
let deviceManager: DeviceManager;
let badgeTracker: BadgeTracker;
let preferencesService: NotificationPreferencesService;
let rateLimiter: RateLimiter;

// Health check endpoint data
interface HealthCheck {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  services: {
    worker: boolean;
    apns: boolean;
    redis: boolean;
    database: boolean;
  };
  version: string;
  uptime: number;
}

// Statistics endpoint data
interface ServiceStats {
  worker: {
    isRunning: boolean;
    concurrency: number;
    isShuttingDown: boolean;
    supportedNotificationTypes: string[];
  };
  queue: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  apns: {
    isHealthy: boolean;
    totalSent: number;
    successRate: number;
  };
}

// Initialize services
async function initializeServices(): Promise<void> {
  try {
    logger.info('Initializing notification worker services...');

    // Initialize database client
    // TODO: Replace with actual database client initialization
    // dbClient = drizzle(postgres(config.database.url));
    dbClient = {}; // Placeholder

    // Initialize APNs provider
    apnsProvider = new ApnsProvider(config.apns, logger);
    await apnsProvider.initialize();
    logger.info('APNs provider initialized');

    // Initialize services
    deviceManager = new DeviceManager(dbClient, logger);
    badgeTracker = new BadgeTracker(dbClient, redisConnection, logger);
    preferencesService = new NotificationPreferencesService(dbClient, redisConnection, logger);
    rateLimiter = new RateLimiter(redisConnection, logger);

    // Initialize queue manager
    queueManager = new NotificationQueueManager(logger);
    await queueManager.initialize();
    logger.info('Queue manager initialized');

    // Initialize notification worker
    notificationWorker = new NotificationWorker(
      apnsProvider,
      dbClient,
      redisConnection,
      logger
    );
    logger.info('Notification worker initialized');

    logger.info('All services initialized successfully');

  } catch (error) {
    logger.error('Failed to initialize services', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

// Create Elysia app
const app = new Elysia()
  .use(cors())
  .use(swagger({
    documentation: {
      info: {
        title: 'Gigz Notification Worker API',
        version: '1.0.0',
        description: 'Push notification worker service for iOS devices via APNs',
      },
      tags: [
        { name: 'Health', description: 'Health check endpoints' },
        { name: 'Devices', description: 'Device token management' },
        { name: 'Notifications', description: 'Notification management' },
        { name: 'Preferences', description: 'User notification preferences' },
        { name: 'Stats', description: 'Service statistics and monitoring' },
      ],
    },
  }))

  // Health check endpoint
  .get('/health', async (): Promise<HealthCheck> => {
    const startTime = Date.now();

    // Check all services
    const [workerHealthy, apnsHealthy, redisHealthy] = await Promise.all([
      notificationWorker.isHealthy().catch(() => false),
      apnsProvider.isHealthy().catch(() => false),
      redisConnection.ping().then(() => true).catch(() => false),
    ]);

    const databaseHealthy = true; // TODO: Implement actual database health check

    const allHealthy = workerHealthy && apnsHealthy && redisHealthy && databaseHealthy;

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        worker: workerHealthy,
        apns: apnsHealthy,
        redis: redisHealthy,
        database: databaseHealthy,
      },
      version: '1.0.0',
      uptime: process.uptime(),
    };
  }, {
    tags: ['Health'],
    detail: {
      summary: 'Service health check',
      description: 'Returns the health status of all notification worker components',
    },
  })

  // Statistics endpoint
  .get('/stats', async (): Promise<ServiceStats> => {
    const [workerStats, queueStats] = await Promise.all([
      notificationWorker.getStats(),
      queueManager.getQueueStats().catch(() => ({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      })),
    ]);

    return {
      worker: workerStats,
      queue: queueStats,
      apns: {
        isHealthy: await apnsProvider.isHealthy().catch(() => false),
        totalSent: 0, // TODO: Implement actual metrics
        successRate: 0,
      },
    };
  }, {
    tags: ['Stats'],
    detail: {
      summary: 'Service statistics',
      description: 'Returns operational statistics for monitoring and debugging',
    },
  })

  // Device registration endpoint
  .post('/devices/register', async ({ body }: { body: any }) => {
    try {
      const device = await deviceManager.registerDevice(body);
      logger.info('Device registered via API', {
        deviceId: device.id,
        userId: device.userId,
        platform: device.platform,
      });

      return {
        success: true,
        device: {
          id: device.id,
          userId: device.userId,
          platform: device.platform,
          active: device.active,
          createdAt: device.createdAt,
        },
      };
    } catch (error) {
      logger.error('Device registration failed via API', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new Error('Device registration failed');
    }
  }, {
    tags: ['Devices'],
    detail: {
      summary: 'Register device token',
      description: 'Register a new device token for push notifications',
    },
  })

  // Get user devices endpoint
  .get('/devices/:userId', async ({ params }: { params: { userId: string } }) => {
    try {
      const devices = await deviceManager.getUserDevices(params.userId);

      return {
        success: true,
        devices: devices.map(device => ({
          id: device.id,
          platform: device.platform,
          deviceName: device.deviceName,
          active: device.active,
          lastUsed: device.lastUsed,
          failureCount: device.failureCount,
        })),
      };
    } catch (error) {
      logger.error('Failed to retrieve user devices via API', {
        userId: params.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new Error('Failed to retrieve devices');
    }
  }, {
    tags: ['Devices'],
    detail: {
      summary: 'Get user devices',
      description: 'Retrieve all registered devices for a user',
    },
  })

  // Badge count endpoint
  .get('/badge/:userId', async ({ params }: { params: { userId: string } }) => {
    try {
      const badge = await badgeTracker.getBadgeCount(params.userId);

      return {
        success: true,
        badgeCount: badge,
      };
    } catch (error) {
      logger.error('Failed to get badge count via API', {
        userId: params.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: true,
        badgeCount: 0,
      };
    }
  }, {
    tags: ['Notifications'],
    detail: {
      summary: 'Get user badge count',
      description: 'Retrieve current badge count for a user',
    },
  })

  // Update notification preferences endpoint
  .put('/preferences/:userId', async ({ params, body }: { params: { userId: string }, body: any }) => {
    try {
      const update = {
        userId: params.userId,
        ...body,
      };

      const preferences = await preferencesService.updateUserPreferences(update);

      logger.info('Notification preferences updated via API', {
        userId: params.userId,
      });

      return {
        success: true,
        preferences: {
          userId: preferences.userId,
          enabled: preferences.enabled,
          quietHours: preferences.quietHours,
          allowCritical: preferences.allowCritical,
          preferences: preferences.preferences,
        },
      };
    } catch (error) {
      logger.error('Failed to update preferences via API', {
        userId: params.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new Error('Failed to update preferences');
    }
  }, {
    tags: ['Preferences'],
    detail: {
      summary: 'Update notification preferences',
      description: 'Update notification preferences for a user',
    },
  })

  // Get notification preferences endpoint
  .get('/preferences/:userId', async ({ params }: { params: { userId: string } }) => {
    try {
      const preferences = await preferencesService.getUserPreferences(params.userId);

      return {
        success: true,
        preferences: {
          userId: preferences.userId,
          enabled: preferences.enabled,
          quietHours: preferences.quietHours,
          allowCritical: preferences.allowCritical,
          preferences: preferences.preferences,
        },
      };
    } catch (error) {
      logger.error('Failed to get preferences via API', {
        userId: params.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new Error('Failed to get preferences');
    }
  }, {
    tags: ['Preferences'],
    detail: {
      summary: 'Get notification preferences',
      description: 'Retrieve notification preferences for a user',
    },
  })

  // Rate limit statistics endpoint
  .get('/rate-limits/stats', async () => {
    try {
      const stats = await rateLimiter.getRateLimitStats();

      return {
        success: true,
        stats,
      };
    } catch (error) {
      logger.error('Failed to get rate limit stats via API', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: true,
        stats: {
          violations: [],
          topUsers: [],
          notificationTypeStats: {},
        },
      };
    }
  }, {
    tags: ['Stats'],
    detail: {
      summary: 'Get rate limit statistics',
      description: 'Retrieve rate limiting statistics and violations',
    },
  })

  // Queue manual processing endpoint (for testing/debugging)
  .post('/queue/process', async ({ body }: { body: any }) => {
    try {
      const job = await queueManager.addNotificationJob(
        body.type,
        body.userId,
        body.data
      );

      logger.info('Manual notification job added via API', {
        jobId: job.id,
        type: body.type,
        userId: body.userId,
      });

      return {
        success: true,
        jobId: job.id,
      };
    } catch (error) {
      logger.error('Failed to add manual notification job via API', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new Error('Failed to add notification job');
    }
  }, {
    tags: ['Notifications'],
    detail: {
      summary: 'Add notification job',
      description: 'Manually add a notification job to the queue (for testing/debugging)',
    },
  });

// Graceful shutdown handler
async function shutdown(): Promise<void> {
  logger.info('Starting graceful shutdown...');

  try {
    // Stop accepting new requests
    await app.stop();

    // Shutdown notification worker
    if (notificationWorker) {
      await notificationWorker.shutdown();
    }

    // Close queue manager
    if (queueManager) {
      await queueManager.close();
    }

    // Close Redis connection
    await redisConnection.disconnect();

    // Close database connection
    // TODO: Close actual database connection

    logger.info('Graceful shutdown complete');
    process.exit(0);

  } catch (error) {
    logger.error('Error during shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal('Unhandled rejection', { reason });
  process.exit(1);
});

// Start the service
async function start(): Promise<void> {
  try {
    // Initialize all services
    await initializeServices();

    // Start the HTTP server
    app.listen(config.port, () => {
      logger.info(`Notification worker started`, {
        port: config.port,
        environment: config.nodeEnv,
        apnsProduction: config.apns.production,
      });

      logger.info('Available endpoints:');
      logger.info('  GET  /health - Health check');
      logger.info('  GET  /stats - Service statistics');
      logger.info('  POST /devices/register - Register device token');
      logger.info('  GET  /devices/:userId - Get user devices');
      logger.info('  GET  /badge/:userId - Get badge count');
      logger.info('  PUT  /preferences/:userId - Update notification preferences');
      logger.info('  GET  /preferences/:userId - Get notification preferences');
      logger.info('  GET  /rate-limits/stats - Get rate limit statistics');
      logger.info('  POST /queue/process - Add notification job (testing)');
      logger.info('  GET  /swagger - API documentation');
    });

  } catch (error) {
    logger.fatal('Failed to start notification worker', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Start the application
start();

export { app, config, logger };
