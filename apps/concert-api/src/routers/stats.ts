import { router, publicProcedure } from '@gigz/trpc';
import { query } from '@gigz/clickhouse';
import { z } from 'zod';
import { CacheService } from '../lib/cache';

const PeriodStatsSchema = z.object({
  period: z.string(),
  totalConcerts: z.number(),
  totalAttendance: z.number(),
  avgAttendance: z.number(),
  uniqueArtists: z.number(),
  uniqueVenues: z.number(),
  uniqueCities: z.number(),
  uniqueCountries: z.number(),
});

const TopItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  count: z.number(),
  percentage: z.number(),
});

const GenreStatsSchema = z.object({
  genre: z.string(),
  concertCount: z.number(),
  totalAttendance: z.number(),
  avgAttendance: z.number(),
  uniqueArtists: z.number(),
  uniqueVenues: z.number(),
});

const LocationStatsSchema = z.object({
  country: z.string(),
  city: z.string().nullable(),
  concertCount: z.number(),
  totalAttendance: z.number(),
  avgAttendance: z.number(),
  uniqueArtists: z.number(),
  uniqueVenues: z.number(),
});

const TrendDataSchema = z.object({
  period: z.string(),
  date: z.string(),
  concertCount: z.number(),
  totalAttendance: z.number(),
  avgAttendance: z.number(),
});

export const statsRouter = router({
  // Overall platform statistics
  getOverview: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/stats/overview', tags: ['Statistics'] } })
    .input(z.object({
      period: z.enum(['day', 'week', 'month', 'year', 'all']).default('all'),
      country: z.string().optional(),
    }))
    .output(PeriodStatsSchema)
    .query(async ({ input }) => {
      // Check cache first
      const cacheKey = `overview_${input.period}_${input.country || 'all'}`;
      const cached = await CacheService.getStats('overview', input.period);
      if (cached) {
        return cached;
      }

      // Calculate date filter
      let dateFilter = '';
      const now = new Date();

      switch (input.period) {
        case 'day':
          const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${dayAgo.toISOString().split('T')[0]}'`;
          break;
        case 'week':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${weekAgo.toISOString().split('T')[0]}'`;
          break;
        case 'month':
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${monthAgo.toISOString().split('T')[0]}'`;
          break;
        case 'year':
          const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${yearAgo.toISOString().split('T')[0]}'`;
          break;
        default:
          dateFilter = input.country ? `WHERE country = '${input.country}'` : '';
      }

      if (input.country && dateFilter) {
        dateFilter += ` AND country = '${input.country}'`;
      } else if (input.country && !dateFilter) {
        dateFilter = `WHERE country = '${input.country}'`;
      }

      const sql = `
        SELECT
          '${input.period}' as period,
          count() as totalConcerts,
          sum(attendance_count) as totalAttendance,
          avg(attendance_count) as avgAttendance,
          uniqExact(artist_id) as uniqueArtists,
          uniqExact(venue_id) as uniqueVenues,
          uniqExact(city) as uniqueCities,
          uniqExact(country) as uniqueCountries
        FROM concerts
        ${dateFilter}
      `;

      const results = await query<any>(sql);
      const stats = results[0] || {
        period: input.period,
        totalConcerts: 0,
        totalAttendance: 0,
        avgAttendance: 0,
        uniqueArtists: 0,
        uniqueVenues: 0,
        uniqueCities: 0,
        uniqueCountries: 0,
      };

      // Cache the result
      await CacheService.setStats('overview', stats, input.period);

      return {
        ...stats,
        avgAttendance: Math.round(stats.avgAttendance * 100) / 100, // Round to 2 decimal places
      };
    }),

  // Top artists by concert count or attendance
  getTopArtists: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/stats/artists/top', tags: ['Statistics'] } })
    .input(z.object({
      period: z.enum(['week', 'month', 'year', 'all']).default('month'),
      metric: z.enum(['concerts', 'attendance']).default('concerts'),
      limit: z.number().min(1).max(50).default(10),
      country: z.string().optional(),
    }))
    .output(z.array(TopItemSchema))
    .query(async ({ input }) => {
      // Check cache first
      const cached = await CacheService.getStats(`top_artists_${input.metric}`, input.period);
      if (cached) {
        return cached;
      }

      // Calculate date filter
      let dateFilter = '';
      const now = new Date();

      switch (input.period) {
        case 'week':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${weekAgo.toISOString().split('T')[0]}'`;
          break;
        case 'month':
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${monthAgo.toISOString().split('T')[0]}'`;
          break;
        case 'year':
          const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${yearAgo.toISOString().split('T')[0]}'`;
          break;
        default:
          dateFilter = input.country ? `WHERE country = '${input.country}'` : '';
      }

      if (input.country && dateFilter) {
        dateFilter += ` AND country = '${input.country}'`;
      } else if (input.country && !dateFilter) {
        dateFilter = `WHERE country = '${input.country}'`;
      }

      const metricField = input.metric === 'concerts' ? 'count()' : 'sum(attendance_count)';
      const orderBy = input.metric === 'concerts' ? 'concert_count' : 'total_attendance';

      const sql = `
        WITH totals AS (
          SELECT ${metricField} as total_metric
          FROM concerts
          ${dateFilter}
        )
        SELECT
          artist_id as id,
          any(artist_name) as name,
          ${metricField} as count,
          round((${metricField} * 100.0) / (SELECT total_metric FROM totals), 2) as percentage
        FROM concerts
        ${dateFilter}
        GROUP BY artist_id
        ORDER BY count DESC
        LIMIT ${input.limit}
      `;

      const results = await query<any>(sql);

      // Cache the result
      await CacheService.setStats(`top_artists_${input.metric}`, results, input.period);

      return results;
    }),

  // Top venues by concert count or attendance
  getTopVenues: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/stats/venues/top', tags: ['Statistics'] } })
    .input(z.object({
      period: z.enum(['week', 'month', 'year', 'all']).default('month'),
      metric: z.enum(['concerts', 'attendance']).default('concerts'),
      limit: z.number().min(1).max(50).default(10),
      country: z.string().optional(),
    }))
    .output(z.array(TopItemSchema))
    .query(async ({ input }) => {
      // Check cache first
      const cached = await CacheService.getStats(`top_venues_${input.metric}`, input.period);
      if (cached) {
        return cached;
      }

      // Calculate date filter (same logic as top artists)
      let dateFilter = '';
      const now = new Date();

      switch (input.period) {
        case 'week':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${weekAgo.toISOString().split('T')[0]}'`;
          break;
        case 'month':
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${monthAgo.toISOString().split('T')[0]}'`;
          break;
        case 'year':
          const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${yearAgo.toISOString().split('T')[0]}'`;
          break;
        default:
          dateFilter = input.country ? `WHERE country = '${input.country}'` : '';
      }

      if (input.country && dateFilter) {
        dateFilter += ` AND country = '${input.country}'`;
      } else if (input.country && !dateFilter) {
        dateFilter = `WHERE country = '${input.country}'`;
      }

      const metricField = input.metric === 'concerts' ? 'count()' : 'sum(attendance_count)';

      const sql = `
        WITH totals AS (
          SELECT ${metricField} as total_metric
          FROM concerts
          ${dateFilter}
        )
        SELECT
          venue_id as id,
          any(venue_name) as name,
          ${metricField} as count,
          round((${metricField} * 100.0) / (SELECT total_metric FROM totals), 2) as percentage
        FROM concerts
        ${dateFilter}
        GROUP BY venue_id
        ORDER BY count DESC
        LIMIT ${input.limit}
      `;

      const results = await query<any>(sql);

      // Cache the result
      await CacheService.setStats(`top_venues_${input.metric}`, results, input.period);

      return results;
    }),

  // Genre statistics
  getGenreStats: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/stats/genres', tags: ['Statistics'] } })
    .input(z.object({
      period: z.enum(['week', 'month', 'year', 'all']).default('month'),
      limit: z.number().min(1).max(50).default(20),
      country: z.string().optional(),
    }))
    .output(z.array(GenreStatsSchema))
    .query(async ({ input }) => {
      // Check cache first
      const cached = await CacheService.getStats('genre_stats', input.period);
      if (cached) {
        return cached;
      }

      // Calculate date filter
      let dateFilter = '';
      const now = new Date();

      switch (input.period) {
        case 'week':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${weekAgo.toISOString().split('T')[0]}'`;
          break;
        case 'month':
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${monthAgo.toISOString().split('T')[0]}'`;
          break;
        case 'year':
          const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${yearAgo.toISOString().split('T')[0]}'`;
          break;
        default:
          dateFilter = input.country ? `WHERE country = '${input.country}'` : '';
      }

      if (input.country && dateFilter) {
        dateFilter += ` AND country = '${input.country}'`;
      } else if (input.country && !dateFilter) {
        dateFilter = `WHERE country = '${input.country}'`;
      }

      const sql = `
        SELECT
          arrayJoin(genres) as genre,
          count() as concertCount,
          sum(attendance_count) as totalAttendance,
          avg(attendance_count) as avgAttendance,
          uniqExact(artist_id) as uniqueArtists,
          uniqExact(venue_id) as uniqueVenues
        FROM concerts
        ${dateFilter}
        WHERE length(genres) > 0
        GROUP BY genre
        ORDER BY concertCount DESC
        LIMIT ${input.limit}
      `;

      const results = await query<any>(sql);
      const genreStats = results.map(row => ({
        ...row,
        avgAttendance: Math.round(row.avgAttendance * 100) / 100,
      }));

      // Cache the result
      await CacheService.setStats('genre_stats', genreStats, input.period);

      return genreStats;
    }),

  // Location-based statistics
  getLocationStats: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/stats/locations', tags: ['Statistics'] } })
    .input(z.object({
      period: z.enum(['week', 'month', 'year', 'all']).default('month'),
      groupBy: z.enum(['country', 'city']).default('country'),
      limit: z.number().min(1).max(50).default(20),
      country: z.string().optional(),
    }))
    .output(z.array(LocationStatsSchema))
    .query(async ({ input }) => {
      // Check cache first
      const cached = await CacheService.getStats(`location_stats_${input.groupBy}`, input.period);
      if (cached) {
        return cached;
      }

      // Calculate date filter
      let dateFilter = '';
      const now = new Date();

      switch (input.period) {
        case 'week':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${weekAgo.toISOString().split('T')[0]}'`;
          break;
        case 'month':
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${monthAgo.toISOString().split('T')[0]}'`;
          break;
        case 'year':
          const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          dateFilter = `WHERE date >= '${yearAgo.toISOString().split('T')[0]}'`;
          break;
        default:
          dateFilter = input.country ? `WHERE country = '${input.country}'` : '';
      }

      if (input.country && dateFilter) {
        dateFilter += ` AND country = '${input.country}'`;
      } else if (input.country && !dateFilter) {
        dateFilter = `WHERE country = '${input.country}'`;
      }

      const groupByFields = input.groupBy === 'city' ? 'country, city' : 'country';
      const cityField = input.groupBy === 'city' ? 'city' : 'NULL as city';

      const sql = `
        SELECT
          country,
          ${cityField},
          count() as concertCount,
          sum(attendance_count) as totalAttendance,
          avg(attendance_count) as avgAttendance,
          uniqExact(artist_id) as uniqueArtists,
          uniqExact(venue_id) as uniqueVenues
        FROM concerts
        ${dateFilter}
        GROUP BY ${groupByFields}
        ORDER BY concertCount DESC
        LIMIT ${input.limit}
      `;

      const results = await query<any>(sql);
      const locationStats = results.map(row => ({
        ...row,
        avgAttendance: Math.round(row.avgAttendance * 100) / 100,
      }));

      // Cache the result
      await CacheService.setStats(`location_stats_${input.groupBy}`, locationStats, input.period);

      return locationStats;
    }),

  // Time-based trends
  getTrends: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/stats/trends', tags: ['Statistics'] } })
    .input(z.object({
      granularity: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
      periods: z.number().min(1).max(365).default(12), // Number of periods to return
      country: z.string().optional(),
    }))
    .output(z.array(TrendDataSchema))
    .query(async ({ input }) => {
      // Check cache first
      const cached = await CacheService.getStats(`trends_${input.granularity}`, input.periods.toString());
      if (cached) {
        return cached;
      }

      // Build date grouping based on granularity
      let dateFormat = '';
      let intervalDays = 1;

      switch (input.granularity) {
        case 'daily':
          dateFormat = 'toYYYYMMDD(date)';
          intervalDays = 1;
          break;
        case 'weekly':
          dateFormat = 'toYearWeek(date)';
          intervalDays = 7;
          break;
        case 'monthly':
          dateFormat = 'toYYYYMM(date)';
          intervalDays = 30;
          break;
      }

      // Calculate start date
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - (input.periods * intervalDays * 24 * 60 * 60 * 1000));

      let whereConditions = [`date >= '${startDate.toISOString().split('T')[0]}'`];
      if (input.country) {
        whereConditions.push(`country = '${input.country}'`);
      }

      const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

      const sql = `
        SELECT
          '${input.granularity}' as period,
          toString(${dateFormat}) as date,
          count() as concertCount,
          sum(attendance_count) as totalAttendance,
          avg(attendance_count) as avgAttendance
        FROM concerts
        ${whereClause}
        GROUP BY ${dateFormat}
        ORDER BY date DESC
        LIMIT ${input.periods}
      `;

      const results = await query<any>(sql);
      const trends = results.map(row => ({
        ...row,
        avgAttendance: Math.round(row.avgAttendance * 100) / 100,
      })).reverse(); // Reverse to get chronological order

      // Cache the result
      await CacheService.setStats(`trends_${input.granularity}`, trends, input.periods.toString());

      return trends;
    }),

  // Health check for the stats endpoints
  health: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/stats/health', tags: ['Statistics'] } })
    .output(z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy']),
      clickhouse: z.boolean(),
      redis: z.boolean(),
      lastUpdated: z.date(),
    }))
    .query(async () => {
      const clickhouseHealthy = await checkClickHouseHealth();
      const redisHealthy = await CacheService.isHealthy();

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (!clickhouseHealthy && !redisHealthy) {
        status = 'unhealthy';
      } else if (!clickhouseHealthy || !redisHealthy) {
        status = 'degraded';
      }

      return {
        status,
        clickhouse: clickhouseHealthy,
        redis: redisHealthy,
        lastUpdated: new Date(),
      };
    }),
});

// Helper function to check ClickHouse health
async function checkClickHouseHealth(): Promise<boolean> {
  try {
    const result = await query('SELECT 1 as test');
    return result.length > 0 && (result[0] as any).test === 1;
  } catch (error) {
    return false;
  }
}