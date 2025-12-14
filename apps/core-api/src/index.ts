import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
// import { createOpenApiHttpHandler } from 'trpc-openapi';
import { coreRouter } from './router';
import { createContext } from './context';

// Environment validation
const requiredEnvVars = [
  'DATABASE_URL',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const PORT = process.env.CORE_API_PORT || 3003;

// OpenAPI handler for REST endpoints - temporarily disabled
// const openApiHandler = createOpenApiHttpHandler({
//   router: coreRouter,
//   createContext,
// });

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        service: 'core-api',
        timestamp: new Date().toISOString(),
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Handle tRPC requests
    if (url.pathname.startsWith('/trpc')) {
      const response = await fetchRequestHandler({
        endpoint: '/trpc',
        req,
        router: coreRouter,
        createContext,
        onError: ({ path, error }) => {
          console.error(`❌ tRPC failed on ${path}:`, error);
        },
      });

      // Add CORS headers to tRPC responses
      response.headers.set('Access-Control-Allow-Origin', '*');
      return response;
    }

    // Handle other requests - OpenAPI disabled temporarily
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
});

console.log(`🚀 Core API running on port ${server.port}`);
console.log(`📋 Health check: http://localhost:${server.port}/health`);
console.log(`🔗 tRPC endpoint: http://localhost:${server.port}/trpc`);
console.log(`📖 OpenAPI endpoints available for REST integration`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down Core API...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down Core API...');
  server.stop();
  process.exit(0);
});