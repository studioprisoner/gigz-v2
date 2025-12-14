import { router } from '@gigz/trpc';
import { usersRouter } from './routers/users';
import { attendanceRouter } from './routers/attendance';
import { friendshipsRouter } from './routers/friendships';
import { adminRouter } from './routers/admin';

export const coreRouter = router({
  users: usersRouter,
  attendance: attendanceRouter,
  friendships: friendshipsRouter,
  admin: adminRouter,
});

export type CoreRouter = typeof coreRouter;