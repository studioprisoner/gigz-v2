import { z } from 'zod';
import { router, protectedProcedure, TRPCError } from '@gigz/trpc';
import { scraperSettings, type ScraperSettings } from '@gigz/redis';
import { users } from '@gigz/db';
import { eq } from 'drizzle-orm';
import { db } from '@gigz/db';

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

const serviceConfigSchema = z.object({
  enabled: z.boolean().optional(),
  rateLimit: z.number().min(0.1).max(100).optional(),
  dailyQuota: z.number().min(0).max(100000).optional(),
  priority: z.number().min(1).max(10).optional(),
});

export const adminSettingsRouter = router({
  // Get all settings
  getScraperSettings: adminProcedure.query(async () => {
    return scraperSettings.get();
  }),

  // Update a specific service
  updateService: adminProcedure
    .input(z.object({
      service: z.enum(['setlistfm', 'spotify', 'musicbrainz', 'bandsintown', 'songkick']),
      config: serviceConfigSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      await scraperSettings.setService(input.service, input.config, ctx.adminId);

      // Log the action for audit trail
      console.log(`[ADMIN] ${ctx.adminId} updated ${input.service} service:`, input.config);

      return { success: true };
    }),

  // Toggle service on/off (quick action)
  toggleService: adminProcedure
    .input(z.object({
      service: z.enum(['setlistfm', 'spotify', 'musicbrainz', 'bandsintown', 'songkick']),
      enabled: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      await scraperSettings.setService(input.service, { enabled: input.enabled }, ctx.adminId);

      console.log(`[ADMIN] ${ctx.adminId} ${input.enabled ? 'enabled' : 'disabled'} ${input.service} service`);

      return { success: true };
    }),

  // Global maintenance mode
  toggleMaintenanceMode: adminProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await scraperSettings.toggleMaintenanceMode(input.enabled, ctx.adminId);

      console.log(`[ADMIN] ${ctx.adminId} ${input.enabled ? 'enabled' : 'disabled'} maintenance mode`);

      return { success: true };
    }),

  // Update global settings
  updateGlobalSettings: adminProcedure
    .input(z.object({
      maxConcurrentJobs: z.number().min(1).max(50).optional(),
      retryFailedJobs: z.boolean().optional(),
      retryDelayMinutes: z.number().min(1).max(1440).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await scraperSettings.updateGlobalSettings(input, ctx.adminId);

      console.log(`[ADMIN] ${ctx.adminId} updated global settings:`, input);

      return { success: true };
    }),

  // Get audit log
  getSettingsAuditLog: adminProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ input }) => {
      return scraperSettings.getAuditLog(input.limit);
    }),

  // Get service status (convenience method)
  getServiceStatus: adminProcedure
    .input(z.object({
      service: z.enum(['setlistfm', 'spotify', 'musicbrainz', 'bandsintown', 'songkick'])
    }))
    .query(async ({ input }) => {
      const config = await scraperSettings.getService(input.service);
      const isEnabled = await scraperSettings.isServiceEnabled(input.service);

      return {
        ...config,
        actuallyEnabled: isEnabled, // This considers maintenance mode
      };
    }),
});