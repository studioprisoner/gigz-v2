import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { generateOpenApiDocument } from 'trpc-openapi';
import { concertApiRouter } from './router';

// Simple logger for now
const logger = {
  info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta || ''),
  error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta || ''),
};

// Simple config for now
const config = {
  CONCERT_API_PORT: process.env.CONCERT_API_PORT || 3003,
  NODE_ENV: process.env.NODE_ENV || 'development',
};

// Generate OpenAPI document
const openApiDocument = generateOpenApiDocument(concertApiRouter, {
  title: 'Gigz Concert API',
  description: 'High-performance ClickHouse-based API for concert data, artist information, venues, and analytics',
  version: '1.0.0',
  baseUrl: `http://localhost:${config.CONCERT_API_PORT}`,
  tags: ['Artists', 'Venues', 'Concerts', 'Statistics'],
});

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// Create the main request handler
const server = Bun.serve({
  port: config.CONCERT_API_PORT || 3003,
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      try {
        // Check ClickHouse health (Redis check removed for now)
        const clickhouseHealthy = await checkClickHouseHealth();
        const redisHealthy = true; // Placeholder until Redis is implemented

        const healthy = clickhouseHealthy && redisHealthy;

        return new Response(
          JSON.stringify({
            status: healthy ? 'healthy' : 'unhealthy',
            services: {
              clickhouse: clickhouseHealthy ? 'up' : 'down',
              redis: redisHealthy ? 'up' : 'down',
            },
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
          }),
          {
            status: healthy ? 200 : 503,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      } catch (error) {
        logger.error('Health check failed', { error });
        return new Response(
          JSON.stringify({
            status: 'unhealthy',
            error: 'Health check failed',
            timestamp: new Date().toISOString(),
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }
    }

    // OpenAPI documentation endpoint
    if (url.pathname === '/openapi.json') {
      return new Response(JSON.stringify(openApiDocument, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    // API documentation endpoint
    if (url.pathname === '/docs' || url.pathname === '/') {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Gigz Concert API Documentation</title>
            <meta charset="utf-8"/>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui.css" />
          </head>
          <body>
            <div id="swagger-ui"></div>
            <script src="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui-bundle.js"></script>
            <script>
              SwaggerUIBundle({
                url: '/openapi.json',
                dom_id: '#swagger-ui',
                presets: [
                  SwaggerUIBundle.presets.apis,
                  SwaggerUIBundle.presets.standalone
                ],
                layout: "StandaloneLayout"
              });
            </script>
          </body>
        </html>
      `;

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html',
          ...corsHeaders,
        },
      });
    }

    // tRPC request handler
    if (url.pathname.startsWith('/trpc/')) {
      return fetchRequestHandler({
        endpoint: '/trpc',
        req: request,
        router: concertApiRouter,
        createContext: () => ({} as any),
        onError: ({ error, path }) => {
          logger.error('tRPC error', {
            path,
            code: error.code,
            message: error.message,
            cause: error.cause,
          });
        },
        responseMeta: () => {
          return {
            headers: corsHeaders,
          };
        },
      });
    }

    // 404 for all other routes
    return new Response('Not Found', {
      status: 404,
      headers: corsHeaders,
    });
  },

  error(error: Error) {
    logger.error('Server error', { error: error.message, stack: error.stack });
    return new Response('Internal Server Error', { status: 500 });
  },
});

// Graceful shutdown handler
const shutdown = async () => {
  logger.info('Shutting down Concert API server...');

  try {
    server.stop(true);
    logger.info('Concert API server stopped successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during Concert API server shutdown', { error });
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Helper function to check ClickHouse health
async function checkClickHouseHealth(): Promise<boolean> {
  try {
    const { query } = await import('@gigz/clickhouse');
    const result = await query('SELECT 1 as test');
    return result.length > 0 && (result[0] as any).test === 1;
  } catch (error) {
    logger.error('ClickHouse health check failed', { error });
    return false;
  }
}

logger.info(`🎵 Concert API server started on port ${config.CONCERT_API_PORT}`, {
  port: config.CONCERT_API_PORT,
  environment: config.NODE_ENV,
  docs: `http://localhost:${config.CONCERT_API_PORT}/docs`,
  openapi: `http://localhost:${config.CONCERT_API_PORT}/openapi.json`,
});
