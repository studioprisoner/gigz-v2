import { z } from 'zod';
import type { Artist, Venue, Concert, ArtistAlias, ConcertSource } from '@gigz/clickhouse';

// Batch operation configuration
export interface BatchConfig {
  batchSize: number;
  maxRetries: number;
  retryDelay: number;
  timeoutMs: number;
  parallelBatches: number;
}

// Batch operation result
export interface BatchResult {
  success: boolean;
  processedCount: number;
  errorCount: number;
  errors: Error[];
  duration: number;
}

// Batch processor for ClickHouse operations
export class BatchProcessor {
  private clickhouseClient: any;
  private logger: any;
  private config: BatchConfig;

  constructor(
    clickhouseClient: any,
    logger: any,
    config: Partial<BatchConfig> = {}
  ) {
    this.clickhouseClient = clickhouseClient;
    this.logger = logger;

    // Default configuration
    this.config = {
      batchSize: 1000,
      maxRetries: 3,
      retryDelay: 1000,
      timeoutMs: 30000,
      parallelBatches: 3,
      ...config,
    };
  }

  // Batch insert artists
  async insertArtists(artists: Artist[]): Promise<BatchResult> {
    return this.processBatch(
      'artists',
      artists,
      this.validateArtist.bind(this),
      'artist insertion'
    );
  }

  // Batch insert venues
  async insertVenues(venues: Venue[]): Promise<BatchResult> {
    return this.processBatch(
      'venues',
      venues,
      this.validateVenue.bind(this),
      'venue insertion'
    );
  }

  // Batch insert concerts
  async insertConcerts(concerts: Concert[]): Promise<BatchResult> {
    return this.processBatch(
      'concerts',
      concerts,
      this.validateConcert.bind(this),
      'concert insertion'
    );
  }

  // Batch insert artist aliases
  async insertArtistAliases(aliases: ArtistAlias[]): Promise<BatchResult> {
    return this.processBatch(
      'artist_aliases',
      aliases,
      this.validateArtistAlias.bind(this),
      'artist alias insertion'
    );
  }

  // Batch insert concert sources
  async insertConcertSources(sources: ConcertSource[]): Promise<BatchResult> {
    return this.processBatch(
      'concert_sources',
      sources,
      this.validateConcertSource.bind(this),
      'concert source insertion'
    );
  }

  // Generic batch processing function
  private async processBatch<T>(
    tableName: string,
    items: T[],
    validator: (item: T) => boolean,
    operationName: string
  ): Promise<BatchResult> {
    const startTime = Date.now();
    let processedCount = 0;
    let errorCount = 0;
    const errors: Error[] = [];

    if (items.length === 0) {
      return {
        success: true,
        processedCount: 0,
        errorCount: 0,
        errors: [],
        duration: 0,
      };
    }

    this.logger.info(`Starting ${operationName}`, {
      table: tableName,
      totalItems: items.length,
      batchSize: this.config.batchSize,
    });

    try {
      // Validate all items first
      const validItems = items.filter((item, index) => {
        try {
          return validator(item);
        } catch (error) {
          errorCount++;
          errors.push(new Error(`Validation failed for item ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`));
          return false;
        }
      });

      if (validItems.length === 0) {
        throw new Error('No valid items to process');
      }

      // Split into batches
      const batches = this.splitIntoBatches(validItems, this.config.batchSize);

      // Process batches with limited parallelism
      const batchPromises: Promise<void>[] = [];
      const semaphore = new Semaphore(this.config.parallelBatches);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchIndex = i + 1;

        const batchPromise = semaphore.acquire().then(async (release) => {
          try {
            await this.processSingleBatch(tableName, batch, batchIndex, batches.length);
            processedCount += batch.length;
          } catch (error) {
            errorCount += batch.length;
            errors.push(error instanceof Error ? error : new Error('Batch processing failed'));
          } finally {
            release();
          }
        });

        batchPromises.push(batchPromise);
      }

      // Wait for all batches to complete
      await Promise.all(batchPromises);

      const duration = Date.now() - startTime;
      const success = errorCount === 0;

      this.logger.info(`Completed ${operationName}`, {
        table: tableName,
        success,
        processedCount,
        errorCount,
        totalErrors: errors.length,
        duration,
      });

      return {
        success,
        processedCount,
        errorCount,
        errors,
        duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const finalError = error instanceof Error ? error : new Error('Batch processing failed');
      errors.push(finalError);

      this.logger.error(`Failed ${operationName}`, {
        table: tableName,
        error: finalError.message,
        processedCount,
        errorCount: items.length,
        duration,
      });

      return {
        success: false,
        processedCount,
        errorCount: items.length,
        errors,
        duration,
      };
    }
  }

  // Process a single batch with retries
  private async processSingleBatch<T>(
    tableName: string,
    batch: T[],
    batchIndex: number,
    totalBatches: number
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt++) {
      try {
        this.logger.debug(`Processing batch ${batchIndex}/${totalBatches} (attempt ${attempt})`, {
          table: tableName,
          batchSize: batch.length,
        });

        // Execute the insert with timeout
        const insertPromise = this.clickhouseClient.insert({
          table: tableName,
          values: batch,
          format: 'JSONEachRow',
        });

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Insert operation timed out')), this.config.timeoutMs);
        });

        await Promise.race([insertPromise, timeoutPromise]);

        // Success
        this.logger.debug(`Batch ${batchIndex}/${totalBatches} completed successfully`, {
          table: tableName,
          batchSize: batch.length,
          attempt,
        });

        return;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        this.logger.warn(`Batch ${batchIndex}/${totalBatches} failed (attempt ${attempt})`, {
          table: tableName,
          batchSize: batch.length,
          error: lastError.message,
        });

        // Don't retry on the last attempt
        if (attempt <= this.config.maxRetries) {
          const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Batch processing failed after all retries');
  }

  // Split array into batches
  private splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    return batches;
  }

  // Validation functions
  private validateArtist(artist: any): boolean {
    const required = ['id', 'name', 'name_normalized', 'concerts_count', 'verified', 'source', 'created_at', 'updated_at'];

    for (const field of required) {
      if (artist[field] === undefined || artist[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Type checks
    if (typeof artist.id !== 'string') throw new Error('artist.id must be string');
    if (typeof artist.name !== 'string') throw new Error('artist.name must be string');
    if (typeof artist.concerts_count !== 'number') throw new Error('artist.concerts_count must be number');
    if (typeof artist.verified !== 'boolean') throw new Error('artist.verified must be boolean');

    return true;
  }

  private validateVenue(venue: any): boolean {
    const required = ['id', 'name', 'name_normalized', 'city', 'country', 'concerts_count', 'verified', 'source', 'created_at', 'updated_at'];

    for (const field of required) {
      if (venue[field] === undefined || venue[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Type checks
    if (typeof venue.id !== 'string') throw new Error('venue.id must be string');
    if (typeof venue.name !== 'string') throw new Error('venue.name must be string');
    if (typeof venue.city !== 'string') throw new Error('venue.city must be string');
    if (typeof venue.country !== 'string') throw new Error('venue.country must be string');
    if (typeof venue.concerts_count !== 'number') throw new Error('venue.concerts_count must be number');
    if (typeof venue.verified !== 'boolean') throw new Error('venue.verified must be boolean');

    return true;
  }

  private validateConcert(concert: any): boolean {
    const required = ['id', 'artist_id', 'venue_id', 'date', 'attendance_count', 'verified', 'source', 'created_at', 'updated_at'];

    for (const field of required) {
      if (concert[field] === undefined || concert[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Type checks
    if (typeof concert.id !== 'string') throw new Error('concert.id must be string');
    if (typeof concert.artist_id !== 'string') throw new Error('concert.artist_id must be string');
    if (typeof concert.venue_id !== 'string') throw new Error('concert.venue_id must be string');
    if (typeof concert.date !== 'string') throw new Error('concert.date must be string');
    if (typeof concert.attendance_count !== 'number') throw new Error('concert.attendance_count must be number');
    if (typeof concert.verified !== 'boolean') throw new Error('concert.verified must be boolean');

    return true;
  }

  private validateArtistAlias(alias: any): boolean {
    const required = ['id', 'artist_id', 'alias', 'alias_normalized', 'alias_type', 'created_at'];

    for (const field of required) {
      if (alias[field] === undefined || alias[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    return true;
  }

  private validateConcertSource(source: any): boolean {
    const required = ['id', 'concert_id', 'source_type', 'scraped_at'];

    for (const field of required) {
      if (source[field] === undefined || source[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    return true;
  }

  // Update operations
  async updateArtistConcertCounts(artistIds: string[]): Promise<BatchResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Updating artist concert counts', { count: artistIds.length });

      await this.clickhouseClient.command({
        query: `
          ALTER TABLE artists
          UPDATE
            concerts_count = (
              SELECT COUNT(*)
              FROM concerts
              WHERE artist_id = artists.id
            ),
            updated_at = now()
          WHERE id IN ({artist_ids:Array(String)})
        `,
        query_params: { artist_ids: artistIds },
      });

      const duration = Date.now() - startTime;

      return {
        success: true,
        processedCount: artistIds.length,
        errorCount: 0,
        errors: [],
        duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error('Update failed');

      this.logger.error('Failed to update artist concert counts', {
        error: err.message,
        count: artistIds.length,
        duration,
      });

      return {
        success: false,
        processedCount: 0,
        errorCount: artistIds.length,
        errors: [err],
        duration,
      };
    }
  }

  async updateVenueConcertCounts(venueIds: string[]): Promise<BatchResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Updating venue concert counts', { count: venueIds.length });

      await this.clickhouseClient.command({
        query: `
          ALTER TABLE venues
          UPDATE
            concerts_count = (
              SELECT COUNT(*)
              FROM concerts
              WHERE venue_id = venues.id
            ),
            updated_at = now()
          WHERE id IN ({venue_ids:Array(String)})
        `,
        query_params: { venue_ids: venueIds },
      });

      const duration = Date.now() - startTime;

      return {
        success: true,
        processedCount: venueIds.length,
        errorCount: 0,
        errors: [],
        duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error('Update failed');

      this.logger.error('Failed to update venue concert counts', {
        error: err.message,
        count: venueIds.length,
        duration,
      });

      return {
        success: false,
        processedCount: 0,
        errorCount: venueIds.length,
        errors: [err],
        duration,
      };
    }
  }

  // Sleep utility
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get configuration
  getConfig(): BatchConfig {
    return { ...this.config };
  }

  // Update configuration
  updateConfig(newConfig: Partial<BatchConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Batch processor configuration updated', this.config);
  }
}

// Semaphore for limiting concurrent operations
class Semaphore {
  private permits: number;
  private waiting: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        resolve(() => this.release());
      } else {
        this.waiting.push(() => {
          this.permits--;
          resolve(() => this.release());
        });
      }
    });
  }

  private release(): void {
    this.permits++;

    const next = this.waiting.shift();
    if (next) {
      next();
    }
  }
}