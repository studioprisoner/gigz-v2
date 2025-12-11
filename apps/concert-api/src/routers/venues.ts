import { router, publicProcedure, TRPCError } from '@gigz/trpc';
import { query } from '@gigz/clickhouse';
import { z } from 'zod';
import { CacheService } from '../lib/cache';

const VenueSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).nullable(),
  address: z.string().nullable(),
  city: z.string(),
  state: z.string().nullable(),
  country: z.string(),
  postalCode: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  capacity: z.number().nullable(),
  venueType: z.string().nullable(),
  website: z.string().nullable(),
  phone: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  concertCount: z.number(),
  lastConcertDate: z.date().nullable(),
  createdAt: z.date(),
});

const VenueConcertSchema = z.object({
  id: z.string(),
  artistName: z.string(),
  venueName: z.string(),
  city: z.string(),
  country: z.string(),
  date: z.string(),
  attendanceCount: z.number(),
});

const NearbyVenueSchema = VenueSchema.extend({
  distance: z.number(), // Distance in kilometers
});

export const venuesRouter = router({
  // Search venues by name or location
  search: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/venues/search', tags: ['Venues'] } })
    .input(z.object({
      query: z.string().min(1).max(100),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      city: z.string().optional(),
      country: z.string().optional(),
      venueType: z.string().optional(),
      minCapacity: z.number().optional(),
      maxCapacity: z.number().optional(),
    }))
    .output(z.object({
      venues: z.array(VenueSchema),
      total: z.number(),
      hasMore: z.boolean(),
    }))
    .query(async ({ input }) => {
      // Check cache first
      const cacheKey = `search_${JSON.stringify(input)}`;
      const cached = await CacheService.getSearchResults('venue', input.query, input);
      if (cached) {
        return cached;
      }

      // Build search conditions
      const conditions: string[] = [];
      const queryParams: Record<string, any> = {};

      // Name and address search
      conditions.push(`(
        positionCaseInsensitive(name, {query:String}) > 0 OR
        positionCaseInsensitive(address, {query:String}) > 0 OR
        positionCaseInsensitive(city, {query:String}) > 0 OR
        arrayExists(alias -> positionCaseInsensitive(alias, {query:String}) > 0, aliases)
      )`);
      queryParams.query = input.query;

      // Location filters
      if (input.city) {
        conditions.push('city = {city:String}');
        queryParams.city = input.city;
      }

      if (input.country) {
        conditions.push('country = {country:String}');
        queryParams.country = input.country;
      }

      // Venue type filter
      if (input.venueType) {
        conditions.push('venue_type = {venueType:String}');
        queryParams.venueType = input.venueType;
      }

      // Capacity filters
      if (input.minCapacity) {
        conditions.push('capacity >= {minCapacity:UInt32}');
        queryParams.minCapacity = input.minCapacity;
      }

      if (input.maxCapacity) {
        conditions.push('capacity <= {maxCapacity:UInt32}');
        queryParams.maxCapacity = input.maxCapacity;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get total count
      const countSql = `
        SELECT count() as total
        FROM venues
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
          address,
          city,
          state,
          country,
          postal_code as postalCode,
          latitude,
          longitude,
          capacity,
          venue_type as venueType,
          website,
          phone,
          description,
          image_url as imageUrl,
          concert_count as concertCount,
          last_concert_date as lastConcertDate,
          created_at as createdAt
        FROM venues
        ${whereClause}
        ORDER BY
          positionCaseInsensitive(name, {query:String}) DESC,
          concert_count DESC,
          name ASC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;

      const venues = await query<any>(sql, queryParams);

      const result = {
        venues: venues.map(venue => ({
          ...venue,
          lastConcertDate: venue.lastConcertDate ? new Date(venue.lastConcertDate) : null,
          createdAt: new Date(venue.createdAt),
        })),
        total,
        hasMore: input.offset + input.limit < total,
      };

      // Cache the result
      await CacheService.setSearchResults('venue', input.query, result, input);

      return result;
    }),

  // Get venue by ID
  getById: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/venues/{id}', tags: ['Venues'] } })
    .input(z.object({ id: z.string().uuid() }))
    .output(VenueSchema)
    .query(async ({ input }) => {
      // Check cache first
      const cached = await CacheService.getVenue(input.id);
      if (cached) {
        return cached;
      }

      const sql = `
        SELECT
          id,
          name,
          aliases,
          address,
          city,
          state,
          country,
          postal_code as postalCode,
          latitude,
          longitude,
          capacity,
          venue_type as venueType,
          website,
          phone,
          description,
          image_url as imageUrl,
          concert_count as concertCount,
          last_concert_date as lastConcertDate,
          created_at as createdAt
        FROM venues
        WHERE id = {id:String}
      `;

      const results = await query<any>(sql, { id: input.id });

      if (results.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Venue not found' });
      }

      const venue = {
        ...results[0],
        lastConcertDate: results[0].lastConcertDate ? new Date(results[0].lastConcertDate) : null,
        createdAt: new Date(results[0].createdAt),
      };

      // Cache the result
      await CacheService.setVenue(input.id, venue);

      return venue;
    }),

  // Get nearby venues using geospatial queries
  getNearby: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/venues/nearby', tags: ['Venues'] } })
    .input(z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      radius: z.number().min(0.1).max(1000).default(50), // radius in kilometers
      limit: z.number().min(1).max(100).default(20),
      venueType: z.string().optional(),
      minCapacity: z.number().optional(),
    }))
    .output(z.array(NearbyVenueSchema))
    .query(async ({ input }) => {
      // Check cache first
      const cached = await CacheService.getNearbyResults(
        input.latitude,
        input.longitude,
        input.radius,
        'venues'
      );
      if (cached) {
        return cached;
      }

      // Build conditions
      const conditions: string[] = [
        'latitude IS NOT NULL',
        'longitude IS NOT NULL',
      ];
      const queryParams: Record<string, any> = {
        lat: input.latitude,
        lon: input.longitude,
        radius: input.radius,
      };

      if (input.venueType) {
        conditions.push('venue_type = {venueType:String}');
        queryParams.venueType = input.venueType;
      }

      if (input.minCapacity) {
        conditions.push('capacity >= {minCapacity:UInt32}');
        queryParams.minCapacity = input.minCapacity;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // Use Haversine formula for distance calculation
      const sql = `
        SELECT
          id,
          name,
          aliases,
          address,
          city,
          state,
          country,
          postal_code as postalCode,
          latitude,
          longitude,
          capacity,
          venue_type as venueType,
          website,
          phone,
          description,
          image_url as imageUrl,
          concert_count as concertCount,
          last_concert_date as lastConcertDate,
          created_at as createdAt,
          6371 * acos(
            cos(radians({lat:Float64})) *
            cos(radians(latitude)) *
            cos(radians(longitude) - radians({lon:Float64})) +
            sin(radians({lat:Float64})) *
            sin(radians(latitude))
          ) as distance
        FROM venues
        ${whereClause}
        HAVING distance <= {radius:Float64}
        ORDER BY distance ASC
        LIMIT ${input.limit}
      `;

      const venues = await query<any>(sql, queryParams);

      const result = venues.map(venue => ({
        ...venue,
        lastConcertDate: venue.lastConcertDate ? new Date(venue.lastConcertDate) : null,
        createdAt: new Date(venue.createdAt),
        distance: Math.round(venue.distance * 100) / 100, // Round to 2 decimal places
      }));

      // Cache the result
      await CacheService.setNearbyResults(
        input.latitude,
        input.longitude,
        input.radius,
        'venues',
        result
      );

      return result;
    }),

  // Get venue's concerts
  getConcerts: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/venues/{id}/concerts', tags: ['Venues'] } })
    .input(z.object({
      id: z.string().uuid(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
      artistName: z.string().optional(),
    }))
    .output(z.object({
      concerts: z.array(VenueConcertSchema),
      total: z.number(),
      hasMore: z.boolean(),
    }))
    .query(async ({ input }) => {
      // Build search conditions
      const conditions: string[] = ['venue_id = {venueId:String}'];
      const queryParams: Record<string, any> = { venueId: input.id };

      // Date range filters
      if (input.dateFrom) {
        conditions.push('date >= {dateFrom:Date}');
        queryParams.dateFrom = input.dateFrom.toISOString().split('T')[0];
      }

      if (input.dateTo) {
        conditions.push('date <= {dateTo:Date}');
        queryParams.dateTo = input.dateTo.toISOString().split('T')[0];
      }

      // Artist filter
      if (input.artistName) {
        conditions.push('positionCaseInsensitive(artist_name, {artistName:String}) > 0');
        queryParams.artistName = input.artistName;
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

  // Get venues by city/region
  getByLocation: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/venues/location/{country}/{city}', tags: ['Venues'] } })
    .input(z.object({
      country: z.string().min(1),
      city: z.string().min(1),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      venueType: z.string().optional(),
    }))
    .output(z.object({
      venues: z.array(VenueSchema),
      total: z.number(),
      hasMore: z.boolean(),
    }))
    .query(async ({ input }) => {
      // Build search conditions
      const conditions: string[] = [
        'country = {country:String}',
        'city = {city:String}'
      ];
      const queryParams: Record<string, any> = {
        country: input.country,
        city: input.city,
      };

      if (input.venueType) {
        conditions.push('venue_type = {venueType:String}');
        queryParams.venueType = input.venueType;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // Get total count
      const countSql = `
        SELECT count() as total
        FROM venues
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
          address,
          city,
          state,
          country,
          postal_code as postalCode,
          latitude,
          longitude,
          capacity,
          venue_type as venueType,
          website,
          phone,
          description,
          image_url as imageUrl,
          concert_count as concertCount,
          last_concert_date as lastConcertDate,
          created_at as createdAt
        FROM venues
        ${whereClause}
        ORDER BY concert_count DESC, name ASC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;

      const venues = await query<any>(sql, queryParams);

      const result = {
        venues: venues.map(venue => ({
          ...venue,
          lastConcertDate: venue.lastConcertDate ? new Date(venue.lastConcertDate) : null,
          createdAt: new Date(venue.createdAt),
        })),
        total,
        hasMore: input.offset + input.limit < total,
      };

      return result;
    }),

  // Get top venues by concert count
  getTopByPeriod: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/venues/top', tags: ['Venues'] } })
    .input(z.object({
      period: z.enum(['week', 'month', 'year', 'all']).default('month'),
      limit: z.number().min(1).max(100).default(20),
      country: z.string().optional(),
      city: z.string().optional(),
    }))
    .output(z.array(VenueSchema.extend({
      periodConcertCount: z.number(),
    })))
    .query(async ({ input }) => {
      // Check cache first
      const cacheKey = `top_venues_${input.period}_${input.country || 'all'}_${input.city || 'all'}`;
      const cached = await CacheService.getStats('top_venues', input.period);
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

      // Location filters
      const countryFilter = input.country ? `AND v.country = '${input.country}'` : '';
      const cityFilter = input.city ? `AND v.city = '${input.city}'` : '';

      const sql = `
        SELECT
          v.id,
          v.name,
          v.aliases,
          v.address,
          v.city,
          v.state,
          v.country,
          v.postal_code as postalCode,
          v.latitude,
          v.longitude,
          v.capacity,
          v.venue_type as venueType,
          v.website,
          v.phone,
          v.description,
          v.image_url as imageUrl,
          v.concert_count as concertCount,
          v.last_concert_date as lastConcertDate,
          v.created_at as createdAt,
          count(c.id) as periodConcertCount
        FROM venues v
        LEFT JOIN concerts c ON v.id = c.venue_id
        WHERE 1=1
          ${dateFilter}
          ${countryFilter}
          ${cityFilter}
        GROUP BY
          v.id, v.name, v.aliases, v.address, v.city, v.state, v.country,
          v.postal_code, v.latitude, v.longitude, v.capacity, v.venue_type,
          v.website, v.phone, v.description, v.image_url, v.concert_count,
          v.last_concert_date, v.created_at
        ORDER BY periodConcertCount DESC
        LIMIT ${input.limit}
      `;

      const results = await query<any>(sql);

      const topVenues = results.map(venue => ({
        ...venue,
        lastConcertDate: venue.lastConcertDate ? new Date(venue.lastConcertDate) : null,
        createdAt: new Date(venue.createdAt),
      }));

      // Cache the result
      await CacheService.setStats('top_venues', topVenues, input.period);

      return topVenues;
    }),
});