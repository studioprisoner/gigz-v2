export interface Context {
  user?: {
    id: string;
    email?: string;
    username: string;
    displayName?: string;
  };
  req: Request;
}