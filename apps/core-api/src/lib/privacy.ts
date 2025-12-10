import { users } from '@gigz/db';
import { areFriends, isBlocked } from './friendships';

export type ProfileVisibility = 'public' | 'friends_only' | 'private';

interface User {
  id: string;
  profileVisibility: string | null;
}

export async function canViewProfile(viewerId: string | undefined, targetUser: User): Promise<boolean> {
  // If no viewer (public request), check if profile is public
  if (!viewerId) {
    return targetUser.profileVisibility === 'public';
  }
  
  // User can always view their own profile
  if (viewerId === targetUser.id) {
    return true;
  }
  
  // Check if blocked
  const blocked = await isBlocked(viewerId, targetUser.id);
  if (blocked) {
    return false;
  }
  
  // Check visibility settings
  const visibility = (targetUser.profileVisibility as ProfileVisibility) || 'friends_only';
  
  switch (visibility) {
    case 'public':
      return true;
    case 'friends_only':
      return await areFriends(viewerId, targetUser.id);
    case 'private':
      return false;
    default:
      return false;
  }
}

export async function canViewAttendance(viewerId: string | undefined, targetUserId: string): Promise<boolean> {
  // If no viewer (public request), cannot view attendance
  if (!viewerId) {
    return false;
  }
  
  // User can always view their own attendance
  if (viewerId === targetUserId) {
    return true;
  }
  
  // Check if blocked
  const blocked = await isBlocked(viewerId, targetUserId);
  if (blocked) {
    return false;
  }
  
  // Can only view friends' attendance
  return await areFriends(viewerId, targetUserId);
}

export function toPublicUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    homeCity: user.homeCity,
    homeCountry: user.homeCountry,
    totalShowsCount: user.totalShowsCount || 0,
    createdAt: user.createdAt,
  };
}