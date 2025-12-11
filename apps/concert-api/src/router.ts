import { router } from '@gigz/trpc';
import { artistsRouter } from './routers/artists';
import { venuesRouter } from './routers/venues';
import { concertsRouter } from './routers/concerts';
import { statsRouter } from './routers/stats';

export const concertApiRouter = router({
  artists: artistsRouter,
  venues: venuesRouter,
  concerts: concertsRouter,
  stats: statsRouter,
});

export type ConcertApiRouter = typeof concertApiRouter;