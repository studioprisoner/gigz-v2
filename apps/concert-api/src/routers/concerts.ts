import { router, publicProcedure, TRPCError } from '@gigz/trpc';
import { query } from '@gigz/clickhouse';
import { z } from 'zod';
import { CacheService } from '../lib/cache';

const ConcertSchema = z.object({
  id: z.string(),
  artistId: z.string(),
  artistName: z.string(),
  venueId: z.string(),
  venueName: z.string(),
  city: z.string(),
  state: z.string().nullable(),
  country: z.string(),
  date: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  ticketPrice: z.number().nullable(),
  currency: z.string().nullable(),
  attendanceCount: z.number(),
  capacity: z.number().nullable(),
  genres: z.array(z.string()).nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  tourName: z.string().nullable(),
  setlistUrl: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const ConcertSummarySchema = z.object({
  id: z.string(),
  artistName: z.string(),
  venueName: z.string(),
  city: z.string(),
  country: z.string(),
  date: z.string(),
  attendanceCount: z.number(),
});

export const concertsRouter = router({
  // Search concerts with advanced filtering
  search: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/concerts/search', tags: ['Concerts'] } })
    .input(z.object({
      query: z.string().min(1).max(100).optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
      artistName: z.string().optional(),
      venueName: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      genres: z.array(z.string()).optional(),
      tourName: z.string().optional(),
      minPrice: z.number().optional(),
      maxPrice: z.number().optional(),
    }))
    .output(z.object({
      concerts: z.array(ConcertSchema),
      total: z.number(),
      hasMore: z.boolean(),
    }))
    .query(async ({ input }) => {
      // Check cache first
      const cached = await CacheService.getSearchResults('concert', input.query || 'all', input);
      if (cached) {
        return cached;
      }

      // Build search conditions
      const conditions: string[] = [];
      const queryParams: Record<string, any> = {};

      // General text search
      if (input.query) {
        conditions.push(`(
          positionCaseInsensitive(artist_name, {query:String}) > 0 OR
          positionCaseInsensitive(venue_name, {query:String}) > 0 OR
          positionCaseInsensitive(city, {query:String}) > 0 OR
          positionCaseInsensitive(tour_name, {query:String}) > 0 OR
          positionCaseInsensitive(description, {query:String}) > 0
        )`);
        queryParams.query = input.query;
      }

      // Date range filters
      if (input.dateFrom) {
        conditions.push('date >= {dateFrom:Date}');
        queryParams.dateFrom = input.dateFrom.toISOString().split('T')[0];
      }

      if (input.dateTo) {
        conditions.push('date <= {dateTo:Date}');
        queryParams.dateTo = input.dateTo.toISOString().split('T')[0];
      }

      // Specific filters
      if (input.artistName) {
        conditions.push('positionCaseInsensitive(artist_name, {artistName:String}) > 0');
        queryParams.artistName = input.artistName;
      }

      if (input.venueName) {
        conditions.push('positionCaseInsensitive(venue_name, {venueName:String}) > 0');
        queryParams.venueName = input.venueName;
      }

      if (input.city) {
        conditions.push('city = {city:String}');
        queryParams.city = input.city;
      }

      if (input.country) {
        conditions.push('country = {country:String}');
        queryParams.country = input.country;
      }

      if (input.tourName) {
        conditions.push('positionCaseInsensitive(tour_name, {tourName:String}) > 0');
        queryParams.tourName = input.tourName;
      }

      // Genre filter
      if (input.genres && input.genres.length > 0) {
        conditions.push('arrayExists(genre -> genre IN {genres:Array(String)}, genres)');
        queryParams.genres = input.genres;
      }

      // Price range filters
      if (input.minPrice) {
        conditions.push('ticket_price >= {minPrice:Float64}');
        queryParams.minPrice = input.minPrice;
      }

      if (input.maxPrice) {
        conditions.push('ticket_price <= {maxPrice:Float64}');
        queryParams.maxPrice = input.maxPrice;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get total count
      const countSql = `
        SELECT count() as total
        FROM concerts
        ${whereClause}
      `;

      const countResult = await query<{ total: number }>(countSql, queryParams);
      const total = countResult[0]?.total || 0;

      // Get paginated results
      const sql = `
        SELECT
          id,
          artist_id as artistId,
          artist_name as artistName,
          venue_id as venueId,
          venue_name as venueName,
          city,
          state,
          country,
          date,
          start_time as startTime,
          end_time as endTime,
          ticket_price as ticketPrice,
          currency,
          attendance_count as attendanceCount,
          capacity,
          genres,
          description,
          image_url as imageUrl,
          tour_name as tourName,
          setlist_url as setlistUrl,
          created_at as createdAt,
          updated_at as updatedAt
        FROM concerts
        ${whereClause}
        ORDER BY date DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;

      const concerts = await query<any>(sql, queryParams);

      const result = {
        concerts: concerts.map(concert => ({
          ...concert,
          createdAt: new Date(concert.createdAt),
          updatedAt: new Date(concert.updatedAt),
        })),
        total,
        hasMore: input.offset + input.limit < total,
      };

      // Cache the result
      await CacheService.setSearchResults('concert', input.query || 'all', result, input);

      return result;
    }),

  // Get concert by ID
  getById: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/concerts/{id}', tags: ['Concerts'] } })
    .input(z.object({ id: z.string().uuid() }))
    .output(ConcertSchema)
    .query(async ({ input }) => {
      // Check cache first
      const cached = await CacheService.getConcert(input.id);
      if (cached) {
        return cached;
      }

      const sql = `
        SELECT
          id,
          artist_id as artistId,
          artist_name as artistName,
          venue_id as venueId,
          venue_name as venueName,
          city,
          state,
          country,
          date,
          start_time as startTime,
          end_time as endTime,
          ticket_price as ticketPrice,
          currency,
          attendance_count as attendanceCount,
          capacity,
          genres,
          description,
          image_url as imageUrl,
          tour_name as tourName,
          setlist_url as setlistUrl,
          created_at as createdAt,
          updated_at as updatedAt
        FROM concerts
        WHERE id = {id:String}
      `;

      const results = await query<any>(sql, { id: input.id });

      if (results.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Concert not found' });
      }

      const concert = {
        ...results[0],
        createdAt: new Date(results[0].createdAt),
        updatedAt: new Date(results[0].updatedAt),
      };

      // Cache the result
      await CacheService.setConcert(input.id, concert);

      return concert;
    }),

  // Get multiple concerts by IDs (batch operation)
  getByIds: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/concerts/batch', tags: ['Concerts'] } })
    .input(z.object({
      ids: z.array(z.string().uuid()).min(1).max(100),
    }))
    .output(z.array(ConcertSchema))
    .mutation(async ({ input }) => {
      // Try to get from cache first
      const cacheKeys = input.ids.map(id => `concert-api:concert:${id}`);
      const cached = await CacheService.mget(cacheKeys);
      const cachedResults = new Map();
      const missingIds: string[] = [];

      input.ids.forEach((id, index) => {
        if (cached[index]) {
          cachedResults.set(id, cached[index]);
        } else {
          missingIds.push(id);
        }
      });

      let dbResults = [];
      if (missingIds.length > 0) {
        const sql = `
          SELECT
            id,
            artist_id as artistId,
            artist_name as artistName,
            venue_id as venueId,
            venue_name as venueName,
            city,
            state,
            country,
            date,
            start_time as startTime,
            end_time as endTime,
            ticket_price as ticketPrice,
            currency,
            attendance_count as attendanceCount,
            capacity,
            genres,
            description,
            image_url as imageUrl,
            tour_name as tourName,
            setlist_url as setlistUrl,
            created_at as createdAt,
            updated_at as updatedAt
          FROM concerts
          WHERE id IN {ids:Array(String)}
          ORDER BY date DESC
        `;

        dbResults = await query<any>(sql, { ids: missingIds });

        // Cache the new results
        const cacheOperations = dbResults.map(concert => [
          `concert-api:concert:${concert.id}`,
          concert,
          CacheService['TTL'].CONCERT
        ] as [string, any, number]);

        if (cacheOperations.length > 0) {
          await CacheService.mset(cacheOperations);
        }
      }

      // Combine cached and DB results, maintaining order
      const allResults = input.ids.map(id => {
        const cachedResult = cachedResults.get(id);
        if (cachedResult) {
          return cachedResult;
        }

        const dbResult = dbResults.find(concert => concert.id === id);
        return dbResult ? {
          ...dbResult,
          createdAt: new Date(dbResult.createdAt),
          updatedAt: new Date(dbResult.updatedAt),
        } : null;
      }).filter(Boolean);

      return allResults;
    }),

  // Get upcoming concerts
  getUpcoming: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/concerts/upcoming', tags: ['Concerts'] } })
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      daysAhead: z.number().min(1).max(365).default(30),
      country: z.string().optional(),
      city: z.string().optional(),
      genres: z.array(z.string()).optional(),
    }))
    .output(z.object({
      concerts: z.array(ConcertSummarySchema),
      total: z.number(),
      hasMore: z.boolean(),
    }))
    .query(async ({ input }) => {
      const today = new Date();
      const futureDate = new Date(today.getTime() + input.daysAhead * 24 * 60 * 60 * 1000);

      // Build conditions
      const conditions: string[] = [
        'date >= {today:Date}',
        'date <= {futureDate:Date}'
      ];
      const queryParams: Record<string, any> = {
        today: today.toISOString().split('T')[0],
        futureDate: futureDate.toISOString().split('T')[0],
      };

      if (input.country) {
        conditions.push('country = {country:String}');
        queryParams.country = input.country;
      }

      if (input.city) {
        conditions.push('city = {city:String}');
        queryParams.city = input.city;
      }

      if (input.genres && input.genres.length > 0) {
        conditions.push('arrayExists(genre -> genre IN {genres:Array(String)}, genres)');
        queryParams.genres = input.genres;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // Get total count
      const countSql = `
        SELECT count() as total
        FROM concerts
        ${whereClause}
      `;

      const countResult = await query<{ total: number }>(countSql, queryParams);
      const total = countResult[0]?.total || 0;

      // Get paginated results
      const sql = `
        SELECT
          id,
          artist_name as artistName,
          venue_name as venueName,
          city,
          country,
          date,
          attendance_count as attendanceCount
        FROM concerts
        ${whereClause}
        ORDER BY date ASC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;

      const concerts = await query<any>(sql, queryParams);

      return {
        concerts,
        total,
        hasMore: input.offset + input.limit < total,
      };
    }),

  // Get concerts by location and date range (useful for event discovery)
  getByLocationAndDate: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/concerts/location/{country}/{city}', tags: ['Concerts'] } })
    .input(z.object({
      country: z.string().min(1),
      city: z.string().min(1),
      dateFrom: z.date(),
      dateTo: z.date(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      genres: z.array(z.string()).optional(),
    }))
    .output(z.object({
      concerts: z.array(ConcertSummarySchema),
      total: z.number(),
      hasMore: z.boolean(),
    }))
    .query(async ({ input }) => {
      // Build conditions
      const conditions: string[] = [
        'country = {country:String}',
        'city = {city:String}',
        'date >= {dateFrom:Date}',
        'date <= {dateTo:Date}'
      ];
      const queryParams: Record<string, any> = {
        country: input.country,
        city: input.city,
        dateFrom: input.dateFrom.toISOString().split('T')[0],
        dateTo: input.dateTo.toISOString().split('T')[0],
      };

      if (input.genres && input.genres.length > 0) {
        conditions.push('arrayExists(genre -> genre IN {genres:Array(String)}, genres)');
        queryParams.genres = input.genres;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // Get total count
      const countSql = `
        SELECT count() as total
        FROM concerts
        ${whereClause}
      `;

      const countResult = await query<{ total: number }>(countSql, queryParams);
      const total = countResult[0]?.total || 0;

      // Get paginated results
      const sql = `
        SELECT
          id,
          artist_name as artistName,
          venue_name as venueName,
          city,
          country,
          date,
          attendance_count as attendanceCount
        FROM concerts
        ${whereClause}
        ORDER BY date ASC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;

      const concerts = await query<any>(sql, queryParams);

      return {
        concerts,
        total,
        hasMore: input.offset + input.limit < total,
      };
    }),

  // Get concerts by tour
  getByTour: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/concerts/tour/{tourName}', tags: ['Concerts'] } })
    .input(z.object({
      tourName: z.string().min(1),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .output(z.object({
      concerts: z.array(ConcertSummarySchema),
      total: z.number(),
      hasMore: z.boolean(),
    }))
    .query(async ({ input }) => {
      const conditions: string[] = ['positionCaseInsensitive(tour_name, {tourName:String}) > 0'];
      const queryParams: Record<string, any> = { tourName: input.tourName };

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // Get total count
      const countSql = `
        SELECT count() as total
        FROM concerts
        ${whereClause}
      `;

      const countResult = await query<{ total: number }>(countSql, queryParams);
      const total = countResult[0]?.total || 0;

      // Get paginated results
      const sql = `
        SELECT
          id,
          artist_name as artistName,
          venue_name as venueName,
          city,
          country,
          date,
          attendance_count as attendanceCount
        FROM concerts
        ${whereClause}
        ORDER BY date ASC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;

      const concerts = await query<any>(sql, queryParams);

      return {
        concerts,
        total,
        hasMore: input.offset + input.limit < total,
      };
    }),
});