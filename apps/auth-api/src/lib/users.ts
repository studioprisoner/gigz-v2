import { db, users, userIdentities } from '@gigz/db';
import { eq, and } from 'drizzle-orm';
import { generateUsername } from './username';

export interface CreateUserParams {
  provider: 'apple' | 'google';
  providerUserId: string;
  email?: string;
  name?: string;
}

export interface UserResult {
  user: typeof users.$inferSelect;
  isNew: boolean;
}

export async function findOrCreateUser(params: CreateUserParams): Promise<UserResult> {
  // Check if identity already exists
  const existingIdentity = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.provider, params.provider),
      eq(userIdentities.providerUserId, params.providerUserId)
    ),
    with: { user: true },
  });

  if (existingIdentity) {
    return { user: existingIdentity.user, isNew: false };
  }

  // Check if email matches existing user (for linking identities)
  if (params.email) {
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, params.email),
    });

    if (existingUser) {
      // Link new identity to existing user
      await db.insert(userIdentities).values({
        userId: existingUser.id,
        provider: params.provider,
        providerUserId: params.providerUserId,
        email: params.email,
      });
      return { user: existingUser, isNew: false };
    }
  }

  // Create new user
  const username = await generateUsername(params.name || params.email);
  
  const [newUser] = await db.insert(users).values({
    email: params.email,
    username,
    displayName: params.name || username,
  }).returning();

  // Create identity record
  await db.insert(userIdentities).values({
    userId: newUser.id,
    provider: params.provider,
    providerUserId: params.providerUserId,
    email: params.email,
  });

  return { user: newUser, isNew: true };
}

export async function findUserById(userId: string) {
  return await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
}

export async function findUserByIdentity(provider: string, providerUserId: string) {
  const identity = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.provider, provider),
      eq(userIdentities.providerUserId, providerUserId)
    ),
    with: { user: true },
  });
  
  return identity?.user;
}