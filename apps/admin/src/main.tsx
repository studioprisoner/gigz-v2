import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { router } from './router';
import { getQueryClient } from './lib/query-client';
import { trpc, coretrpc } from './lib/trpc';
import { httpBatchLink } from '@trpc/client';

import './styles/globals.css';

// Create clients
const queryClient = getQueryClient();
const trpcClient = trpc.createClient({
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

const coreTrpcClient = coretrpc.createClient({
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

function App() {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <coretrpc.Provider client={coreTrpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </coretrpc.Provider>
    </trpc.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);