import { router, publicProcedure, protectedProcedure, TRPCError } from '@gigz/trpc';
import { z } from 'zod';
import { UserSchema, SignInResponseSchema } from '@gigz/types';
import { verifyAppleToken } from './lib/apple';
import { verifyGoogleToken } from './lib/google';
import { generateTokenPair, verifyRefreshToken, revokeRefreshToken, revokeAllUserTokens } from './lib/tokens';
import { findOrCreateUser, findUserById, findAdminByEmail, verifyPassword } from './lib/users';
import { db, users } from '@gigz/db';
import { count } from 'drizzle-orm';

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
});