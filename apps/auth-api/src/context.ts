import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { verifyAccessToken } from './lib/tokens';
import { findUserById } from './lib/users';

export interface Context {
  user?: {
    id: string;
    email?: string;
    username: string;
    displayName?: string;
  };
  req: Request;
}

export async function createContext(opts: FetchCreateContextFnOptions): Promise<Context> {
  const { req } = opts;
  
  // Extract Bearer token from Authorization header
  const authHeader = req.headers.get('authorization');
  let user: Context['user'] = undefined;
  
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    try {
      const payload = verifyAccessToken(token);
      const userData = await findUserById(payload.sub);
      
      if (userData) {
        user = {
          id: userData.id,
          email: userData.email || undefined,
          username: userData.username,
          displayName: userData.displayName || undefined,
        };
      }
    } catch (error) {
      // Invalid token - user remains undefined
    }
  }
  
  return {
    user,
    req,
  };
}