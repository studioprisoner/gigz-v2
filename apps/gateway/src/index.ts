import { pino } from 'pino';
import { GatewayRateLimiter } from './services/rate-limiter.js';
import { CorsHandler, isPreflightRequest } from './services/cors.js';
import { GatewayRouter } from './services/router.js';
import { GatewayLogger, extractUserIdFromRequest } from './services/logger.js';
import { GatewayHealthMonitor } from './services/health.js';

// Environment validation
const requiredEnvVars = [
  'NODE_ENV',
  'PORT',
  'REDIS_URL',
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Configuration
const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  redis: {
    url: process.env.REDIS_URL!,
  },
  gateway: {
    timeout: Number(process.env.GATEWAY_TIMEOUT) || 30000,
    maxBodySize: Number(process.env.MAX_BODY_SIZE) || 10 * 1024 * 1024, // 10MB
  },
  cors: {
    origins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : undefined,
  },
  rateLimiting: {
    enabled: process.env.RATE_LIMITING_ENABLED !== 'false',
    anonymousRequestsPerMinute: Number(process.env.RATE_LIMIT_ANONYMOUS) || 60,
    authenticatedRequestsPerMinute: Number(process.env.RATE_LIMIT_AUTHENTICATED) || 300,
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
let redisClient: any;
let rateLimiter: GatewayRateLimiter;
let corsHandler: CorsHandler;
let router: GatewayRouter;
let gatewayLogger: GatewayLogger;
let healthMonitor: GatewayHealthMonitor;
let isShuttingDown = false;

// Initialize services
async function initializeServices(): Promise<void> {
  try {
    logger.info('Initializing API Gateway services...');

    // Initialize Redis client (placeholder)
    // TODO: Replace with actual Redis client initialization
    redisClient = {
      ping: async () => 'PONG',
      pipeline: () => ({
        zremrangebyscore: () => {},
        zcard: () => {},
        expire: () => {},
        exec: async () => [[null, 0], [null, 0], [null, 'OK']],
      }),
      zadd: async () => 1,
      zcount: async () => 0,
      keys: async () => [],
      zremrangebyscore: async () => 0,
      lpush: async () => 1,
      ltrim: async () => 'OK',
      lrange: async () => [],
    };

    // Initialize rate limiter
    rateLimiter = new GatewayRateLimiter(redisClient, logger);
    logger.info('Rate limiter initialized');

    // Initialize CORS handler
    corsHandler = new CorsHandler(config.cors, logger);
    logger.info('CORS handler initialized');

    // Initialize router
    router = new GatewayRouter(undefined, logger);
    logger.info('Router initialized');

    // Initialize gateway logger
    gatewayLogger = new GatewayLogger(logger);
    logger.info('Gateway logger initialized');

    // Initialize health monitor
    healthMonitor = new GatewayHealthMonitor(
      router,
      redisClient,
      rateLimiter,
      gatewayLogger,
      logger
    );
    logger.info('Health monitor initialized');

    logger.info('All API Gateway services initialized successfully');

  } catch (error) {
    logger.error('Failed to initialize services', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

// Main request handler
async function handleRequest(request: Request): Promise<Response> {
  const requestStart = Date.now();
  const url = new URL(request.url);

  // Extract user ID for logging and rate limiting
  const userId = extractUserIdFromRequest(request);

  // Log incoming request
  const requestId = gatewayLogger.logRequest(request, userId);

  try {
    // Health check endpoints (always accessible)
    if (url.pathname === '/health') {
      const health = await healthMonitor.getHealthStatus();
      return Response.json(health, {
        status: health.status === 'healthy' ? 200 : 503,
        headers: {
          'X-Request-ID': requestId,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    }

    if (url.pathname === '/health/ready') {
      const readiness = await healthMonitor.getReadinessCheck();
      return Response.json(readiness, {
        status: readiness.ready ? 200 : 503,
        headers: {
          'X-Request-ID': requestId,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    }

    if (url.pathname === '/health/live') {
      const liveness = healthMonitor.getLivenessCheck();
      return Response.json(liveness, {
        status: liveness.alive ? 200 : 503,
        headers: {
          'X-Request-ID': requestId,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    }

    // Monitoring endpoint
    if (url.pathname === '/metrics') {
      const stats = await healthMonitor.getMonitoringStats();
      return Response.json(stats, {
        headers: {
          'X-Request-ID': requestId,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    }

    // Handle CORS preflight requests
    if (isPreflightRequest(request)) {
      gatewayLogger.logCors(requestId, request.headers.get('origin'), true, 'preflight');
      return corsHandler.handlePreflight(request);
    }

    // Rate limiting check
    if (config.rateLimiting.enabled) {
      const rateLimitResult = await rateLimiter.checkRateLimit(request, userId);

      if (!rateLimitResult.allowed) {
        gatewayLogger.logRateLimit(
          requestId,
          userId || 'anonymous',
          rateLimitResult.remaining,
          rateLimitResult.resetTime
        );

        const response = new Response('Too Many Requests', {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(rateLimitResult.retryAfter || 60),
            'X-RateLimit-Remaining': String(rateLimitResult.remaining),
            'X-RateLimit-Reset': rateLimitResult.resetTime.toISOString(),
            'X-Request-ID': requestId,
          },
        });

        gatewayLogger.logResponse(requestId, response);
        return corsHandler.addCorsHeaders(request, response);
      }
    }

    // Find route for request
    const routeMatch = router.findRoute(url.pathname);

    if (!routeMatch) {
      const response = new Response(
        JSON.stringify({
          error: 'Not Found',
          message: 'No route found for this path',
          path: url.pathname,
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': requestId,
          },
        }
      );

      gatewayLogger.logResponse(requestId, response);
      return corsHandler.addCorsHeaders(request, response);
    }

    // Check if route requires authentication (placeholder)
    if (!routeMatch.config.public && !userId) {
      const response = new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: 'Authentication required for this endpoint',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer',
            'X-Request-ID': requestId,
          },
        }
      );

      gatewayLogger.logAuth(requestId, undefined, false, 'missing_token');
      gatewayLogger.logResponse(requestId, response);
      return corsHandler.addCorsHeaders(request, response);
    }

    // Proxy request to target service
    const proxyResult = await router.proxyRequest(request, routeMatch);

    // Record request for rate limiting
    if (config.rateLimiting.enabled) {
      await rateLimiter.recordRequest(request, userId, proxyResult.response.status);
    }

    // Add gateway headers
    const responseHeaders = new Headers(proxyResult.response.headers);
    responseHeaders.set('X-Request-ID', requestId);
    responseHeaders.set('X-Gateway-Duration', String(Date.now() - requestStart));
    responseHeaders.set('X-Upstream-Duration', String(proxyResult.duration));
    responseHeaders.set('X-Upstream-Target', proxyResult.target);

    if (proxyResult.retries > 0) {
      responseHeaders.set('X-Upstream-Retries', String(proxyResult.retries));
    }

    const finalResponse = new Response(proxyResult.response.body, {
      status: proxyResult.response.status,
      statusText: proxyResult.response.statusText,
      headers: responseHeaders,
    });

    // Log successful response
    gatewayLogger.logResponse(requestId, finalResponse, proxyResult.target, proxyResult.retries);

    // Add CORS headers
    return corsHandler.addCorsHeaders(request, finalResponse);

  } catch (error) {
    const err = error as Error;

    // Log error
    gatewayLogger.logError(requestId, err);

    // Create error response
    const errorResponse = new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        message: config.nodeEnv === 'development' ? err.message : 'An unexpected error occurred',
        requestId,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
        },
      }
    );

    return corsHandler.addCorsHeaders(request, errorResponse);
  }
}

// Create and start the server
async function startServer(): Promise<void> {
  try {
    // Initialize all services
    await initializeServices();

    // Create Bun server
    const server = Bun.serve({
      port: config.port,
      fetch: handleRequest,
      error(error) {
        logger.error('Server error', {
          error: error.message,
          stack: error.stack,
        });

        return new Response('Internal Server Error', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        });
      },
    });

    logger.info('API Gateway started successfully', {
      port: config.port,
      environment: config.nodeEnv,
      rateLimitingEnabled: config.rateLimiting.enabled,
      corsEnabled: true,
    });

    logger.info('Available endpoints:');
    logger.info('  GET  /health - Comprehensive health check');
    logger.info('  GET  /health/ready - Readiness probe');
    logger.info('  GET  /health/live - Liveness probe');
    logger.info('  GET  /metrics - Monitoring statistics');
    logger.info('  *    /* - Proxy to backend services');

    // Log routing configuration
    const routes = router.getRoutes();
    logger.info('Configured routes:');
    for (const [path, config] of Object.entries(routes)) {
      logger.info(`  ${path} -> ${config.target} (${config.public ? 'public' : 'private'})`);
    }

  } catch (error) {
    logger.fatal('Failed to start API Gateway', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Graceful shutdown handler
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    // Give ongoing requests time to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Close Redis connection
    if (redisClient && redisClient.disconnect) {
      await redisClient.disconnect();
    }

    logger.info('API Gateway shutdown complete');
    process.exit(0);

  } catch (error) {
    logger.error('Error during shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal('Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  process.exit(1);
});

// Start the server
startServer();
