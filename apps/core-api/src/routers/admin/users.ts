import { z } from 'zod';
import { router, protectedProcedure, TRPCError } from '@gigz/trpc';
import { db, users, attendances, friendships } from '@gigz/db';
import { and, or, eq, desc, asc, ilike, isNull, isNotNull, count } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

// Admin procedure that requires admin privileges
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  // Check if user is admin
  const user = await db.query.users.findFirst({
    where: eq(users.id, ctx.user.id),
    columns: { isAdmin: true },
  });

  if (!user?.isAdmin) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin privileges required'
    });
  }

  return next({
    ctx: {
      ...ctx,
      adminId: ctx.user.id,
    },
  });
});

// Placeholder for admin action logging
async function logAdminAction(adminId: string, action: string, metadata: Record<string, any>) {
  console.log('Admin action:', { adminId, action, metadata });
  // TODO: Implement actual admin action logging
}

export const adminUsersRouter = router({
  list: adminProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.enum(['active', 'suspended', 'deleted']).optional(),
      page: z.number().default(1),
      limit: z.number().default(50),
      sortBy: z.enum(['createdAt', 'lastActiveAt', 'totalShowsCount']).default('createdAt'),
      sortOrder: z.enum(['asc', 'desc']).default('desc'),
    }))
    .query(async ({ input }) => {
      const { search, status, page, limit, sortBy, sortOrder } = input;

      const where: SQL[] = [];

      if (search) {
        where.push(or(
          ilike(users.username, `%${search}%`),
          ilike(users.email, `%${search}%`),
          ilike(users.displayName, `%${search}%`),
        )!);
      }

      if (status === 'active') {
        where.push(isNull(users.suspendedAt));
        where.push(isNull(users.deletedAt));
      } else if (status === 'suspended') {
        where.push(isNotNull(users.suspendedAt));
      } else if (status === 'deleted') {
        where.push(isNotNull(users.deletedAt));
      }

      const whereCondition = where.length > 0 ? and(...where) : undefined;

      const [items, totalResult] = await Promise.all([
        db.query.users.findMany({
          where: whereCondition,
          orderBy: [sortOrder === 'desc' ? desc(users[sortBy]) : asc(users[sortBy])],
          limit,
          offset: (page - 1) * limit,
        }),
        db.select({ count: count() }).from(users).where(whereCondition),
      ]);

      return {
        items,
        total: totalResult[0].count,
        page,
        limit
      };
    }),

  getById: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ input }) => {
      const user = await db.query.users.findFirst({
        where: eq(users.id, input.userId),
        with: {
          identities: true,
        },
      });

      if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

      // Get attendance count
      const attendanceCount = await db
        .select({ count: count() })
        .from(attendances)
        .where(eq(attendances.userId, input.userId));

      // Get friend count
      const friendCount = await db
        .select({ count: count() })
        .from(friendships)
        .where(or(
          eq(friendships.userId, input.userId),
          eq(friendships.friendId, input.userId),
        ));

      return {
        ...user,
        attendanceCount: attendanceCount[0].count,
        friendCount: friendCount[0].count,
      };
    }),

  getAttendances: adminProcedure
    .input(z.object({
      userId: z.string().uuid(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const items = await db.query.attendances.findMany({
        where: eq(attendances.userId, input.userId),
        orderBy: [desc(attendances.createdAt)],
        limit: input.limit,
        offset: (input.page - 1) * input.limit,
      });

      return { items };
    }),

  suspend: adminProcedure
    .input(z.object({
      userId: z.string().uuid(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.update(users)
        .set({
          suspendedAt: new Date(),
          suspendedReason: input.reason,
          suspendedBy: ctx.adminId,
        })
        .where(eq(users.id, input.userId));

      await logAdminAction(ctx.adminId, 'suspend_user', { userId: input.userId, reason: input.reason });

      return { success: true };
    }),

  unsuspend: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await db.update(users)
        .set({
          suspendedAt: null,
          suspendedReason: null,
          suspendedBy: null,
        })
        .where(eq(users.id, input.userId));

      await logAdminAction(ctx.adminId, 'unsuspend_user', { userId: input.userId });

      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // Soft delete
      await db.update(users)
        .set({
          deletedAt: new Date(),
          deletedBy: ctx.adminId,
        })
        .where(eq(users.id, input.userId));

      await logAdminAction(ctx.adminId, 'delete_user', { userId: input.userId });

      return { success: true };
    }),
});