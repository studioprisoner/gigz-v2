import { router, publicProcedure, TRPCError } from '@gigz/trpc';
import { query } from '@gigz/clickhouse';
import { z } from 'zod';
import { CacheService } from '../lib/cache';

const ArtistSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).nullable(),
  genres: z.array(z.string()).nullable(),
  country: z.string().nullable(),
  spotifyId: z.string().nullable(),
  musicBrainzId: z.string().nullable(),
  imageUrl: z.string().nullable(),
  biography: z.string().nullable(),
  concertCount: z.number(),
  lastConcertDate: z.date().nullable(),
  createdAt: z.date(),
});

const ArtistConcertSchema = z.object({
  id: z.string(),
  artistName: z.string(),
  venueName: z.string(),
  city: z.string(),
  country: z.string(),
  date: z.string(),
  attendanceCount: z.number(),
});

export const artistsRouter = router({
  // Search artists by name or alias
  search: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/artists/search', tags: ['Artists'] } })
    .input(z.object({
      query: z.string().min(1).max(100),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      country: z.string().optional(),
      genres: z.array(z.string()).optional(),
    }))
    .output(z.object({
      artists: z.array(ArtistSchema),
      total: z.number(),
      hasMore: z.boolean(),
    }))
    .query(async ({ input }) => {
      // Check cache first
      const cacheKey = `search_${JSON.stringify(input)}`;
      const cached = await CacheService.getSearchResults('artist', input.query, input);
      if (cached) {
        return cached;
      }

      // Build search conditions
      const conditions: string[] = [];
      const queryParams: Record<string, any> = {};

      // Name search with fuzzy matching
      conditions.push(`(
        positionCaseInsensitive(name, {query:String}) > 0 OR
        arrayExists(alias -> positionCaseInsensitive(alias, {query:String}) > 0, aliases)
      )`);
      queryParams.query = input.query;

      // Country filter
      if (input.country) {
        conditions.push('country = {country:String}');
        queryParams.country = input.country;
      }

      // Genre filter
      if (input.genres && input.genres.length > 0) {
        conditions.push('arrayExists(genre -> genre IN {genres:Array(String)}, genres)');
        queryParams.genres = input.genres;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get total count
      const countSql = `
        SELECT count() as total
        FROM artists
        ${whereClause}
      `;

      const countResult = await query<{ total: number }>(countSql, queryParams);
      const total = countResult[0]?.total || 0;

      // Get paginated results
      const sql = `
        SELECT
          id,
          name,
          aliases,
          genres,
          country,
          spotify_id as spotifyId,
          musicbrainz_id as musicBrainzId,
          image_url as imageUrl,
          biography,
          concert_count as concertCount,
          last_concert_date as lastConcertDate,
          created_at as createdAt
        FROM artists
        ${whereClause}
        ORDER BY
          positionCaseInsensitive(name, {query:String}) DESC,
          concert_count DESC,
          name ASC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;

      const artists = await query<any>(sql, queryParams);

      const result = {
        artists: artists.map(artist => ({
          ...artist,
          lastConcertDate: artist.lastConcertDate ? new Date(artist.lastConcertDate) : null,
          createdAt: new Date(artist.createdAt),
        })),
        total,
        hasMore: input.offset + input.limit < total,
      };

      // Cache the result
      await CacheService.setSearchResults('artist', input.query, result, input);

      return result;
    }),

  // Get artist by ID
  getById: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/artists/{id}', tags: ['Artists'] } })
    .input(z.object({ id: z.string().uuid() }))
    .output(ArtistSchema)
    .query(async ({ input }) => {
      // Check cache first
      const cached = await CacheService.getArtist(input.id);
      if (cached) {
        return cached;
      }

      const sql = `
        SELECT
          id,
          name,
          aliases,
          genres,
          country,
          spotify_id as spotifyId,
          musicbrainz_id as musicBrainzId,
          image_url as imageUrl,
          biography,
          concert_count as concertCount,
          last_concert_date as lastConcertDate,
          created_at as createdAt
        FROM artists
        WHERE id = {id:String}
      `;

      const results = await query<any>(sql, { id: input.id });

      if (results.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Artist not found' });
      }

      const artist = {
        ...results[0],
        lastConcertDate: results[0].lastConcertDate ? new Date(results[0].lastConcertDate) : null,
        createdAt: new Date(results[0].createdAt),
      };

      // Cache the result
      await CacheService.setArtist(input.id, artist);

      return artist;
    }),

  // Get artist's concerts
  getConcerts: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/artists/{id}/concerts', tags: ['Artists'] } })
    .input(z.object({
      id: z.string().uuid(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
      country: z.string().optional(),
      city: z.string().optional(),
    }))
    .output(z.object({
      concerts: z.array(ArtistConcertSchema),
      total: z.number(),
      hasMore: z.boolean(),
    }))
    .query(async ({ input }) => {
      // Build search conditions
      const conditions: string[] = ['artist_id = {artistId:String}'];
      const queryParams: Record<string, any> = { artistId: input.id };

      // Date range filters
      if (input.dateFrom) {
        conditions.push('date >= {dateFrom:Date}');
        queryParams.dateFrom = input.dateFrom.toISOString().split('T')[0];
      }

      if (input.dateTo) {
        conditions.push('date <= {dateTo:Date}');
        queryParams.dateTo = input.dateTo.toISOString().split('T')[0];
      }

      // Location filters
      if (input.country) {
        conditions.push('country = {country:String}');
        queryParams.country = input.country;
      }

      if (input.city) {
        conditions.push('city = {city:String}');
        queryParams.city = input.city;
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
        ORDER BY date DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;

      const concerts = await query<any>(sql, queryParams);

      return {
        concerts,
        total,
        hasMore: input.offset + input.limit < total,
      };
    }),

  // Get similar artists
  getSimilar: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/artists/{id}/similar', tags: ['Artists'] } })
    .input(z.object({
      id: z.string().uuid(),
      limit: z.number().min(1).max(20).default(10),
    }))
    .output(z.array(ArtistSchema))
    .query(async ({ input }) => {
      // This is a simplified similarity algorithm based on shared genres and concert locations
      const sql = `
        WITH target_artist AS (
          SELECT genres, country
          FROM artists
          WHERE id = {artistId:String}
        )
        SELECT DISTINCT
          a.id,
          a.name,
          a.aliases,
          a.genres,
          a.country,
          a.spotify_id as spotifyId,
          a.musicbrainz_id as musicBrainzId,
          a.image_url as imageUrl,
          a.biography,
          a.concert_count as concertCount,
          a.last_concert_date as lastConcertDate,
          a.created_at as createdAt,
          arrayIntersection(a.genres, t.genres) as shared_genres,
          length(arrayIntersection(a.genres, t.genres)) as genre_similarity
        FROM artists a
        CROSS JOIN target_artist t
        WHERE a.id != {artistId:String}
          AND length(arrayIntersection(a.genres, t.genres)) > 0
        ORDER BY
          genre_similarity DESC,
          concert_count DESC
        LIMIT ${input.limit}
      `;

      const results = await query<any>(sql, { artistId: input.id });

      return results.map(artist => ({
        ...artist,
        lastConcertDate: artist.lastConcertDate ? new Date(artist.lastConcertDate) : null,
        createdAt: new Date(artist.createdAt),
      }));
    }),

  // Get top artists by concert count
  getTopByPeriod: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/artists/top', tags: ['Artists'] } })
    .input(z.object({
      period: z.enum(['week', 'month', 'year', 'all']).default('month'),
      limit: z.number().min(1).max(100).default(20),
      country: z.string().optional(),
    }))
    .output(z.array(ArtistSchema.extend({
      periodConcertCount: z.number(),
    })))
    .query(async ({ input }) => {
      // Check cache first
      const cacheKey = `top_${input.period}_${input.country || 'all'}`;
      const cached = await CacheService.getStats('top_artists', input.period);
      if (cached) {
        return cached;
      }

      // Calculate date filter based on period
      let dateFilter = '';
      const now = new Date();

      switch (input.period) {
        case 'week':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          dateFilter = `AND c.date >= '${weekAgo.toISOString().split('T')[0]}'`;
          break;
        case 'month':
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          dateFilter = `AND c.date >= '${monthAgo.toISOString().split('T')[0]}'`;
          break;
        case 'year':
          const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          dateFilter = `AND c.date >= '${yearAgo.toISOString().split('T')[0]}'`;
          break;
        default:
          dateFilter = '';
      }

      // Country filter
      const countryFilter = input.country ? `AND a.country = '${input.country}'` : '';

      const sql = `
        SELECT
          a.id,
          a.name,
          a.aliases,
          a.genres,
          a.country,
          a.spotify_id as spotifyId,
          a.musicbrainz_id as musicBrainzId,
          a.image_url as imageUrl,
          a.biography,
          a.concert_count as concertCount,
          a.last_concert_date as lastConcertDate,
          a.created_at as createdAt,
          count(c.id) as periodConcertCount
        FROM artists a
        LEFT JOIN concerts c ON a.id = c.artist_id
        WHERE 1=1
          ${dateFilter}
          ${countryFilter}
        GROUP BY
          a.id, a.name, a.aliases, a.genres, a.country,
          a.spotify_id, a.musicbrainz_id, a.image_url,
          a.biography, a.concert_count, a.last_concert_date, a.created_at
        ORDER BY periodConcertCount DESC
        LIMIT ${input.limit}
      `;

      const results = await query<any>(sql);

      const topArtists = results.map(artist => ({
        ...artist,
        lastConcertDate: artist.lastConcertDate ? new Date(artist.lastConcertDate) : null,
        createdAt: new Date(artist.createdAt),
      }));

      // Cache the result
      await CacheService.setStats('top_artists', topArtists, input.period);

      return topArtists;
    }),
});