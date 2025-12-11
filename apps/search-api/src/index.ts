import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { generateOpenApiDocument } from 'trpc-openapi';
import { searchApiRouter } from './router';
import { meilisearchService } from './lib/meilisearch';

// Simple logger for now
const logger = {
  info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta || ''),
  error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta || ''),
};

// Simple config for now
const config = {
  SEARCH_API_PORT: process.env.SEARCH_API_PORT || 3004,
  NODE_ENV: process.env.NODE_ENV || 'development',
};

// Generate OpenAPI document
const openApiDocument = generateOpenApiDocument(searchApiRouter, {
  title: 'Gigz Search API',
  description: 'Typo-tolerant search service powered by Meilisearch for artists, venues, concerts, and users',
  version: '1.0.0',
  baseUrl: `http://localhost:${config.SEARCH_API_PORT}`,
  tags: ['Search', 'Admin'],
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
  port: config.SEARCH_API_PORT,
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
        // Check Meilisearch health
        const meilisearchHealthy = await meilisearchService.isHealthy();

        let indexStats = {};
        if (meilisearchHealthy) {
          try {
            indexStats = await meilisearchService.getAllStats();
          } catch (error) {
            // Stats might fail even if Meilisearch is healthy
            indexStats = {};
          }
        }

        const healthy = meilisearchHealthy;

        return new Response(
          JSON.stringify({
            status: healthy ? 'healthy' : 'unhealthy',
            services: {
              meilisearch: meilisearchHealthy ? 'up' : 'down',
            },
            indexes: indexStats,
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
            <title>Gigz Search API Documentation</title>
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
        router: searchApiRouter,
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
  logger.info('Shutting down Search API server...');

  try {
    server.stop(true);
    logger.info('Search API server stopped successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during Search API server shutdown', { error });
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

logger.info(`🔍 Search API server started on port ${config.SEARCH_API_PORT}`, {
  port: config.SEARCH_API_PORT,
  environment: config.NODE_ENV,
  docs: `http://localhost:${config.SEARCH_API_PORT}/docs`,
  openapi: `http://localhost:${config.SEARCH_API_PORT}/openapi.json`,
  meilisearch: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
});
