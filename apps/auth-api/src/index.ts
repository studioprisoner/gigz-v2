import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { authRouter } from './router';
import { createContext } from './context';

// Environment validation
const requiredEnvVars = [
  'JWT_SECRET',
  'APPLE_CLIENT_ID',
  'GOOGLE_CLIENT_ID',
  'DATABASE_URL',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const PORT = process.env.AUTH_API_PORT || 3002;

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
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'auth-api' }), {
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
        router: authRouter,
        createContext,
        onError: ({ path, error }) => {
          console.error(`❌ tRPC failed on ${path}:`, error);
        },
      });

      // Add CORS headers to tRPC responses
      response.headers.set('Access-Control-Allow-Origin', '*');
      return response;
    }

    // 404 for other routes
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
});

console.log(`🚀 Auth API running on port ${server.port}`);
console.log(`📋 Health check: http://localhost:${server.port}/health`);
console.log(`🔑 tRPC endpoint: http://localhost:${server.port}/trpc`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down Auth API...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down Auth API...');
  server.stop();
  process.exit(0);
});