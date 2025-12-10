import { db, friendships, blockedUsers, followRequests } from '@gigz/db';
import { eq, and, or } from 'drizzle-orm';

// Ensure consistent ordering for friendship records
// Always store with smaller UUID first to avoid duplicates
export async function createFriendship(userA: string, userB: string) {
  const [userId, friendId] = userA < userB ? [userA, userB] : [userB, userA];
  
  await db.insert(friendships).values({
    userId,
    friendId,
  }).onConflictDoNothing();
}

export async function deleteFriendship(userA: string, userB: string) {
  const [userId, friendId] = userA < userB ? [userA, userB] : [userB, userA];
  
  await db.delete(friendships)
    .where(and(
      eq(friendships.userId, userId),
      eq(friendships.friendId, friendId)
    ));
}

export async function getFriendship(userA: string, userB: string) {
  const [userId, friendId] = userA < userB ? [userA, userB] : [userB, userA];
  
  return db.query.friendships.findFirst({
    where: and(
      eq(friendships.userId, userId),
      eq(friendships.friendId, friendId)
    ),
  });
}

export async function areFriends(userA: string, userB: string): Promise<boolean> {
  const friendship = await getFriendship(userA, userB);
  return !!friendship;
}

export async function isBlocked(userA: string, userB: string): Promise<boolean> {
  const block = await db.query.blockedUsers.findFirst({
    where: or(
      and(eq(blockedUsers.blockerId, userA), eq(blockedUsers.blockedId, userB)),
      and(eq(blockedUsers.blockerId, userB), eq(blockedUsers.blockedId, userA))
    ),
  });
  return !!block;
}

export async function hasBlockedUser(blockerId: string, blockedId: string): Promise<boolean> {
  const block = await db.query.blockedUsers.findFirst({
    where: and(
      eq(blockedUsers.blockerId, blockerId),
      eq(blockedUsers.blockedId, blockedId)
    ),
  });
  return !!block;
}

export async function hasPendingRequest(requesterId: string, targetId: string): Promise<boolean> {
  const request = await db.query.followRequests.findFirst({
    where: and(
      eq(followRequests.requesterId, requesterId),
      eq(followRequests.targetId, targetId),
      eq(followRequests.status, 'pending')
    ),
  });
  return !!request;
}