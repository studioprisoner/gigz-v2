import jwt from 'jsonwebtoken';
import { db, refreshTokens } from '@gigz/db';
import { randomBytes, createHash } from 'crypto';
import { eq, and, isNull, gt } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET!;
const ACCESS_TOKEN_EXPIRY = '1h';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

export function generateAccessToken(userId: string): { token: string; expiresIn: number } {
  const expiresIn = 3600; // 1 hour in seconds
  
  const token = jwt.sign(
    { sub: userId, type: 'access' },
    JWT_SECRET,
    { 
      expiresIn: ACCESS_TOKEN_EXPIRY, 
      jwtid: randomBytes(16).toString('hex') 
    }
  );
  
  return { token, expiresIn };
}

export async function generateRefreshToken(userId: string, deviceInfo?: object): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await db.insert(refreshTokens).values({
    userId,
    tokenHash,
    deviceInfo: deviceInfo ? JSON.stringify(deviceInfo) : null,
    expiresAt,
  });

  return token;
}

export async function verifyRefreshToken(token: string) {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  
  const record = await db.query.refreshTokens.findFirst({
    where: and(
      eq(refreshTokens.tokenHash, tokenHash),
      isNull(refreshTokens.revokedAt),
      gt(refreshTokens.expiresAt, new Date())
    ),
  });

  if (!record) {
    throw new Error('Invalid or expired refresh token');
  }
  
  return record;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  
  await db.update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.tokenHash, tokenHash));
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await db.update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(refreshTokens.userId, userId),
      isNull(refreshTokens.revokedAt)
    ));
}

export function verifyAccessToken(token: string): { sub: string; type: string } {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; type: string };
    
    if (payload.type !== 'access') {
      throw new Error('Invalid token type');
    }
    
    return payload;
  } catch (error) {
    throw new Error('Invalid or expired access token');
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function generateTokenPair(userId: string, deviceInfo?: object): Promise<TokenPair> {
  const { token: accessToken, expiresIn } = generateAccessToken(userId);
  const refreshToken = await generateRefreshToken(userId, deviceInfo);
  
  return {
    accessToken,
    refreshToken,
    expiresIn,
  };
}