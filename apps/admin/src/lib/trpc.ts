import { createTRPCReact } from '@trpc/react-query';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@gigz/trpc';

// Create the tRPC React client
export const trpc = createTRPCReact<AppRouter>();

// Create a vanilla tRPC client for direct calls
export const trpcVanilla = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3001/trpc', // Gateway URL
      headers() {
        const token = localStorage.getItem('admin-token');
        return {
          authorization: token ? `Bearer ${token}` : '',
        };
      },
    }),
  ],
});
