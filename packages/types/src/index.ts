import { z } from 'zod';

// User schema for API responses
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email().nullable(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  profileVisibility: z.string(),
  concertCount: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;

// Auth-specific schemas
export const SignInResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  user: UserSchema,
  isNewUser: z.boolean(),
});

export type SignInResponse = z.infer<typeof SignInResponseSchema>;
