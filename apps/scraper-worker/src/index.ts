#!/usr/bin/env bun

// import { createClickHouseClient } from '@gigz/clickhouse';
// import { createLogger } from '@gigz/logger';

// Placeholder imports until we have the actual packages
const createClickHouseClient = (config: any) => ({
  ping: async () => true,
  close: async () => {},
  query: async () => ({ data: [] }),
  insert: async () => {},
  command: async () => {}
});

const createLogger = (config: any) => ({
  info: (...args: any[]) => console.log('[INFO]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  debug: (...args: any[]) => console.log('[DEBUG]', ...args),
});

import { queueManager, redisConnection } from './queue/index.js';
import { ScraperWorker } from './worker/index.js';
import { EntityResolver } from './services/entity-resolver.js';
import { ErrorHandler } from './services/error-handler.js';
import { MetricsService } from './services/metrics.js';
import { RateLimiter } from './services/rate-limiter.js';
import { BatchProcessor } from './services/batch-processor.js';
import { JobScheduler } from './services/scheduler.js';
import { DEFAULT_RATE_LIMITS } from './scrapers/base.js';

// Environment configuration
const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // ClickHouse configuration
  CLICKHOUSE_HOST: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  CLICKHOUSE_USERNAME: process.env.CLICKHOUSE_USERNAME || 'default',
  CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD || '',
  CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_DATABASE || 'gigz',

  // Redis configuration (inherited from queue setup)
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379'),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,

  // API Keys
  SETLISTFM_API_KEY: process.env.SETLISTFM_API_KEY,
  SONGKICK_API_KEY: process.env.SONGKICK_API_KEY,
  BANDSINTOWN_API_KEY: process.env.BANDSINTOWN_API_KEY,

  // Worker configuration
  WORKER_CONCURRENCY: parseInt(process.env.WORKER_CONCURRENCY || '2'),
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE || '1000'),
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3'),

  // Scheduler configuration
  SCHEDULER_ENABLED: process.env.SCHEDULER_ENABLED !== 'false',
};

// Global services
let logger: any;
let clickhouseClient: any;
let entityResolver: EntityResolver;
let errorHandler: ErrorHandler;
let metricsService: MetricsService;
let rateLimiter: RateLimiter;
let batchProcessor: BatchProcessor;
let scheduler: JobScheduler;
let worker: ScraperWorker;

// Graceful shutdown flag
let isShuttingDown = false;

async function initializeServices(): Promise<void> {
  console.log('🚀 Starting Gigz Scraper Worker...');

  // Initialize logger
  logger = createLogger({
    level: config.LOG_LEVEL,
    service: 'scraper-worker',
    environment: config.NODE_ENV,
  });

  logger.info('Initializing scraper worker services', config);

  // Initialize ClickHouse client
  try {
    clickhouseClient = createClickHouseClient({
      host: config.CLICKHOUSE_HOST,
      username: config.CLICKHOUSE_USERNAME,
      password: config.CLICKHOUSE_PASSWORD,
      database: config.CLICKHOUSE_DATABASE,
    });

    // Test connection
    await clickhouseClient.ping();
    logger.info('ClickHouse connection established');

  } catch (error) {
    logger.error('Failed to connect to ClickHouse', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }

  // Initialize services
  errorHandler = new ErrorHandler(logger);
  metricsService = new MetricsService(logger);
  rateLimiter = new RateLimiter(logger);

  // Register rate limiters for each source
  for (const [source, config] of Object.entries(DEFAULT_RATE_LIMITS)) {
    rateLimiter.register(source, {
      ...config,
      timeoutMs: 30000, // Add missing timeout property
    });
  }

  batchProcessor = new BatchProcessor(clickhouseClient, logger, {
    batchSize: config.BATCH_SIZE,
    maxRetries: config.MAX_RETRIES,
  });

  entityResolver = new EntityResolver(clickhouseClient, logger);

  // Initialize scheduler if enabled
  if (config.SCHEDULER_ENABLED) {
    scheduler = new JobScheduler(logger);
    logger.info('Job scheduler initialized');
  } else {
    logger.info('Job scheduler disabled');
  }

  // Initialize worker
  worker = new ScraperWorker(
    entityResolver,
    clickhouseClient,
    redisConnection,
    logger
  );

  logger.info('All services initialized successfully');
}

async function startServices(): Promise<void> {
  logger.info('Starting scraper worker services...');

  try {
    // Test Redis connection
    await redisConnection.ping();
    logger.info('Redis connection established');

    // Start metrics collection
    startMetricsCollection();

    logger.info('✅ Scraper worker started successfully');

  } catch (error) {
    logger.error('Failed to start services', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

// Start periodic metrics collection
function startMetricsCollection(): void {
  const interval = setInterval(async () => {
    try {
      if (isShuttingDown) {
        clearInterval(interval);
        return;
      }

      // Collect queue metrics
      const queueStats = await queueManager.getQueueStats('scraper');
      metricsService.updateQueueMetrics(
        queueStats.waiting + queueStats.active + queueStats.completed + queueStats.failed + queueStats.delayed,
        queueStats.waiting,
        queueStats.active
      );

      // Clean old data points (keep last 24 hours)
      metricsService.cleanOldDataPoints(24 * 60 * 60 * 1000);
      errorHandler.clearOldErrors(24 * 60 * 60 * 1000);

    } catch (error) {
      logger.warn('Metrics collection error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, 30000); // Every 30 seconds
}

// Health check function
async function healthCheck(): Promise<{ healthy: boolean; details: any }> {
  const details: any = {
    timestamp: new Date().toISOString(),
    services: {},
    metrics: metricsService.getScraperMetrics(),
    errors: errorHandler.getStats(),
  };

  let healthy = true;

  try {
    // Check ClickHouse
    await clickhouseClient.ping();
    details.services.clickhouse = { status: 'healthy' };
  } catch (error) {
    healthy = false;
    details.services.clickhouse = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  try {
    // Check Redis
    await redisConnection.ping();
    details.services.redis = { status: 'healthy' };
  } catch (error) {
    healthy = false;
    details.services.redis = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Worker status
  details.services.worker = worker.getStats();

  // Rate limiter status
  details.services.rateLimiters = rateLimiter.getStats();

  // Scheduler status
  if (scheduler) {
    details.services.scheduler = scheduler.getJobStats();
  }

  return { healthy, details };
}

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info(`🛑 Received ${signal}, starting graceful shutdown...`);

  const shutdownTimeout = setTimeout(() => {
    logger.error('Shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, 30000); // 30 second timeout

  try {
    // Stop accepting new jobs
    if (scheduler) {
      await scheduler.shutdown();
      logger.info('Scheduler shutdown complete');
    }

    // Shutdown worker
    if (worker) {
      await worker.shutdown();
      logger.info('Worker shutdown complete');
    }

    // Shutdown rate limiters
    if (rateLimiter) {
      await rateLimiter.shutdown();
      logger.info('Rate limiters shutdown complete');
    }

    // Close queue manager
    if (queueManager) {
      await queueManager.shutdown();
      logger.info('Queue manager shutdown complete');
    }

    // Close ClickHouse client
    if (clickhouseClient) {
      await clickhouseClient.close();
      logger.info('ClickHouse client closed');
    }

    clearTimeout(shutdownTimeout);
    logger.info('✅ Graceful shutdown completed');
    process.exit(0);

  } catch (error) {
    clearTimeout(shutdownTimeout);
    logger.error('Error during shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Setup signal handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  if (logger) {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  if (logger) {
    logger.error('Unhandled rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  }
  process.exit(1);
});

// Validation
function validateConfiguration(): void {
  const required = ['SETLISTFM_API_KEY'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Warn about optional configurations
  const optional = ['SONGKICK_API_KEY', 'BANDSINTOWN_API_KEY'];
  const missingOptional = optional.filter(key => !process.env[key]);

  if (missingOptional.length > 0) {
    console.warn(`⚠️  Optional environment variables not set: ${missingOptional.join(', ')}`);
  }
}

// Main function
async function main(): Promise<void> {
  try {
    // Validate configuration
    validateConfiguration();

    // Initialize services
    await initializeServices();

    // Start services
    await startServices();

    // Log startup information
    logger.info('🎵 Gigz Scraper Worker is ready', {
      pid: process.pid,
      nodeVersion: process.version,
      environment: config.NODE_ENV,
      workerConcurrency: config.WORKER_CONCURRENCY,
      batchSize: config.BATCH_SIZE,
      schedulerEnabled: config.SCHEDULER_ENABLED,
    });

    // Setup health check endpoint (if needed for monitoring)
    // This could be expanded to include an HTTP server for health checks
    setInterval(async () => {
      const health = await healthCheck();
      if (!health.healthy) {
        logger.warn('Health check failed', health.details);
      }
    }, 60000); // Every minute

  } catch (error) {
    console.error('❌ Failed to start scraper worker:', error);
    process.exit(1);
  }
}

// Start the application
if (import.meta.main) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for testing
export {
  initializeServices,
  startServices,
  healthCheck,
  shutdown,
};
