import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

interface AppleTokenPayload {
  sub: string;
  email?: string;
  email_verified?: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
}

const client = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache: true,
  cacheMaxAge: 86400000, // 24 hours
});

export async function verifyAppleToken(identityToken: string) {
  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded || !decoded.header.kid) {
    throw new Error('Invalid Apple token: missing key ID');
  }

  const key = await client.getSigningKey(decoded.header.kid);
  const publicKey = key.getPublicKey();

  const verified = jwt.verify(identityToken, publicKey, {
    algorithms: ['RS256'],
    issuer: 'https://appleid.apple.com',
    audience: process.env.APPLE_CLIENT_ID,
  }) as AppleTokenPayload;

  return {
    appleUserId: verified.sub,
    email: verified.email,
    emailVerified: verified.email_verified === 'true',
  };
}

export interface AppleUserData {
  appleUserId: string;
  email?: string;
  emailVerified: boolean;
}