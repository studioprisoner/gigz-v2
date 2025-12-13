import { createTRPCReact } from '@trpc/react-query';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { authRouter } from '../../../auth-api/src/router';

// Create the tRPC React client
export const trpc = createTRPCReact<typeof authRouter>();

// Create a vanilla tRPC client for direct calls
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
