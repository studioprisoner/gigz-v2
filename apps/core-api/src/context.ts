import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { db, users } from '@gigz/db';
import { eq } from 'drizzle-orm';

export interface CoreAPIContext {
  user?: {
    id: string;
    email?: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
  };
  req: Request;
}

export async function createContext(opts: FetchCreateContextFnOptions): Promise<CoreAPIContext> {
  const { req } = opts;
  
  // Extract Bearer token from Authorization header
  const authHeader = req.headers.get('authorization');
  let user: CoreAPIContext['user'] = undefined;
  
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    try {
      // In a real implementation, you'd verify the JWT token here
      // For now, we'll assume the token contains the user ID
      // This would integrate with the auth-api service
      
      // Placeholder: extract user ID from token
      // const payload = jwt.verify(token, process.env.JWT_SECRET!);
      // const userId = payload.sub;
      
      // For development, we'll mock this
      // In production, this would verify the JWT and extract the user ID
      console.log('TODO: Implement JWT verification for Core API');
      
    } catch (error) {
      // Invalid token - user remains undefined
      console.log('Invalid or expired token');
    }
  }
  
  return {
    user,
    req,
  };
}