import { router, publicProcedure, TRPCError } from '@gigz/trpc';
import { z } from 'zod';
import { meilisearchService } from '../lib/meilisearch';
import { ClickHouseDataFetcher, PostgreSQLDataFetcher, BatchProcessor, DataValidator } from '../lib/data-fetchers';

// Simple logger for now
const logger = {
  info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta || ''),
  error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[WARN] ${message}`, meta || ''),
};

// Note: In production, this should be a protectedProcedure with admin role check
// For now, using publicProcedure for testing purposes
export const adminRouter = router({
  // Initialize all indexes with their configurations
  initializeIndexes: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/admin/initialize-indexes',
        tags: ['Admin'],
        summary: 'Initialize Meilisearch indexes'
      }
    })
    .output(z.object({
      success: z.boolean(),
      message: z.string(),
    }))
    .mutation(async () => {
      try {
        await meilisearchService.initializeIndexes();
        return {
          success: true,
          message: 'All indexes initialized successfully',
        };
      } catch (error) {
        logger.error('Failed to initialize indexes', { error });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to initialize indexes',
          cause: error,
        });
      }
    }),

  // Reindex all artists from ClickHouse
  reindexArtists: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/admin/reindex-artists',
        tags: ['Admin'],
        summary: 'Reindex all artists from ClickHouse'
      }
    })
    .output(z.object({
      taskUid: z.number(),
      documentCount: z.number(),
      message: z.string(),
    }))
    .mutation(async () => {
      try {
        logger.info('Starting artists reindex');

        // Fetch all artists from ClickHouse
        const artists = await ClickHouseDataFetcher.fetchAllArtists();
        logger.info(`Fetched ${artists.length} artists from ClickHouse`);

        // Validate documents
        const validArtists = artists.filter(artist => {
          const isValid = DataValidator.validateArtistDocument(artist);
          if (!isValid) {
            logger.warn('Invalid artist document', { artistId: (artist as any).id });
          }
          return isValid;
        });

        logger.info(`${validArtists.length} valid artists after validation`);

        // Clear existing index
        await meilisearchService.clearIndex('artists');

        // Process in batches to avoid overwhelming Meilisearch
        const BATCH_SIZE = 1000;
        let totalProcessed = 0;

        await BatchProcessor.processInBatches(
          validArtists,
          async (batch) => {
            await meilisearchService.addDocuments('artists', batch);
            totalProcessed += batch.length;
            logger.info(`Processed ${totalProcessed}/${validArtists.length} artists`);
          },
          BATCH_SIZE
        );

        // Add all documents and return the final task
        const finalTask = await meilisearchService.addDocuments('artists', []);

        return {
          taskUid: finalTask.taskUid,
          documentCount: validArtists.length,
          message: `Successfully queued ${validArtists.length} artists for indexing`,
        };
      } catch (error) {
        logger.error('Failed to reindex artists', { error });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to reindex artists',
          cause: error,
        });
      }
    }),

  // Reindex all venues from ClickHouse
  reindexVenues: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/admin/reindex-venues',
        tags: ['Admin'],
        summary: 'Reindex all venues from ClickHouse'
      }
    })
    .output(z.object({
      taskUid: z.number(),
      documentCount: z.number(),
      message: z.string(),
    }))
    .mutation(async () => {
      try {
        logger.info('Starting venues reindex');

        const venues = await ClickHouseDataFetcher.fetchAllVenues();
        logger.info(`Fetched ${venues.length} venues from ClickHouse`);

        const validVenues = venues.filter(venue => {
          const isValid = DataValidator.validateVenueDocument(venue);
          if (!isValid) {
            logger.warn('Invalid venue document', { venueId: (venue as any).id });
          }
          return isValid;
        });

        logger.info(`${validVenues.length} valid venues after validation`);

        // Clear existing index
        await meilisearchService.clearIndex('venues');

        // Process in batches
        const BATCH_SIZE = 1000;
        let totalProcessed = 0;

        await BatchProcessor.processInBatches(
          validVenues,
          async (batch) => {
            await meilisearchService.addDocuments('venues', batch);
            totalProcessed += batch.length;
            logger.info(`Processed ${totalProcessed}/${validVenues.length} venues`);
          },
          BATCH_SIZE
        );

        const finalTask = await meilisearchService.addDocuments('venues', []);

        return {
          taskUid: finalTask.taskUid,
          documentCount: validVenues.length,
          message: `Successfully queued ${validVenues.length} venues for indexing`,
        };
      } catch (error) {
        logger.error('Failed to reindex venues', { error });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to reindex venues',
          cause: error,
        });
      }
    }),

  // Reindex concerts from ClickHouse (with optional date range)
  reindexConcerts: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/admin/reindex-concerts',
        tags: ['Admin'],
        summary: 'Reindex concerts from ClickHouse'
      }
    })
    .input(z.object({
      dateFrom: z.string().optional().describe('Start date (ISO string)'),
      dateTo: z.string().optional().describe('End date (ISO string)'),
      clearIndex: z.boolean().default(false).describe('Clear existing index before reindexing'),
    }))
    .output(z.object({
      taskUid: z.number(),
      documentCount: z.number(),
      message: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        logger.info('Starting concerts reindex', { dateFrom: input.dateFrom, dateTo: input.dateTo });

        const concerts = await ClickHouseDataFetcher.fetchConcerts(
          input.dateFrom,
          input.dateTo
        );
        logger.info(`Fetched ${concerts.length} concerts from ClickHouse`);

        const validConcerts = concerts.filter(concert => {
          const isValid = DataValidator.validateConcertDocument(concert);
          if (!isValid) {
            logger.warn('Invalid concert document', { concertId: (concert as any).id });
          }
          return isValid;
        });

        logger.info(`${validConcerts.length} valid concerts after validation`);

        // Clear existing index if requested
        if (input.clearIndex) {
          await meilisearchService.clearIndex('concerts');
        }

        // Process in batches
        const BATCH_SIZE = 1000;
        let totalProcessed = 0;

        await BatchProcessor.processInBatches(
          validConcerts,
          async (batch) => {
            await meilisearchService.addDocuments('concerts', batch);
            totalProcessed += batch.length;
            logger.info(`Processed ${totalProcessed}/${validConcerts.length} concerts`);
          },
          BATCH_SIZE
        );

        const finalTask = await meilisearchService.addDocuments('concerts', []);

        return {
          taskUid: finalTask.taskUid,
          documentCount: validConcerts.length,
          message: `Successfully queued ${validConcerts.length} concerts for indexing`,
        };
      } catch (error) {
        logger.error('Failed to reindex concerts', { error });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to reindex concerts',
          cause: error,
        });
      }
    }),

  // Sync users from PostgreSQL
  syncUsers: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/admin/sync-users',
        tags: ['Admin'],
        summary: 'Sync users from PostgreSQL'
      }
    })
    .output(z.object({
      taskUid: z.number(),
      documentCount: z.number(),
      message: z.string(),
    }))
    .mutation(async () => {
      try {
        logger.info('Starting users sync');

        const users = await PostgreSQLDataFetcher.fetchAllUsers();
        logger.info(`Fetched ${users.length} users from PostgreSQL`);

        const validUsers = users.filter(user => {
          const isValid = DataValidator.validateUserDocument(user);
          if (!isValid) {
            logger.warn('Invalid user document', { userId: (user as any).id });
          }
          return isValid;
        });

        logger.info(`${validUsers.length} valid users after validation`);

        // Clear existing index
        await meilisearchService.clearIndex('users');

        // Process in batches
        const BATCH_SIZE = 1000;
        const task = await meilisearchService.addDocuments('users', validUsers);

        return {
          taskUid: task.taskUid,
          documentCount: validUsers.length,
          message: `Successfully queued ${validUsers.length} users for indexing`,
        };
      } catch (error) {
        logger.error('Failed to sync users', { error });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to sync users',
          cause: error,
        });
      }
    }),

  // Reindex all data sources
  reindexAll: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/admin/reindex-all',
        tags: ['Admin'],
        summary: 'Reindex all data from all sources'
      }
    })
    .output(z.object({
      artists: z.object({ taskUid: z.number(), documentCount: z.number() }),
      venues: z.object({ taskUid: z.number(), documentCount: z.number() }),
      concerts: z.object({ taskUid: z.number(), documentCount: z.number() }),
      users: z.object({ taskUid: z.number(), documentCount: z.number() }),
      message: z.string(),
    }))
    .mutation(async () => {
      try {
        logger.info('Starting full reindex of all data');

        // Initialize indexes first
        await meilisearchService.initializeIndexes();

        // Fetch all data in parallel
        const [artists, venues, concerts, users] = await Promise.all([
          ClickHouseDataFetcher.fetchAllArtists(),
          ClickHouseDataFetcher.fetchAllVenues(),
          ClickHouseDataFetcher.fetchRecentConcerts(365), // Last year of concerts
          PostgreSQLDataFetcher.fetchAllUsers(),
        ]);

        // Validate all data
        const validArtists = artists.filter(DataValidator.validateArtistDocument);
        const validVenues = venues.filter(DataValidator.validateVenueDocument);
        const validConcerts = concerts.filter(DataValidator.validateConcertDocument);
        const validUsers = users.filter(DataValidator.validateUserDocument);

        logger.info('Data validation completed', {
          artists: { total: artists.length, valid: validArtists.length },
          venues: { total: venues.length, valid: validVenues.length },
          concerts: { total: concerts.length, valid: validConcerts.length },
          users: { total: users.length, valid: validUsers.length },
        });

        // Clear all indexes
        await Promise.all([
          meilisearchService.clearIndex('artists'),
          meilisearchService.clearIndex('venues'),
          meilisearchService.clearIndex('concerts'),
          meilisearchService.clearIndex('users'),
        ]);

        // Add documents to all indexes
        const [artistsTask, venuesTask, concertsTask, usersTask] = await Promise.all([
          meilisearchService.addDocuments('artists', validArtists),
          meilisearchService.addDocuments('venues', validVenues),
          meilisearchService.addDocuments('concerts', validConcerts),
          meilisearchService.addDocuments('users', validUsers),
        ]);

        const totalDocuments = validArtists.length + validVenues.length + validConcerts.length + validUsers.length;

        return {
          artists: { taskUid: artistsTask.taskUid, documentCount: validArtists.length },
          venues: { taskUid: venuesTask.taskUid, documentCount: validVenues.length },
          concerts: { taskUid: concertsTask.taskUid, documentCount: validConcerts.length },
          users: { taskUid: usersTask.taskUid, documentCount: validUsers.length },
          message: `Successfully queued ${totalDocuments} total documents for indexing across all indexes`,
        };
      } catch (error) {
        logger.error('Failed to reindex all data', { error });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to reindex all data',
          cause: error,
        });
      }
    }),

  // Get indexing stats for all indexes
  getStats: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/admin/stats',
        tags: ['Admin'],
        summary: 'Get indexing statistics'
      }
    })
    .output(z.object({
      artists: z.object({
        numberOfDocuments: z.number(),
        isIndexing: z.boolean(),
        lastUpdate: z.date().optional(),
      }),
      venues: z.object({
        numberOfDocuments: z.number(),
        isIndexing: z.boolean(),
        lastUpdate: z.date().optional(),
      }),
      concerts: z.object({
        numberOfDocuments: z.number(),
        isIndexing: z.boolean(),
        lastUpdate: z.date().optional(),
      }),
      users: z.object({
        numberOfDocuments: z.number(),
        isIndexing: z.boolean(),
        lastUpdate: z.date().optional(),
      }),
      totalDocuments: z.number(),
    }))
    .query(async () => {
      try {
        const stats = await meilisearchService.getAllStats();

        const formatStats = (indexStats: any) => ({
          numberOfDocuments: indexStats?.numberOfDocuments || 0,
          isIndexing: indexStats?.isIndexing || false,
          lastUpdate: indexStats?.lastUpdate ? new Date(indexStats.lastUpdate) : undefined,
        });

        const formattedStats = {
          artists: formatStats(stats.artists),
          venues: formatStats(stats.venues),
          concerts: formatStats(stats.concerts),
          users: formatStats(stats.users),
          totalDocuments: 0,
        };

        formattedStats.totalDocuments =
          formattedStats.artists.numberOfDocuments +
          formattedStats.venues.numberOfDocuments +
          formattedStats.concerts.numberOfDocuments +
          formattedStats.users.numberOfDocuments;

        return formattedStats;
      } catch (error) {
        logger.error('Failed to get index stats', { error });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get index stats',
          cause: error,
        });
      }
    }),

  // Get task status
  getTaskStatus: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/admin/tasks/{taskUid}',
        tags: ['Admin'],
        summary: 'Get indexing task status'
      }
    })
    .input(z.object({
      taskUid: z.number().describe('Task UID from indexing operation'),
    }))
    .output(z.object({
      uid: z.number(),
      status: z.string(),
      type: z.string(),
      duration: z.string().optional(),
      enqueuedAt: z.date(),
      startedAt: z.date().optional(),
      finishedAt: z.date().optional(),
      error: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const task = await meilisearchService.getTask(input.taskUid);

        return {
          uid: task.uid,
          status: task.status,
          type: task.type,
          duration: task.duration,
          enqueuedAt: new Date(task.enqueuedAt),
          startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
          finishedAt: task.finishedAt ? new Date(task.finishedAt) : undefined,
          error: task.error?.message,
        };
      } catch (error) {
        logger.error('Failed to get task status', { error });
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Task not found',
          cause: error,
        });
      }
    }),

  // Clear a specific index
  clearIndex: publicProcedure
    .meta({
      openapi: {
        method: 'DELETE',
        path: '/admin/indexes/{indexName}',
        tags: ['Admin'],
        summary: 'Clear all documents from an index'
      }
    })
    .input(z.object({
      indexName: z.enum(['artists', 'venues', 'concerts', 'users']).describe('Index to clear'),
    }))
    .output(z.object({
      taskUid: z.number(),
      message: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        const task = await meilisearchService.clearIndex(input.indexName);

        return {
          taskUid: task.taskUid,
          message: `Successfully queued clearing of ${input.indexName} index`,
        };
      } catch (error) {
        logger.error(`Failed to clear ${input.indexName} index`, { error });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to clear ${input.indexName} index`,
          cause: error,
        });
      }
    }),
});