import { router } from '@gigz/trpc';
import { searchRouter } from './routers/search';
import { adminRouter } from './routers/admin';

export const searchApiRouter = router({
  search: searchRouter,
  admin: adminRouter,
});

export type SearchApiRouter = typeof searchApiRouter;