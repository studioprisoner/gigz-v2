import { router, protectedProcedure, TRPCError } from '@gigz/trpc';
import { db, friendships, followRequests, blockedUsers, users } from '@gigz/db';
import { eq, and, or } from 'drizzle-orm';
import { z } from 'zod';
import { 
  createFriendship, 
  deleteFriendship, 
  getFriendship, 
  isBlocked, 
  hasBlockedUser, 
  hasPendingRequest 
} from '../lib/friendships';
import { toPublicUser } from '../lib/privacy';
import { queueNotification } from '../lib/notifications';

const FriendSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  homeCity: z.string().nullable(),
  homeCountry: z.string().nullable(),
  totalShowsCount: z.number(),
  createdAt: z.date(),
  friendshipCreatedAt: z.date(),
});

const FollowRequestSchema = z.object({
  id: z.string(),
  requesterId: z.string(),
  targetId: z.string(),
  status: z.enum(['pending', 'accepted', 'declined']),
  createdAt: z.date(),
  requester: z.object({
    id: z.string(),
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
});

export const friendshipsRouter = router({
  // List friends
  list: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/friends', protect: true, tags: ['Friendships'] } })
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .output(z.object({
      items: z.array(FriendSchema),
      nextCursor: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      // Query friendships where user is either user_id or friend_id
      const friendshipRecords = await db.query.friendships.findMany({
        where: or(
          eq(friendships.userId, ctx.user.id),
          eq(friendships.friendId, ctx.user.id)
        ),
        limit: input.limit + 1,
        orderBy: (friendships, { desc }) => [desc(friendships.createdAt)],
        with: {
          user: true,
          friend: true,
        },
      });
      
      // Check if there are more records
      const hasMore = friendshipRecords.length > input.limit;
      const items = hasMore ? friendshipRecords.slice(0, -1) : friendshipRecords;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;
      
      // Map to friend objects (the other user in the relationship)
      const friends = items.map(record => {
        const friend = record.userId === ctx.user.id ? record.friend : record.user;
        return {
          ...toPublicUser(friend),
          friendshipCreatedAt: record.createdAt || new Date(),
        };
      });
      
      return {
        items: friends,
        nextCursor,
      };
    }),

  // List pending friend requests (received)
  listPendingRequests: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/friends/requests/pending', protect: true, tags: ['Friendships'] } })
    .output(z.array(FollowRequestSchema))
    .query(async ({ ctx }) => {
      const requests = await db.query.followRequests.findMany({
        where: and(
          eq(followRequests.targetId, ctx.user.id),
          eq(followRequests.status, 'pending')
        ),
        orderBy: (followRequests, { desc }) => [desc(followRequests.createdAt)],
        with: {
          requester: true,
        },
      });
      
      return requests.map(request => ({
        id: request.id,
        requesterId: request.requesterId,
        targetId: request.targetId,
        status: request.status as 'pending',
        createdAt: request.createdAt || new Date(),
        requester: {
          id: request.requester.id,
          username: request.requester.username,
          displayName: request.requester.displayName,
          avatarUrl: request.requester.avatarUrl,
        },
      }));
    }),

  // Send follow request
  sendRequest: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/friends/requests', protect: true, tags: ['Friendships'] } })
    .input(z.object({ userId: z.string().uuid() }))
    .output(z.object({ 
      status: z.enum(['pending', 'accepted']),
      message: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot send friend request to yourself' });
      }
      
      // Check if target user exists
      const targetUser = await db.query.users.findFirst({
        where: eq(users.id, input.userId),
      });
      
      if (!targetUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      
      // Check if blocked
      const blocked = await isBlocked(ctx.user.id, input.userId);
      if (blocked) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot send friend request' });
      }
      
      // Check if already friends
      const existingFriendship = await getFriendship(ctx.user.id, input.userId);
      if (existingFriendship) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Already friends' });
      }
      
      // Check for existing request
      const existingRequest = await hasPendingRequest(ctx.user.id, input.userId);
      if (existingRequest) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Friend request already sent' });
      }
      
      // Check if they sent us a request (auto-accept)
      const theirRequest = await db.query.followRequests.findFirst({
        where: and(
          eq(followRequests.requesterId, input.userId),
          eq(followRequests.targetId, ctx.user.id),
          eq(followRequests.status, 'pending')
        ),
      });
      
      if (theirRequest) {
        // Auto-accept: create friendship
        await createFriendship(ctx.user.id, input.userId);
        
        // Update their request status
        await db.update(followRequests)
          .set({ status: 'accepted', updatedAt: new Date() })
          .where(eq(followRequests.id, theirRequest.id));
        
        // Queue notification for the original requester
        await queueNotification({
          type: 'friend_request_accepted',
          userId: input.userId,
          data: { friendId: ctx.user.id, friendName: ctx.user.username },
        });
        
        return { 
          status: 'accepted' as const, 
          message: 'Friend request accepted automatically' 
        };
      }
      
      // Create new request
      await db.insert(followRequests).values({
        requesterId: ctx.user.id,
        targetId: input.userId,
        status: 'pending',
      });
      
      // Queue notification for the target user
      await queueNotification({
        type: 'friend_request_received',
        userId: input.userId,
        data: { 
          requesterId: ctx.user.id, 
          requesterName: ctx.user.username 
        },
      });
      
      return { 
        status: 'pending' as const, 
        message: 'Friend request sent' 
      };
    }),

  // Accept friend request
  acceptRequest: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/friends/requests/{requestId}/accept', protect: true, tags: ['Friendships'] } })
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const request = await db.query.followRequests.findFirst({
        where: and(
          eq(followRequests.id, input.requestId),
          eq(followRequests.targetId, ctx.user.id),
          eq(followRequests.status, 'pending')
        ),
        with: { requester: true },
      });
      
      if (!request) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Friend request not found' });
      }
      
      // Create friendship
      await createFriendship(ctx.user.id, request.requesterId);
      
      // Update request status
      await db.update(followRequests)
        .set({ status: 'accepted', updatedAt: new Date() })
        .where(eq(followRequests.id, input.requestId));
      
      // Notify the requester
      await queueNotification({
        type: 'friend_request_accepted',
        userId: request.requesterId,
        data: { 
          friendId: ctx.user.id, 
          friendName: ctx.user.username 
        },
      });
      
      return { success: true };
    }),

  // Decline friend request
  declineRequest: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/friends/requests/{requestId}/decline', protect: true, tags: ['Friendships'] } })
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const updated = await db.update(followRequests)
        .set({ status: 'declined', updatedAt: new Date() })
        .where(and(
          eq(followRequests.id, input.requestId),
          eq(followRequests.targetId, ctx.user.id),
          eq(followRequests.status, 'pending')
        ))
        .returning();
      
      if (!updated.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Friend request not found' });
      }
      
      return { success: true };
    }),

  // Remove friend
  remove: protectedProcedure
    .meta({ openapi: { method: 'DELETE', path: '/friends/{userId}', protect: true, tags: ['Friendships'] } })
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const friendship = await getFriendship(ctx.user.id, input.userId);
      if (!friendship) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Friendship not found' });
      }
      
      await deleteFriendship(ctx.user.id, input.userId);
      
      return { success: true };
    }),

  // Block user
  block: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/users/{userId}/block', protect: true, tags: ['Friendships'] } })
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot block yourself' });
      }
      
      // Check if user exists
      const targetUser = await db.query.users.findFirst({
        where: eq(users.id, input.userId),
      });
      
      if (!targetUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      
      // Remove any existing friendship
      await deleteFriendship(ctx.user.id, input.userId);
      
      // Remove pending requests in both directions
      await db.delete(followRequests)
        .where(or(
          and(
            eq(followRequests.requesterId, ctx.user.id), 
            eq(followRequests.targetId, input.userId)
          ),
          and(
            eq(followRequests.requesterId, input.userId), 
            eq(followRequests.targetId, ctx.user.id)
          )
        ));
      
      // Add block record
      await db.insert(blockedUsers).values({
        blockerId: ctx.user.id,
        blockedId: input.userId,
      }).onConflictDoNothing();
      
      return { success: true };
    }),

  // Unblock user
  unblock: protectedProcedure
    .meta({ openapi: { method: 'DELETE', path: '/users/{userId}/block', protect: true, tags: ['Friendships'] } })
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const deleted = await db.delete(blockedUsers)
        .where(and(
          eq(blockedUsers.blockerId, ctx.user.id),
          eq(blockedUsers.blockedId, input.userId)
        ))
        .returning();
      
      if (!deleted.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Block record not found' });
      }
      
      return { success: true };
    }),

  // List blocked users
  listBlocked: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/users/blocked', protect: true, tags: ['Friendships'] } })
    .output(z.array(z.object({
      id: z.string(),
      username: z.string(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
      blockedAt: z.date(),
    })))
    .query(async ({ ctx }) => {
      const blocked = await db.query.blockedUsers.findMany({
        where: eq(blockedUsers.blockerId, ctx.user.id),
        with: { blocked: true },
        orderBy: (blockedUsers, { desc }) => [desc(blockedUsers.createdAt)],
      });
      
      return blocked.map(record => ({
        id: record.blocked.id,
        username: record.blocked.username,
        displayName: record.blocked.displayName,
        avatarUrl: record.blocked.avatarUrl,
        blockedAt: record.createdAt || new Date(),
      }));
    }),

  // Get friendship status with another user
  getStatus: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/friends/{userId}/status', protect: true, tags: ['Friendships'] } })
    .input(z.object({ userId: z.string().uuid() }))
    .output(z.object({
      status: z.enum(['friends', 'pending_sent', 'pending_received', 'blocked', 'none']),
      canSendRequest: z.boolean(),
    }))
    .query(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        return { status: 'none' as const, canSendRequest: false };
      }
      
      // Check if blocked
      const blocked = await hasBlockedUser(ctx.user.id, input.userId);
      if (blocked) {
        return { status: 'blocked' as const, canSendRequest: false };
      }
      
      // Check if they blocked us
      const blockedByThem = await hasBlockedUser(input.userId, ctx.user.id);
      if (blockedByThem) {
        return { status: 'none' as const, canSendRequest: false };
      }
      
      // Check if friends
      const friendship = await getFriendship(ctx.user.id, input.userId);
      if (friendship) {
        return { status: 'friends' as const, canSendRequest: false };
      }
      
      // Check for pending requests
      const sentRequest = await hasPendingRequest(ctx.user.id, input.userId);
      if (sentRequest) {
        return { status: 'pending_sent' as const, canSendRequest: false };
      }
      
      const receivedRequest = await hasPendingRequest(input.userId, ctx.user.id);
      if (receivedRequest) {
        return { status: 'pending_received' as const, canSendRequest: false };
      }
      
      return { status: 'none' as const, canSendRequest: true };
    }),
});