import { router, protectedProcedure, publicProcedure, TRPCError } from '@gigz/trpc';
import { db, users } from '@gigz/db';
import { eq, ilike, or } from 'drizzle-orm';
import { UserSchema } from '@gigz/types';
import { z } from 'zod';
import { canViewProfile, toPublicUser } from '../lib/privacy';
import { getPresignedUploadUrl, generateStorageKey, getPublicUrl, isValidImageType } from '../lib/storage';

// Public user schema (filtered for privacy)
const PublicUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  homeCity: z.string().nullable(),
  homeCountry: z.string().nullable(),
  totalShowsCount: z.number(),
  createdAt: z.date(),
});

export const usersRouter = router({
  // Get current user profile
  me: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/users/me', protect: true, tags: ['Users'] } })
    .input(z.object({}))
    .output(UserSchema)
    .query(async ({ ctx }) => {
      const user = await db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
      
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      
      return {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        profileVisibility: user.profileVisibility || 'friends_only',
        concertCount: user.totalShowsCount || 0,
        createdAt: user.createdAt || new Date(),
        updatedAt: user.updatedAt || new Date(),
      };
    }),

  // Get user by username
  getByUsername: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/users/{username}', tags: ['Users'] } })
    .input(z.object({ username: z.string() }))
    .output(PublicUserSchema)
    .query(async ({ input, ctx }) => {
      const user = await db.query.users.findFirst({
        where: eq(users.username, input.username.toLowerCase()),
      });
      
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      
      // Check visibility permissions
      const canView = await canViewProfile(ctx.user?.id, user);
      if (!canView) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Profile is private' });
      }
      
      return toPublicUser(user);
    }),

  // Update profile
  updateProfile: protectedProcedure
    .meta({ openapi: { method: 'PATCH', path: '/users/me', protect: true, tags: ['Users'] } })
    .input(z.object({
      displayName: z.string().min(1).max(100).optional(),
      bio: z.string().max(500).optional(),
      homeCity: z.string().max(100).optional(),
      homeCountry: z.string().max(100).optional(),
      profileVisibility: z.enum(['public', 'friends_only', 'private']).optional(),
    }))
    .output(UserSchema)
    .mutation(async ({ input, ctx }) => {
      const [updated] = await db.update(users)
        .set({ 
          ...input, 
          updatedAt: new Date() 
        })
        .where(eq(users.id, ctx.user.id))
        .returning();
        
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      
      return {
        id: updated.id,
        email: updated.email,
        username: updated.username,
        displayName: updated.displayName,
        avatarUrl: updated.avatarUrl,
        bio: updated.bio,
        profileVisibility: updated.profileVisibility || 'friends_only',
        concertCount: updated.totalShowsCount || 0,
        createdAt: updated.createdAt || new Date(),
        updatedAt: updated.updatedAt || new Date(),
      };
    }),

  // Get avatar upload URL (returns presigned URL)
  getAvatarUploadUrl: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/users/me/avatar-upload-url', protect: true, tags: ['Users'] } })
    .input(z.object({
      contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    }))
    .output(z.object({
      uploadUrl: z.string(),
      publicUrl: z.string(),
      avatarId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!isValidImageType(input.contentType)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid content type' });
      }
      
      const extension = input.contentType.split('/')[1];
      const key = generateStorageKey('avatars', ctx.user.id, extension);
      const uploadUrl = await getPresignedUploadUrl(key, input.contentType);
      const publicUrl = getPublicUrl(key);
      
      return {
        uploadUrl,
        publicUrl,
        avatarId: key,
      };
    }),

  // Confirm avatar upload and update user record
  confirmAvatarUpload: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/users/me/avatar-confirm', protect: true, tags: ['Users'] } })
    .input(z.object({
      avatarId: z.string(), // The storage key
    }))
    .output(z.object({
      success: z.boolean(),
      avatarUrl: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const publicUrl = getPublicUrl(input.avatarId);
      
      await db.update(users)
        .set({ 
          avatarUrl: publicUrl,
          updatedAt: new Date() 
        })
        .where(eq(users.id, ctx.user.id));
        
      return { success: true, avatarUrl: publicUrl };
    }),

  // Check username availability
  checkUsername: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/users/check-username/{username}', tags: ['Users'] } })
    .input(z.object({ username: z.string().min(3).max(50) }))
    .output(z.object({ available: z.boolean() }))
    .query(async ({ input }) => {
      const existing = await db.query.users.findFirst({
        where: eq(users.username, input.username.toLowerCase()),
      });
      return { available: !existing };
    }),

  // Search users
  search: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/users/search', protect: true, tags: ['Users'] } })
    .input(z.object({
      query: z.string().min(2),
      limit: z.number().min(1).max(50).default(20),
    }))
    .output(z.array(PublicUserSchema))
    .query(async ({ input, ctx }) => {
      // Search by username and display name
      const searchUsers = await db.query.users.findMany({
        where: or(
          ilike(users.username, `%${input.query}%`),
          ilike(users.displayName, `%${input.query}%`)
        ),
        limit: input.limit,
        orderBy: (users, { asc }) => [asc(users.username)],
      });
      
      // Filter out users based on privacy settings
      const filteredUsers = [];
      for (const user of searchUsers) {
        if (user.id === ctx.user.id) continue; // Skip self
        
        const canView = await canViewProfile(ctx.user.id, user);
        if (canView) {
          filteredUsers.push(toPublicUser(user));
        }
      }
      
      return filteredUsers;
    }),

  // Get user stats
  getStats: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/users/{userId}/stats', protect: true, tags: ['Users'] } })
    .input(z.object({ userId: z.string().uuid() }))
    .output(z.object({
      totalConcerts: z.number(),
      uniqueArtists: z.number(),
      uniqueVenues: z.number(),
      friendsCount: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      const targetUserId = input.userId;
      
      // Check if user can view this data
      if (targetUserId !== ctx.user.id) {
        const targetUser = await db.query.users.findFirst({
          where: eq(users.id, targetUserId),
        });
        
        if (!targetUser) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
        }
        
        const canView = await canViewProfile(ctx.user.id, targetUser);
        if (!canView) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot view user stats' });
        }
      }
      
      // Get attendance stats from PostgreSQL
      // These stats would be calculated from attendance records
      // For now, return placeholder data
      return {
        totalConcerts: 0, // TODO: Count from attendances table
        uniqueArtists: 0, // TODO: Count distinct artists from attendances
        uniqueVenues: 0,  // TODO: Count distinct venues from attendances
        friendsCount: 0,  // TODO: Count from friendships table
      };
    }),
});