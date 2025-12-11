import { query as clickhouseQuery } from '@gigz/clickhouse';
import { db } from '@gigz/db';
import type { ArtistDocument, VenueDocument, ConcertDocument, UserDocument } from './meilisearch';

// Simple logger for now
const logger = {
  info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta || ''),
  error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta || ''),
};

// ClickHouse data fetchers
export class ClickHouseDataFetcher {

  static async fetchAllArtists(): Promise<ArtistDocument[]> {
    try {
      logger.info('Fetching all artists from ClickHouse');

      const sql = `
        SELECT
          id,
          name,
          aliases,
          image_url,
          spotify_id,
          concert_count as concerts_count,
          CASE WHEN verified = 1 THEN true ELSE false END as verified
        FROM artists
        ORDER BY concert_count DESC
      `;

      const results = await clickhouseQuery<any>(sql);

      return results.map(artist => ({
        id: artist.id,
        name: artist.name,
        aliases: artist.aliases || [],
        image_url: artist.image_url,
        spotify_id: artist.spotify_id,
        concerts_count: artist.concerts_count || 0,
        verified: artist.verified === true,
      }));
    } catch (error) {
      logger.error('Failed to fetch artists from ClickHouse', { error });
      throw error;
    }
  }

  static async fetchAllVenues(): Promise<VenueDocument[]> {
    try {
      logger.info('Fetching all venues from ClickHouse');

      const sql = `
        SELECT
          id,
          name,
          aliases,
          city,
          country,
          capacity,
          concert_count as concerts_count,
          latitude,
          longitude
        FROM venues
        ORDER BY concert_count DESC
      `;

      const results = await clickhouseQuery<any>(sql);

      return results.map(venue => ({
        id: venue.id,
        name: venue.name,
        aliases: venue.aliases || [],
        city: venue.city,
        country: venue.country,
        capacity: venue.capacity,
        concerts_count: venue.concerts_count || 0,
        _geo: venue.latitude && venue.longitude ? {
          lat: venue.latitude,
          lng: venue.longitude,
        } : null,
      }));
    } catch (error) {
      logger.error('Failed to fetch venues from ClickHouse', { error });
      throw error;
    }
  }

  static async fetchConcerts(
    dateFrom?: string,
    dateTo?: string,
    limit = 10000
  ): Promise<ConcertDocument[]> {
    try {
      logger.info('Fetching concerts from ClickHouse', { dateFrom, dateTo, limit });

      const conditions: string[] = [];
      const queryParams: Record<string, any> = { limit };

      if (dateFrom) {
        conditions.push('date >= {dateFrom:Date}');
        queryParams.dateFrom = dateFrom;
      }

      if (dateTo) {
        conditions.push('date <= {dateTo:Date}');
        queryParams.dateTo = dateTo;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const sql = `
        SELECT
          c.id,
          c.artist_id,
          c.artist_name,
          c.venue_id,
          c.venue_name,
          c.city,
          c.country,
          c.date,
          c.tour_name,
          c.attendance_count,
          v.latitude,
          v.longitude
        FROM concerts c
        LEFT JOIN venues v ON c.venue_id = v.id
        ${whereClause}
        ORDER BY c.date DESC
        LIMIT {limit:UInt32}
      `;

      const results = await clickhouseQuery<any>(sql, queryParams);

      return results.map(concert => ({
        id: concert.id,
        artist_id: concert.artist_id,
        artist_name: concert.artist_name,
        venue_id: concert.venue_id,
        venue_name: concert.venue_name,
        city: concert.city,
        country: concert.country,
        date: new Date(concert.date).getTime(),
        date_display: concert.date,
        tour_name: concert.tour_name,
        attendance_count: concert.attendance_count || 0,
        _geo: concert.latitude && concert.longitude ? {
          lat: concert.latitude,
          lng: concert.longitude,
        } : null,
      }));
    } catch (error) {
      logger.error('Failed to fetch concerts from ClickHouse', { error });
      throw error;
    }
  }

  static async fetchRecentConcerts(days = 30): Promise<ConcertDocument[]> {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    return this.fetchConcerts(dateFrom.toISOString().split('T')[0]);
  }

  static async fetchUpcomingConcerts(days = 90): Promise<ConcertDocument[]> {
    const dateFrom = new Date().toISOString().split('T')[0];
    const dateTo = new Date();
    dateTo.setDate(dateTo.getDate() + days);

    return this.fetchConcerts(dateFrom, dateTo.toISOString().split('T')[0]);
  }
}

// PostgreSQL data fetchers
export class PostgreSQLDataFetcher {

  static async fetchAllUsers(): Promise<UserDocument[]> {
    try {
      logger.info('Fetching all users from PostgreSQL');

      // Note: This will need to be updated once the @gigz/db package is properly implemented
      // For now, we'll return a placeholder structure

      // const users = await db.query.users.findMany({
      //   where: isNull(users.deletedAt),
      //   columns: {
      //     id: true,
      //     username: true,
      //     displayName: true,
      //     avatarUrl: true,
      //     totalShowsCount: true,
      //     profileVisibility: true,
      //   },
      // });

      // Placeholder implementation
      const users: any[] = [];

      return users.map(user => ({
        id: user.id,
        username: user.username,
        display_name: user.displayName,
        avatar_url: user.avatarUrl,
        total_shows_count: user.totalShowsCount || 0,
        profile_visibility: user.profileVisibility || 'friends_only',
      }));
    } catch (error) {
      logger.error('Failed to fetch users from PostgreSQL', { error });
      throw error;
    }
  }

  static async fetchPublicUsers(): Promise<UserDocument[]> {
    try {
      logger.info('Fetching public users from PostgreSQL');

      // Placeholder implementation
      const users: any[] = [];

      return users
        .filter(user => user.profileVisibility === 'public')
        .map(user => ({
          id: user.id,
          username: user.username,
          display_name: user.displayName,
          avatar_url: user.avatarUrl,
          total_shows_count: user.totalShowsCount || 0,
          profile_visibility: user.profileVisibility,
        }));
    } catch (error) {
      logger.error('Failed to fetch public users from PostgreSQL', { error });
      throw error;
    }
  }
}

// Batch processing utilities
export class BatchProcessor {

  static async processBatch<T, R>(
    items: T[],
    processor: (batch: T[]) => Promise<R[]>,
    batchSize = 1000
  ): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}`);

      try {
        const batchResults = await processor(batch);
        results.push(...batchResults);
      } catch (error) {
        logger.error(`Failed to process batch starting at index ${i}`, { error });
        throw error;
      }
    }

    return results;
  }

  static async processInBatches<T>(
    items: T[],
    processor: (batch: T[]) => Promise<void>,
    batchSize = 1000
  ): Promise<void> {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}`);

      try {
        await processor(batch);
      } catch (error) {
        logger.error(`Failed to process batch starting at index ${i}`, { error });
        throw error;
      }
    }
  }
}

// Data validation utilities
export class DataValidator {

  static validateArtistDocument(artist: any): artist is ArtistDocument {
    return (
      typeof artist === 'object' &&
      typeof artist.id === 'string' &&
      typeof artist.name === 'string' &&
      Array.isArray(artist.aliases) &&
      typeof artist.concerts_count === 'number' &&
      typeof artist.verified === 'boolean'
    );
  }

  static validateVenueDocument(venue: any): venue is VenueDocument {
    return (
      typeof venue === 'object' &&
      typeof venue.id === 'string' &&
      typeof venue.name === 'string' &&
      typeof venue.city === 'string' &&
      typeof venue.country === 'string' &&
      Array.isArray(venue.aliases) &&
      typeof venue.concerts_count === 'number'
    );
  }

  static validateConcertDocument(concert: any): concert is ConcertDocument {
    return (
      typeof concert === 'object' &&
      typeof concert.id === 'string' &&
      typeof concert.artist_id === 'string' &&
      typeof concert.artist_name === 'string' &&
      typeof concert.venue_id === 'string' &&
      typeof concert.venue_name === 'string' &&
      typeof concert.city === 'string' &&
      typeof concert.country === 'string' &&
      typeof concert.date === 'number' &&
      typeof concert.date_display === 'string'
    );
  }

  static validateUserDocument(user: any): user is UserDocument {
    return (
      typeof user === 'object' &&
      typeof user.id === 'string' &&
      typeof user.username === 'string' &&
      typeof user.display_name === 'string' &&
      typeof user.total_shows_count === 'number' &&
      typeof user.profile_visibility === 'string'
    );
  }
}