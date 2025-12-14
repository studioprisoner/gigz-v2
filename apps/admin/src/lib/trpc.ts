import { createTRPCReact } from '@trpc/react-query';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { authRouter } from '../../../auth-api/src/router';
import type { coreRouter } from '../../../core-api/src/router';

// Create the tRPC React client for auth
export const trpc = createTRPCReact<typeof authRouter>();

// Create the tRPC React client for core API
export const coretrpc = createTRPCReact<typeof coreRouter>();

// Create a vanilla tRPC client for direct calls to auth API
export const trpcVanilla = createTRPCProxyClient<typeof authRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3002/trpc', // Auth API URL (direct connection)
      headers() {
        const token = localStorage.getItem('admin-token');
        return {
          authorization: token ? `Bearer ${token}` : '',
        };
      },
    }),
  ],
});

// Create a vanilla tRPC client for direct calls to core API
export const coreTrpcVanilla = createTRPCProxyClient<typeof coreRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3003/trpc', // Core API URL (direct connection)
      headers() {
        const token = localStorage.getItem('admin-token');
        return {
          authorization: token ? `Bearer ${token}` : '',
        };
      },
    }),
  ],
});
