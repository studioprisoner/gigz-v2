import { router, publicProcedure, protectedProcedure, TRPCError } from '@gigz/trpc';
import { z } from 'zod';
import { meilisearchService } from '../lib/meilisearch';

// Result schemas
const ArtistResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  image_url: z.string().nullable(),
  spotify_id: z.string().nullable(),
  concerts_count: z.number(),
  verified: z.boolean(),
});

const VenueResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  city: z.string(),
  country: z.string(),
  capacity: z.number().nullable(),
  concerts_count: z.number(),
  _geo: z.object({
    lat: z.number(),
    lng: z.number(),
  }).nullable(),
});

const ConcertResultSchema = z.object({
  id: z.string(),
  artist_id: z.string(),
  artist_name: z.string(),
  venue_id: z.string(),
  venue_name: z.string(),
  city: z.string(),
  country: z.string(),
  date: z.number(),
  date_display: z.string(),
  tour_name: z.string().nullable(),
  attendance_count: z.number(),
  _geo: z.object({
    lat: z.number(),
    lng: z.number(),
  }).nullable(),
});

const UserResultSchema = z.object({
  id: z.string(),
  username: z.string(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
  total_shows_count: z.number(),
  profile_visibility: z.string(),
});

const SuggestionSchema = z.object({
  type: z.enum(['artist', 'venue', 'concert', 'user']),
  id: z.string(),
  label: z.string(),
});

export const searchRouter = router({
  // Global search across all indexes
  global: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/search',
        tags: ['Search'],
        summary: 'Search across all content types',
        description: 'Performs a global search across artists, venues, and concerts'
      }
    })
    .input(z.object({
      query: z.string().min(1).max(100).describe('Search query'),
      limit: z.number().min(1).max(20).default(5).describe('Results per category'),
    }))
    .output(z.object({
      artists: z.array(ArtistResultSchema),
      venues: z.array(VenueResultSchema),
      concerts: z.array(ConcertResultSchema),
    }))
    .query(async ({ input }) => {
      try {
        const results = await meilisearchService.multiSearch([
          { indexUid: 'artists', q: input.query, limit: input.limit },
          { indexUid: 'venues', q: input.query, limit: input.limit },
          { indexUid: 'concerts', q: input.query, limit: input.limit },
        ]);

        return {
          artists: results.results[0]?.hits as any[] || [],
          venues: results.results[1]?.hits as any[] || [],
          concerts: results.results[2]?.hits as any[] || [],
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Search failed',
          cause: error,
        });
      }
    }),

  // Search artists
  artists: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/search/artists',
        tags: ['Search'],
        summary: 'Search artists',
        description: 'Search for artists with filtering and sorting options'
      }
    })
    .input(z.object({
      query: z.string().min(1).max(100).describe('Search query'),
      verified: z.boolean().optional().describe('Filter by verified status'),
      limit: z.number().min(1).max(100).default(20).describe('Maximum results'),
      offset: z.number().min(0).default(0).describe('Result offset'),
    }))
    .output(z.object({
      hits: z.array(ArtistResultSchema),
      totalHits: z.number(),
      processingTimeMs: z.number(),
      query: z.string(),
    }))
    .query(async ({ input }) => {
      try {
        const filters: string[] = [];
        if (input.verified !== undefined) {
          filters.push(`verified = ${input.verified}`);
        }

        const results = await meilisearchService.getIndex('artists').search(input.query, {
          limit: input.limit,
          offset: input.offset,
          filter: filters.length ? filters.join(' AND ') : undefined,
          sort: ['concerts_count:desc'],
        });

        return {
          hits: results.hits as any[],
          totalHits: results.estimatedTotalHits || 0,
          processingTimeMs: results.processingTimeMs,
          query: input.query,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Artist search failed',
          cause: error,
        });
      }
    }),

  // Search venues
  venues: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/search/venues',
        tags: ['Search'],
        summary: 'Search venues',
        description: 'Search for venues with location and capacity filtering'
      }
    })
    .input(z.object({
      query: z.string().min(1).max(100).describe('Search query'),
      city: z.string().optional().describe('Filter by city'),
      country: z.string().optional().describe('Filter by country'),
      nearLat: z.number().min(-90).max(90).optional().describe('Latitude for geo search'),
      nearLng: z.number().min(-180).max(180).optional().describe('Longitude for geo search'),
      radiusKm: z.number().min(0.1).max(1000).optional().describe('Search radius in kilometers'),
      minCapacity: z.number().min(1).optional().describe('Minimum venue capacity'),
      maxCapacity: z.number().min(1).optional().describe('Maximum venue capacity'),
      limit: z.number().min(1).max(100).default(20).describe('Maximum results'),
      offset: z.number().min(0).default(0).describe('Result offset'),
    }))
    .output(z.object({
      hits: z.array(VenueResultSchema),
      totalHits: z.number(),
      processingTimeMs: z.number(),
      query: z.string(),
    }))
    .query(async ({ input }) => {
      try {
        const filters: string[] = [];

        if (input.city) {
          filters.push(`city = "${input.city}"`);
        }

        if (input.country) {
          filters.push(`country = "${input.country}"`);
        }

        if (input.nearLat !== undefined && input.nearLng !== undefined && input.radiusKm) {
          filters.push(`_geoRadius(${input.nearLat}, ${input.nearLng}, ${input.radiusKm * 1000})`);
        }

        if (input.minCapacity) {
          filters.push(`capacity >= ${input.minCapacity}`);
        }

        if (input.maxCapacity) {
          filters.push(`capacity <= ${input.maxCapacity}`);
        }

        const results = await meilisearchService.getIndex('venues').search(input.query, {
          limit: input.limit,
          offset: input.offset,
          filter: filters.length ? filters.join(' AND ') : undefined,
          sort: ['concerts_count:desc'],
        });

        return {
          hits: results.hits as any[],
          totalHits: results.estimatedTotalHits || 0,
          processingTimeMs: results.processingTimeMs,
          query: input.query,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Venue search failed',
          cause: error,
        });
      }
    }),

  // Search concerts
  concerts: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/search/concerts',
        tags: ['Search'],
        summary: 'Search concerts',
        description: 'Search for concerts with date, location, and artist/venue filtering'
      }
    })
    .input(z.object({
      query: z.string().min(1).max(100).describe('Search query'),
      artistId: z.string().uuid().optional().describe('Filter by artist ID'),
      venueId: z.string().uuid().optional().describe('Filter by venue ID'),
      city: z.string().optional().describe('Filter by city'),
      country: z.string().optional().describe('Filter by country'),
      dateFrom: z.string().optional().describe('Filter from date (ISO string)'),
      dateTo: z.string().optional().describe('Filter to date (ISO string)'),
      upcoming: z.boolean().optional().describe('Filter for upcoming concerts only'),
      limit: z.number().min(1).max(100).default(20).describe('Maximum results'),
      offset: z.number().min(0).default(0).describe('Result offset'),
    }))
    .output(z.object({
      hits: z.array(ConcertResultSchema),
      totalHits: z.number(),
      processingTimeMs: z.number(),
      query: z.string(),
    }))
    .query(async ({ input }) => {
      try {
        const filters: string[] = [];

        if (input.artistId) {
          filters.push(`artist_id = "${input.artistId}"`);
        }

        if (input.venueId) {
          filters.push(`venue_id = "${input.venueId}"`);
        }

        if (input.city) {
          filters.push(`city = "${input.city}"`);
        }

        if (input.country) {
          filters.push(`country = "${input.country}"`);
        }

        if (input.dateFrom) {
          const fromTimestamp = new Date(input.dateFrom).getTime();
          filters.push(`date >= ${fromTimestamp}`);
        }

        if (input.dateTo) {
          const toTimestamp = new Date(input.dateTo).getTime();
          filters.push(`date <= ${toTimestamp}`);
        }

        if (input.upcoming) {
          const nowTimestamp = Date.now();
          filters.push(`date >= ${nowTimestamp}`);
        }

        const sortOrder = input.upcoming ? ['date:asc'] : ['date:desc'];

        const results = await meilisearchService.getIndex('concerts').search(input.query, {
          limit: input.limit,
          offset: input.offset,
          filter: filters.length ? filters.join(' AND ') : undefined,
          sort: sortOrder,
        });

        return {
          hits: results.hits as any[],
          totalHits: results.estimatedTotalHits || 0,
          processingTimeMs: results.processingTimeMs,
          query: input.query,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Concert search failed',
          cause: error,
        });
      }
    }),

  // Search users (protected - only for authenticated users)
  users: protectedProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/search/users',
        protect: true,
        tags: ['Search'],
        summary: 'Search users',
        description: 'Search for users (authenticated users only)'
      }
    })
    .input(z.object({
      query: z.string().min(2).max(50).describe('Search query (minimum 2 characters)'),
      limit: z.number().min(1).max(50).default(20).describe('Maximum results'),
      offset: z.number().min(0).default(0).describe('Result offset'),
    }))
    .output(z.object({
      hits: z.array(UserResultSchema),
      totalHits: z.number(),
      processingTimeMs: z.number(),
      query: z.string(),
    }))
    .query(async ({ input }) => {
      try {
        const results = await meilisearchService.getIndex('users').search(input.query, {
          limit: input.limit,
          offset: input.offset,
          filter: 'profile_visibility != "private"',
          sort: ['total_shows_count:desc'],
        });

        return {
          hits: results.hits as any[],
          totalHits: results.estimatedTotalHits || 0,
          processingTimeMs: results.processingTimeMs,
          query: input.query,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'User search failed',
          cause: error,
        });
      }
    }),

  // Autocomplete/suggestions
  suggest: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/search/suggest',
        tags: ['Search'],
        summary: 'Get search suggestions',
        description: 'Get autocomplete suggestions for search queries'
      }
    })
    .input(z.object({
      query: z.string().min(1).max(50).describe('Search query for suggestions'),
      type: z.enum(['artists', 'venues', 'all']).default('all').describe('Type of suggestions'),
      limit: z.number().min(1).max(10).default(5).describe('Maximum suggestions'),
    }))
    .output(z.array(SuggestionSchema))
    .query(async ({ input }) => {
      try {
        if (input.type === 'all') {
          const suggestions = await meilisearchService.getSuggestions(
            input.query,
            ['artists', 'venues'],
            input.limit
          );
          return suggestions as Array<{ type: 'artist' | 'venue' | 'concert' | 'user'; id: string; label: string; }>;
        } else {
          const suggestions = await meilisearchService.getSuggestions(
            input.query,
            [input.type],
            input.limit
          );
          return suggestions as Array<{ type: 'artist' | 'venue' | 'concert' | 'user'; id: string; label: string; }>;
        }
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Suggestions failed',
          cause: error,
        });
      }
    }),

  // Search health check
  health: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/search/health',
        tags: ['Search'],
        summary: 'Search service health check'
      }
    })
    .output(z.object({
      status: z.enum(['healthy', 'unhealthy']),
      meilisearch: z.boolean(),
      indexes: z.record(z.object({
        numberOfDocuments: z.number(),
        isIndexing: z.boolean(),
      })),
      timestamp: z.date(),
    }))
    .query(async () => {
      try {
        const meilisearchHealthy = await meilisearchService.isHealthy();

        let indexStats = {};
        if (meilisearchHealthy) {
          try {
            const stats = await meilisearchService.getAllStats();
            indexStats = Object.entries(stats).reduce((acc, [key, stat]) => {
              acc[key] = {
                numberOfDocuments: stat.numberOfDocuments || 0,
                isIndexing: stat.isIndexing || false,
              };
              return acc;
            }, {} as Record<string, any>);
          } catch (error) {
            // Stats might fail even if Meilisearch is healthy
            indexStats = {};
          }
        }

        return {
          status: meilisearchHealthy ? 'healthy' as const : 'unhealthy' as const,
          meilisearch: meilisearchHealthy,
          indexes: indexStats,
          timestamp: new Date(),
        };
      } catch (error) {
        return {
          status: 'unhealthy' as const,
          meilisearch: false,
          indexes: {},
          timestamp: new Date(),
        };
      }
    }),
});