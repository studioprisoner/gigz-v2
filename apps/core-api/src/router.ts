import { router } from '@gigz/trpc';
import { usersRouter } from './routers/users';
import { attendanceRouter } from './routers/attendance';
import { friendshipsRouter } from './routers/friendships';

export const coreRouter = router({
  users: usersRouter,
  attendance: attendanceRouter,
  friendships: friendshipsRouter,
});

export type CoreRouter = typeof coreRouter;