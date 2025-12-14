import { router } from '@gigz/trpc';
import { adminUsersRouter } from './users';
import { adminSettingsRouter } from './settings';

export const adminRouter = router({
  users: adminUsersRouter,
  settings: adminSettingsRouter,
});

export type AdminRouter = typeof adminRouter;