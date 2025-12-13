import { router, publicProcedure, protectedProcedure, TRPCError } from '@gigz/trpc';
import { z } from 'zod';
import { UserSchema, SignInResponseSchema } from '@gigz/types';
import { verifyAppleToken } from './lib/apple';
import { verifyGoogleToken } from './lib/google';
import { generateTokenPair, verifyRefreshToken, revokeRefreshToken, revokeAllUserTokens } from './lib/tokens';
import { findOrCreateUser, findUserById, findAdminByEmail, verifyPassword } from './lib/users';
import { db, users } from '@gigz/db';
import { count } from 'drizzle-orm';
import { RedisQueueFactory } from '@gigz/redis';

// Initialize queue manager for admin operations
const queueManager = new RedisQueueFactory(process.env.REDIS_URL || 'redis://localhost:6379');

export const authRouter = router({
  // Admin Login
  adminLogin: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/auth/admin/login' } })
    .input(z.object({
      email: z.string().email(),
      password: z.string(),
    }))
    .output(z.object({
      accessToken: z.string(),
      refreshToken: z.string(),
      expiresIn: z.number(),
      user: z.object({
        id: z.string(),
        email: z.string().nullable(),
        username: z.string(),
        displayName: z.string(),
        isAdmin: z.boolean(),
      }),
    }))
    .mutation(async ({ input }) => {
      try {
        // 1. Find admin user by email
        const adminUser = await findAdminByEmail(input.email);

        if (!adminUser || !adminUser.isAdmin) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Invalid credentials',
          });
        }

        // 2. Verify password
        if (!adminUser.passwordHash) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Invalid credentials',
          });
        }

        const isValidPassword = await verifyPassword(input.password, adminUser.passwordHash);

        if (!isValidPassword) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Invalid credentials',
          });
        }

        // 3. Generate tokens
        const tokens = await generateTokenPair(adminUser.id);

        return {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          user: {
            id: adminUser.id,
            email: adminUser.email,
            username: adminUser.username,
            displayName: adminUser.displayName,
            isAdmin: adminUser.isAdmin,
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: error instanceof TRPCError ? error.message : 'Admin login failed',
        });
      }
    }),

  // Apple Sign-In
  signInWithApple: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/auth/apple' } })
    .input(z.object({
      identityToken: z.string(),
      authorizationCode: z.string(),
      user: z.object({
        email: z.string().email().optional(),
        name: z.object({
          firstName: z.string().optional(),
          lastName: z.string().optional(),
        }).optional(),
      }).optional(),
    }))
    .output(SignInResponseSchema)
    .mutation(async ({ input }) => {
      try {
        // 1. Verify Apple identity token
        const appleData = await verifyAppleToken(input.identityToken);
        
        // 2. Extract user info (prefer token data, fallback to provided user data)
        const email = appleData.email || input.user?.email;
        const name = input.user?.name ? 
          `${input.user.name.firstName || ''} ${input.user.name.lastName || ''}`.trim() : 
          undefined;
        
        // 3. Find or create user
        const { user, isNew } = await findOrCreateUser({
          provider: 'apple',
          providerUserId: appleData.appleUserId,
          email,
          name,
        });
        
        // 4. Generate tokens
        const tokens = await generateTokenPair(user.id);
        
        // 5. Return response
        return {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            bio: user.bio,
            profileVisibility: user.profileVisibility || 'friends_only',
            concertCount: 0, // TODO: Calculate from attendance records
            createdAt: user.createdAt || new Date(),
            updatedAt: user.updatedAt || new Date(),
          },
          isNewUser: isNew,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: error instanceof Error ? error.message : 'Apple authentication failed',
        });
      }
    }),

  // Google Sign-In
  signInWithGoogle: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/auth/google' } })
    .input(z.object({
      idToken: z.string(),
    }))
    .output(SignInResponseSchema)
    .mutation(async ({ input }) => {
      try {
        // 1. Verify Google ID token
        const googleData = await verifyGoogleToken(input.idToken);
        
        // 2. Find or create user
        const { user, isNew } = await findOrCreateUser({
          provider: 'google',
          providerUserId: googleData.googleUserId,
          email: googleData.email,
          name: googleData.name,
        });
        
        // 3. Generate tokens
        const tokens = await generateTokenPair(user.id);
        
        // 4. Return response
        return {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            bio: user.bio,
            profileVisibility: user.profileVisibility || 'friends_only',
            concertCount: 0, // TODO: Calculate from attendance records
            createdAt: user.createdAt || new Date(),
            updatedAt: user.updatedAt || new Date(),
          },
          isNewUser: isNew,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: error instanceof Error ? error.message : 'Google authentication failed',
        });
      }
    }),

  // Token Refresh
  refresh: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/auth/refresh' } })
    .input(z.object({
      refreshToken: z.string(),
    }))
    .output(z.object({
      accessToken: z.string(),
      refreshToken: z.string(),
      expiresIn: z.number(),
    }))
    .mutation(async ({ input }) => {
      try {
        // 1. Verify refresh token
        const tokenRecord = await verifyRefreshToken(input.refreshToken);
        
        // 2. Revoke old refresh token
        await revokeRefreshToken(input.refreshToken);
        
        // 3. Generate new token pair
        const tokens = await generateTokenPair(tokenRecord.userId);
        
        return {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired refresh token',
        });
      }
    }),

  // Logout
  logout: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/auth/logout' } })
    .input(z.object({
      refreshToken: z.string().optional(),
      allDevices: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (input.allDevices) {
          // Revoke all refresh tokens for the user
          await revokeAllUserTokens(ctx.user.id);
        } else if (input.refreshToken) {
          // Revoke specific refresh token
          await revokeRefreshToken(input.refreshToken);
        }
        
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to logout',
        });
      }
    }),

  // Admin Dashboard Stats
  adminDashboardStats: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/auth/admin/dashboard/stats' } })
    .output(z.object({
      users: z.object({
        total: z.number(),
        active: z.number(),
        suspended: z.number(),
        monthlyGrowth: z.number(),
      }),
      concerts: z.object({
        total: z.number(),
        verified: z.number(),
        unmatched: z.number(),
        duplicates: z.number(),
      }),
      queues: z.object({
        total: z.number(),
        active: z.number(),
        pending: z.number(),
        failed: z.number(),
      }),
      health: z.object({
        postgresql: z.object({
          healthy: z.boolean(),
          lastCheck: z.string(),
        }),
        redis: z.object({
          healthy: z.boolean(),
          lastCheck: z.string(),
        }),
        clickhouse: z.object({
          healthy: z.boolean(),
          lastCheck: z.string(),
        }),
        meilisearch: z.object({
          healthy: z.boolean(),
          lastCheck: z.string(),
        }),
      }),
      recentActivity: z.object({
        users: z.array(z.object({
          id: z.string(),
          name: z.string(),
          email: z.string().nullable(),
          createdAt: z.string(),
        })),
      }),
    }))
    .query(async ({ ctx }) => {
      // Check if user is admin
      if (!ctx.user.id) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Admin access required',
        });
      }

      const adminUser = await findUserById(ctx.user.id);
      if (!adminUser || !adminUser.isAdmin) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Admin access required',
        });
      }

      // Get user stats
      const [userCount] = await db.select({ count: count() }).from(users);
      const recentUsers = await db.query.users.findMany({
        limit: 5,
        orderBy: (users, { desc }) => [desc(users.createdAt)],
      });

      return {
        users: {
          total: userCount.count,
          active: userCount.count, // For now, assume all users are active
          suspended: 0,
          monthlyGrowth: 12, // Mock value for now
        },
        concerts: {
          total: 0, // No concerts data yet
          verified: 0,
          unmatched: 0,
          duplicates: 0,
        },
        queues: {
          total: 0, // No queue data yet
          active: 0,
          pending: 0,
          failed: 0,
        },
        health: {
          postgresql: {
            healthy: true,
            lastCheck: new Date().toISOString(),
          },
          redis: {
            healthy: true,
            lastCheck: new Date().toISOString(),
          },
          clickhouse: {
            healthy: true,
            lastCheck: new Date().toISOString(),
          },
          meilisearch: {
            healthy: true,
            lastCheck: new Date().toISOString(),
          },
        },
        recentActivity: {
          users: recentUsers.map(user => ({
            id: user.id,
            name: user.displayName,
            email: user.email,
            createdAt: (user.createdAt || new Date()).toISOString(),
          })),
        },
      };
    }),

  // Get current user (for testing auth)
  me: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/auth/me' } })
    .output(UserSchema)
    .query(async ({ ctx }) => {
      const user = await findUserById(ctx.user.id);
      
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }
      
      return {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        profileVisibility: user.profileVisibility || 'friends_only',
        concertCount: 0, // TODO: Calculate from attendance records
        createdAt: user.createdAt || new Date(),
        updatedAt: user.updatedAt || new Date(),
      };
    }),

  // Queue Management Endpoints

  // List all queues
  listQueues: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/auth/admin/queues' } })
    .output(z.object({
      queues: z.array(z.object({
        name: z.string(),
        status: z.enum(['active', 'paused', 'failed']),
        stats: z.object({
          waiting: z.number(),
          active: z.number(),
          completed: z.number(),
          failed: z.number(),
          delayed: z.number(),
          paused: z.number(),
        }),
        workers: z.number(),
        lastActivity: z.string().nullable(),
      })),
    }))
    .query(async ({ ctx }) => {
      // Check admin access
      const adminUser = await findUserById(ctx.user.id);
      if (!adminUser || !adminUser.isAdmin) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Admin access required',
        });
      }

      try {
        // Get all known queues (scraper, notification, etc.)
        const knownQueues = ['scraper', 'notification', 'email', 'webhook'];
        const queueData = [];

        for (const queueName of knownQueues) {
          try {
            const stats = await queueManager.getQueueStats(queueName);
            queueData.push({
              name: queueName,
              status: stats.paused > 0 ? 'paused' : (stats.failed > 0 ? 'failed' : 'active'),
              stats,
              workers: stats.active > 0 ? 1 : 0, // Simple approximation
              lastActivity: new Date().toISOString(),
            });
          } catch (error) {
            // Queue might not exist, skip it
            continue;
          }
        }

        return { queues: queueData };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch queue information',
        });
      }
    }),

  // Get detailed queue information
  getQueueDetails: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/auth/admin/queues/{queueName}' } })
    .input(z.object({ queueName: z.string() }))
    .output(z.object({
      name: z.string(),
      stats: z.object({
        waiting: z.number(),
        active: z.number(),
        completed: z.number(),
        failed: z.number(),
        delayed: z.number(),
        paused: z.number(),
      }),
      jobs: z.object({
        waiting: z.array(z.object({
          id: z.string(),
          name: z.string(),
          data: z.any(),
          timestamp: z.string(),
          delay: z.number().optional(),
          priority: z.number().optional(),
        })),
        active: z.array(z.object({
          id: z.string(),
          name: z.string(),
          data: z.any(),
          timestamp: z.string(),
          processedOn: z.string().optional(),
        })),
        failed: z.array(z.object({
          id: z.string(),
          name: z.string(),
          data: z.any(),
          timestamp: z.string(),
          failedReason: z.string(),
          stacktrace: z.string().optional(),
        })),
        completed: z.array(z.object({
          id: z.string(),
          name: z.string(),
          data: z.any(),
          timestamp: z.string(),
          finishedOn: z.string(),
          returnvalue: z.any().optional(),
        })),
      }),
    }))
    .query(async ({ ctx, input }) => {
      // Check admin access
      const adminUser = await findUserById(ctx.user.id);
      if (!adminUser || !adminUser.isAdmin) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Admin access required',
        });
      }

      try {
        const stats = await queueManager.getQueueStats(input.queueName);
        const jobs = await queueManager.getJobs(input.queueName);

        return {
          name: input.queueName,
          stats,
          jobs: {
            waiting: jobs.waiting.map(job => ({
              id: job.id || '',
              name: job.name,
              data: job.data,
              timestamp: new Date(job.timestamp || Date.now()).toISOString(),
              delay: job.opts?.delay,
              priority: job.opts?.priority,
            })),
            active: jobs.active.map(job => ({
              id: job.id || '',
              name: job.name,
              data: job.data,
              timestamp: new Date(job.timestamp || Date.now()).toISOString(),
              processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : undefined,
            })),
            failed: jobs.failed.map(job => ({
              id: job.id || '',
              name: job.name,
              data: job.data,
              timestamp: new Date(job.timestamp || Date.now()).toISOString(),
              failedReason: job.failedReason || 'Unknown error',
              stacktrace: job.stacktrace,
            })),
            completed: jobs.completed.map(job => ({
              id: job.id || '',
              name: job.name,
              data: job.data,
              timestamp: new Date(job.timestamp || Date.now()).toISOString(),
              finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : new Date().toISOString(),
              returnvalue: job.returnvalue,
            })),
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch details for queue: ${input.queueName}`,
        });
      }
    }),

  // Pause/Resume queue
  toggleQueueStatus: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/auth/admin/queues/{queueName}/toggle' } })
    .input(z.object({
      queueName: z.string(),
      action: z.enum(['pause', 'resume']),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
      newStatus: z.enum(['paused', 'active']),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check admin access
      const adminUser = await findUserById(ctx.user.id);
      if (!adminUser || !adminUser.isAdmin) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Admin access required',
        });
      }

      try {
        if (input.action === 'pause') {
          await queueManager.pauseQueue(input.queueName);
          return {
            success: true,
            message: `Queue ${input.queueName} paused successfully`,
            newStatus: 'paused',
          };
        } else {
          await queueManager.resumeQueue(input.queueName);
          return {
            success: true,
            message: `Queue ${input.queueName} resumed successfully`,
            newStatus: 'active',
          };
        }
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to ${input.action} queue: ${input.queueName}`,
        });
      }
    }),

  // Clear queue jobs
  clearQueue: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/auth/admin/queues/{queueName}/clear' } })
    .input(z.object({
      queueName: z.string(),
      jobType: z.enum(['all', 'waiting', 'completed', 'failed', 'active']),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
      clearedCount: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check admin access
      const adminUser = await findUserById(ctx.user.id);
      if (!adminUser || !adminUser.isAdmin) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Admin access required',
        });
      }

      try {
        const clearedCount = await queueManager.clearJobs(input.queueName, input.jobType);
        return {
          success: true,
          message: `Cleared ${clearedCount} ${input.jobType} jobs from ${input.queueName} queue`,
          clearedCount,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to clear ${input.jobType} jobs from queue: ${input.queueName}`,
        });
      }
    }),

  // Get worker health status
  getWorkerHealth: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/auth/admin/workers/health' } })
    .output(z.object({
      workers: z.array(z.object({
        name: z.string(),
        status: z.enum(['healthy', 'unhealthy', 'unknown']),
        lastSeen: z.string().nullable(),
        processedJobs: z.number(),
        failedJobs: z.number(),
        activeJobs: z.number(),
        memoryUsage: z.object({
          rss: z.number(),
          heapTotal: z.number(),
          heapUsed: z.number(),
          external: z.number(),
        }).optional(),
        uptime: z.number().optional(),
      })),
    }))
    .query(async ({ ctx }) => {
      // Check admin access
      const adminUser = await findUserById(ctx.user.id);
      if (!adminUser || !adminUser.isAdmin) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Admin access required',
        });
      }

      try {
        // This would ideally check actual worker health endpoints
        // For now, return mock data based on queue activity
        const knownWorkers = ['scraper-worker', 'notification-worker'];
        const workers = [];

        for (const workerName of knownWorkers) {
          try {
            const queueName = workerName.replace('-worker', '');
            const stats = await queueManager.getQueueStats(queueName);

            workers.push({
              name: workerName,
              status: 'healthy' as const,
              lastSeen: new Date().toISOString(),
              processedJobs: stats.completed,
              failedJobs: stats.failed,
              activeJobs: stats.active,
              uptime: Math.floor(Math.random() * 86400), // Mock uptime
            });
          } catch (error) {
            workers.push({
              name: workerName,
              status: 'unknown' as const,
              lastSeen: null,
              processedJobs: 0,
              failedJobs: 0,
              activeJobs: 0,
            });
          }
        }

        return { workers };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch worker health information',
        });
      }
    }),

  // List all workers with their control status
  listWorkers: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/auth/admin/workers' } })
    .output(z.object({
      workers: z.array(z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(['scraper', 'notification', 'email', 'general']),
        status: z.enum(['running', 'stopped', 'paused', 'error']),
        enabled: z.boolean(),
        lastActivity: z.string().nullable(),
        processedJobs: z.number(),
        failedJobs: z.number(),
        configuration: z.object({
          concurrency: z.number(),
          rateLimits: z.object({
            requests: z.number(),
            windowMs: z.number(),
          }).optional(),
        }),
      })),
    }))
    .query(async ({ ctx }) => {
      // Check admin access
      const adminUser = await findUserById(ctx.user.id);
      if (!adminUser || !adminUser.isAdmin) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Admin access required',
        });
      }

      try {
        // Define the actual worker applications that exist in the codebase
        const definedWorkers = [
          // Scraper Worker - contains multiple scrapers
          {
            id: 'scraper-setlistfm',
            name: 'Setlist.fm Scraper',
            type: 'scraper' as const,
            queueName: 'scraper-setlistfm',
            description: 'Scrapes concert data from Setlist.fm API'
          },
          {
            id: 'scraper-songkick',
            name: 'Songkick Scraper',
            type: 'scraper' as const,
            queueName: 'scraper-songkick',
            description: 'Scrapes concert data from Songkick API (planned)'
          },
          {
            id: 'scraper-bandsintown',
            name: 'Bandsintown Scraper',
            type: 'scraper' as const,
            queueName: 'scraper-bandsintown',
            description: 'Scrapes concert data from Bandsintown API (planned)'
          },
          // Notification Worker
          {
            id: 'notification-push',
            name: 'Push Notification Worker',
            type: 'notification' as const,
            queueName: 'notifications-push',
            description: 'Handles push notifications to mobile devices'
          },
          {
            id: 'notification-email',
            name: 'Email Notification Worker',
            type: 'email' as const,
            queueName: 'notifications-email',
            description: 'Handles email notifications and digests'
          }
        ];

        const workers = [];

        // For each defined worker, check its queue status
        for (const workerDef of definedWorkers) {
          let queueStats;
          let status: 'running' | 'stopped' | 'paused' | 'error' = 'stopped';
          let lastActivity: string | null = null;
          let processedJobs = 0;
          let failedJobs = 0;

          try {
            // Try to get queue stats if the queue exists
            queueStats = await queueManager.getStats(workerDef.queueName);

            // Determine status based on queue activity
            if (queueStats.active > 0) {
              status = 'running';
              lastActivity = new Date().toISOString();
            } else if (queueStats.waiting > 0) {
              status = 'paused'; // Has jobs but not processing
            } else if (queueStats.failed > 50) { // Threshold for error state
              status = 'error';
            }

            processedJobs = queueStats.completed;
            failedJobs = queueStats.failed;

            if (queueStats.completed > 0 || queueStats.failed > 0) {
              lastActivity = new Date().toISOString(); // Approximate last activity
            }
          } catch (error) {
            // Queue doesn't exist or can't be accessed - worker is stopped
            status = 'stopped';
          }

          workers.push({
            id: workerDef.id,
            name: workerDef.name,
            type: workerDef.type,
            status,
            enabled: false, // Default disabled - workers need to be explicitly enabled
            lastActivity,
            processedJobs,
            failedJobs,
            configuration: {
              concurrency: 1, // Default, can be configured per worker
            },
          });
        }

        return { workers };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch worker information',
        });
      }
    }),

  // Control worker (start, stop, pause, resume)
  controlWorker: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/auth/admin/workers/{workerId}/control' } })
    .input(z.object({
      workerId: z.string(),
      action: z.enum(['start', 'stop', 'pause', 'resume', 'restart']),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
      newStatus: z.enum(['running', 'stopped', 'paused', 'error']),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check admin access
      const adminUser = await findUserById(ctx.user.id);
      if (!adminUser || !adminUser.isAdmin) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Admin access required',
        });
      }

      try {
        // Map worker IDs to queue names
        const workerToQueue: Record<string, string> = {
          'scraper-setlistfm': 'scraper-setlistfm',
          'scraper-songkick': 'scraper-songkick',
          'scraper-bandsintown': 'scraper-bandsintown',
          'notification-push': 'notifications-push',
          'notification-email': 'notifications-email'
        };

        const queueName = workerToQueue[input.workerId];
        if (!queueName) {
          throw new Error(`Unknown worker: ${input.workerId}`);
        }

        let newStatus: 'running' | 'stopped' | 'paused' | 'error';
        let message: string;

        switch (input.action) {
          case 'start':
          case 'resume':
            await queueManager.resumeQueue(queueName);
            newStatus = 'running';
            message = `Worker ${input.workerId} started successfully`;
            break;
          case 'stop':
          case 'pause':
            await queueManager.pauseQueue(queueName);
            newStatus = 'paused';
            message = `Worker ${input.workerId} paused successfully`;
            break;
          case 'restart':
            await queueManager.pauseQueue(queueName);
            await queueManager.resumeQueue(queueName);
            newStatus = 'running';
            message = `Worker ${input.workerId} restarted successfully`;
            break;
          default:
            throw new Error(`Unknown action: ${input.action}`);
        }

        return {
          success: true,
          message,
          newStatus,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to ${input.action} worker: ${input.workerId}`,
        });
      }
    }),

  // Update worker configuration
  updateWorkerConfig: protectedProcedure
    .meta({ openapi: { method: 'PUT', path: '/auth/admin/workers/{workerId}/config' } })
    .input(z.object({
      workerId: z.string(),
      configuration: z.object({
        concurrency: z.number().min(1).max(10).optional(),
        enabled: z.boolean().optional(),
        rateLimits: z.object({
          requests: z.number().min(1).optional(),
          windowMs: z.number().min(1000).optional(),
        }).optional(),
      }),
    }))
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check admin access
      const adminUser = await findUserById(ctx.user.id);
      if (!adminUser || !adminUser.isAdmin) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Admin access required',
        });
      }

      try {
        // Map worker IDs to queue names
        const workerToQueue: Record<string, string> = {
          'scraper-setlistfm': 'scraper-setlistfm',
          'scraper-songkick': 'scraper-songkick',
          'scraper-bandsintown': 'scraper-bandsintown',
          'notification-push': 'notifications-push',
          'notification-email': 'notifications-email'
        };

        const queueName = workerToQueue[input.workerId];
        if (!queueName) {
          throw new Error(`Unknown worker: ${input.workerId}`);
        }

        // Update queue configuration if provided
        if (input.configuration.concurrency !== undefined) {
          // This would update the queue concurrency settings
          console.log(`[WORKER CONFIG] Setting concurrency to ${input.configuration.concurrency} for queue ${queueName}`);
        }

        if (input.configuration.enabled !== undefined) {
          // Enable/disable the worker by pausing/resuming the queue
          if (input.configuration.enabled) {
            await queueManager.resumeQueue(queueName);
          } else {
            await queueManager.pauseQueue(queueName);
          }
        }

        return {
          success: true,
          message: `Worker ${input.workerId} configuration updated successfully`,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update worker configuration: ${input.workerId}`,
        });
      }
    }),

  // Get worker logs
  getWorkerLogs: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/auth/admin/workers/{workerId}/logs' } })
    .input(z.object({
      workerId: z.string(),
      limit: z.number().min(1).max(1000).default(100),
      level: z.enum(['error', 'warn', 'info', 'debug']).optional(),
    }))
    .output(z.object({
      logs: z.array(z.object({
        timestamp: z.string(),
        level: z.enum(['error', 'warn', 'info', 'debug']),
        message: z.string(),
        data: z.any().optional(),
      })),
    }))
    .query(async ({ ctx, input }) => {
      // Check admin access
      const adminUser = await findUserById(ctx.user.id);
      if (!adminUser || !adminUser.isAdmin) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Admin access required',
        });
      }

      try {
        // Map worker IDs to queue names
        const workerToQueue: Record<string, string> = {
          'scraper-setlistfm': 'scraper-setlistfm',
          'scraper-songkick': 'scraper-songkick',
          'scraper-bandsintown': 'scraper-bandsintown',
          'notification-push': 'notifications-push',
          'notification-email': 'notifications-email'
        };

        const queueName = workerToQueue[input.workerId];
        if (!queueName) {
          throw new Error(`Unknown worker: ${input.workerId}`);
        }

        // In production, this would fetch logs from a centralized logging system
        // For now, return empty logs as no centralized logging is implemented
        const logs: Array<{
          timestamp: string;
          level: 'error' | 'warn' | 'info' | 'debug';
          message: string;
          data?: any;
        }> = [];

        return { logs };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to fetch logs for worker: ${input.workerId}`,
        });
      }
    }),
});