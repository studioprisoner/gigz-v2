import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const middleware = t.middleware;

// Base procedures
export const publicProcedure = t.procedure;

// Auth middleware
const enforceUserIsAuthed = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }

  return next({
    ctx: {
      user: ctx.user,
    },
  });
});

// Protected procedure requiring authentication
export const protectedProcedure = publicProcedure.use(enforceUserIsAuthed);

// Re-export TRPCError for use in routers
export { TRPCError };

// Context type for reuse
export type { Context };
