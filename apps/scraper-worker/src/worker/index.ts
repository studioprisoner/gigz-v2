import { Worker, Job } from 'bullmq';
import {
  type ScrapeJobData,
  type ArtistScrapeJob,
  type VenueScrapeJob,
  type DiscoverJob,
  type BackfillJob,
  SCRAPER_QUEUE_NAME,
} from '../queue/index.js';
import { EntityResolver } from '../services/entity-resolver.js';
import { SetlistFmScraper } from '../scrapers/setlistfm.js';
import { BaseScraper } from '../scrapers/base.js';

// Job processing statistics
interface JobStats {
  concertsProcessed: number;
  artistsCreated: number;
  venuesCreated: number;
  concertsCreated: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

// Worker class to handle scraper jobs
export class ScraperWorker {
  private worker: Worker;
  private entityResolver: EntityResolver;
  private scrapers: Map<string, BaseScraper> = new Map();
  private logger: any;
  private clickhouseClient: any;

  constructor(
    entityResolver: EntityResolver,
    clickhouseClient: any,
    redisConnection: any,
    logger: any
  ) {
    this.entityResolver = entityResolver;
    this.clickhouseClient = clickhouseClient;
    this.logger = logger;

    // Initialize scrapers
    this.initializeScrapers();

    // Create BullMQ worker
    this.worker = new Worker(SCRAPER_QUEUE_NAME, this.processJob.bind(this), {
      connection: redisConnection,
      concurrency: 2, // Process 2 jobs concurrently
    });

    // Worker event handlers
    this.setupEventHandlers();
  }

  // Initialize all available scrapers
  private initializeScrapers(): void {
    // Setlist.fm scraper
    const setlistfmApiKey = process.env.SETLISTFM_API_KEY;
    if (setlistfmApiKey) {
      this.scrapers.set('setlistfm', new SetlistFmScraper(setlistfmApiKey, this.logger));
      this.logger.info('Initialized Setlist.fm scraper');
    } else {
      this.logger.warn('SETLISTFM_API_KEY not found, Setlist.fm scraper disabled');
    }

    // TODO: Add other scrapers (Songkick, Bandsintown, MusicBrainz)
    // this.scrapers.set('songkick', new SongkickScraper(apiKey, this.logger));
    // this.scrapers.set('bandsintown', new BandsintownScraper(apiKey, this.logger));
    // this.scrapers.set('musicbrainz', new MusicbrainzScraper(this.logger));
  }

  // Setup worker event handlers
  private setupEventHandlers(): void {
    this.worker.on('ready', () => {
      this.logger.info('Scraper worker is ready and waiting for jobs');
    });

    this.worker.on('active', (job: Job) => {
      this.logger.info(`Processing job ${job.id}`, {
        jobName: job.name,
        jobData: job.data,
      });
    });

    this.worker.on('completed', (job: Job, result: any) => {
      this.logger.info(`Job ${job.id} completed`, {
        jobName: job.name,
        processingTime: Date.now() - job.processedOn!,
        result: result.stats,
      });
    });

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      this.logger.error(`Job ${job?.id || 'unknown'} failed`, {
        jobName: job?.name,
        error: error.message,
        stack: error.stack,
      });
    });

    this.worker.on('error', (error: Error) => {
      this.logger.error('Worker error', {
        error: error.message,
        stack: error.stack,
      });
    });

    this.worker.on('stalled', (jobId: string) => {
      this.logger.warn(`Job ${jobId} stalled`);
    });
  }

  // Main job processing function
  private async processJob(job: Job<ScrapeJobData>): Promise<any> {
    const startTime = new Date();
    const stats: JobStats = {
      concertsProcessed: 0,
      artistsCreated: 0,
      venuesCreated: 0,
      concertsCreated: 0,
      errors: 0,
      startTime,
    };

    this.logger.info(`Processing ${job.data.type} job for ${job.data.source}`, {
      jobId: job.id,
      jobData: job.data,
    });

    try {
      // Get the appropriate scraper
      const scraper = this.scrapers.get(job.data.source);
      if (!scraper) {
        throw new Error(`No scraper available for source: ${job.data.source}`);
      }

      // Route to appropriate handler based on job type
      switch (job.data.type) {
        case 'artist':
          return await this.processArtistScrapeJob(job.data as ArtistScrapeJob, scraper, stats);

        case 'venue':
          return await this.processVenueScrapeJob(job.data as VenueScrapeJob, scraper, stats);

        case 'discover':
          return await this.processDiscoverJob(job.data as DiscoverJob, scraper, stats);

        case 'backfill':
          return await this.processBackfillJob(job.data as BackfillJob, scraper, stats);

        default:
          throw new Error(`Unknown job type: ${job.data.type}`);
      }

    } catch (error) {
      stats.errors++;
      this.logger.error(`Job processing failed`, {
        jobId: job.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;

    } finally {
      stats.endTime = new Date();
      this.logger.info(`Job processing completed`, {
        jobId: job.id,
        stats,
        duration: stats.endTime.getTime() - stats.startTime.getTime(),
      });
    }
  }

  // Process artist scrape job
  private async processArtistScrapeJob(
    jobData: ArtistScrapeJob,
    scraper: BaseScraper,
    stats: JobStats
  ): Promise<{ success: boolean; stats: JobStats }> {
    const { entityId, params } = jobData;

    if (!entityId) {
      throw new Error('Artist ID is required for artist scrape job');
    }

    // Scrape concerts for the artist
    const scrapedConcerts = await scraper.scrapeArtistConcerts(entityId, params);

    // Process the scraped concerts
    await this.processScrapedConcerts(scrapedConcerts, stats);

    return { success: true, stats };
  }

  // Process venue scrape job
  private async processVenueScrapeJob(
    jobData: VenueScrapeJob,
    scraper: BaseScraper,
    stats: JobStats
  ): Promise<{ success: boolean; stats: JobStats }> {
    const { entityId, params } = jobData;

    if (!entityId) {
      throw new Error('Venue ID is required for venue scrape job');
    }

    // Scrape concerts for the venue
    const scrapedConcerts = await scraper.scrapeVenueConcerts(entityId, params);

    // Process the scraped concerts
    await this.processScrapedConcerts(scrapedConcerts, stats);

    return { success: true, stats };
  }

  // Process discover job
  private async processDiscoverJob(
    jobData: DiscoverJob,
    scraper: BaseScraper,
    stats: JobStats
  ): Promise<{ success: boolean; stats: JobStats }> {
    const { params = {} } = jobData;

    // Discover concerts based on parameters
    const scrapedConcerts = await scraper.discoverConcerts(params);

    // Process the scraped concerts
    await this.processScrapedConcerts(scrapedConcerts, stats);

    return { success: true, stats };
  }

  // Process backfill job
  private async processBackfillJob(
    jobData: BackfillJob,
    scraper: BaseScraper,
    stats: JobStats
  ): Promise<{ success: boolean; stats: JobStats }> {
    const { params } = jobData;

    if (!params?.startDate || !params?.endDate) {
      throw new Error('Start date and end date are required for backfill job');
    }

    const batchSize = params.batchSize || 100;
    let offset = 0;
    let hasMoreData = true;

    while (hasMoreData) {
      this.logger.info(`Processing backfill batch`, {
        offset,
        batchSize,
        startDate: params.startDate,
        endDate: params.endDate,
      });

      // Discover concerts in date range with pagination
      const discoveryParams = {
        dateRange: {
          start: params.startDate,
          end: params.endDate,
        },
        limit: batchSize,
        offset,
      };

      const scrapedConcerts = await scraper.discoverConcerts(discoveryParams);

      if (scrapedConcerts.length === 0) {
        hasMoreData = false;
        break;
      }

      // Process this batch
      await this.processScrapedConcerts(scrapedConcerts, stats);

      offset += scrapedConcerts.length;

      // If we got less than the batch size, we're done
      if (scrapedConcerts.length < batchSize) {
        hasMoreData = false;
      }

      // Rate limiting between batches
      await this.sleep(1000);
    }

    return { success: true, stats };
  }

  // Process scraped concerts through entity resolution and save to ClickHouse
  private async processScrapedConcerts(scrapedConcerts: any[], stats: JobStats): Promise<void> {
    if (scrapedConcerts.length === 0) {
      this.logger.info('No concerts to process');
      return;
    }

    this.logger.info(`Processing ${scrapedConcerts.length} scraped concerts`);

    // Resolve entities and deduplicate
    const resolvedConcerts = await this.entityResolver.resolveConcerts(scrapedConcerts);

    // Separate new entities for batch insertion
    const newArtists: any[] = [];
    const newVenues: any[] = [];
    const newConcerts: any[] = [];

    for (const concert of resolvedConcerts) {
      stats.concertsProcessed++;

      if (concert.artist.isNew) {
        newArtists.push(concert.artist);
        stats.artistsCreated++;
      }

      if (concert.venue.isNew) {
        newVenues.push(concert.venue);
        stats.venuesCreated++;
      }

      if (concert.isNew) {
        newConcerts.push(concert);
        stats.concertsCreated++;
      }
    }

    // Batch insert new entities
    if (newArtists.length > 0) {
      this.logger.info(`Inserting ${newArtists.length} new artists`);
      await this.batchInsertArtists(newArtists);
    }

    if (newVenues.length > 0) {
      this.logger.info(`Inserting ${newVenues.length} new venues`);
      await this.batchInsertVenues(newVenues);
    }

    if (newConcerts.length > 0) {
      this.logger.info(`Inserting ${newConcerts.length} new concerts`);
      await this.batchInsertConcerts(newConcerts);
    }

    // Update concert counts for artists and venues
    await this.updateConcertCounts(resolvedConcerts);

    this.logger.info('Completed processing scraped concerts', {
      processed: stats.concertsProcessed,
      newArtists: stats.artistsCreated,
      newVenues: stats.venuesCreated,
      newConcerts: stats.concertsCreated,
    });
  }

  // Batch insert artists
  private async batchInsertArtists(artists: any[]): Promise<void> {
    try {
      await this.clickhouseClient.insert({
        table: 'artists',
        values: artists.map(artist => ({
          ...artist,
          isNew: undefined, // Remove resolution metadata
          aliases: undefined,
        })),
        format: 'JSONEachRow',
      });
    } catch (error) {
      this.logger.error('Failed to batch insert artists', {
        error: error instanceof Error ? error.message : 'Unknown error',
        count: artists.length,
      });
      throw error;
    }
  }

  // Batch insert venues
  private async batchInsertVenues(venues: any[]): Promise<void> {
    try {
      await this.clickhouseClient.insert({
        table: 'venues',
        values: venues.map(venue => ({
          ...venue,
          isNew: undefined, // Remove resolution metadata
        })),
        format: 'JSONEachRow',
      });
    } catch (error) {
      this.logger.error('Failed to batch insert venues', {
        error: error instanceof Error ? error.message : 'Unknown error',
        count: venues.length,
      });
      throw error;
    }
  }

  // Batch insert concerts
  private async batchInsertConcerts(concerts: any[]): Promise<void> {
    try {
      await this.clickhouseClient.insert({
        table: 'concerts',
        values: concerts.map(concert => ({
          ...concert,
          isNew: undefined, // Remove resolution metadata
          artist: undefined,
          venue: undefined,
        })),
        format: 'JSONEachRow',
      });
    } catch (error) {
      this.logger.error('Failed to batch insert concerts', {
        error: error instanceof Error ? error.message : 'Unknown error',
        count: concerts.length,
      });
      throw error;
    }
  }

  // Update concert counts for artists and venues
  private async updateConcertCounts(resolvedConcerts: any[]): Promise<void> {
    const artistIds = new Set<string>();
    const venueIds = new Set<string>();

    for (const concert of resolvedConcerts) {
      artistIds.add(concert.artist.id);
      venueIds.add(concert.venue.id);
    }

    // Update artist concert counts
    if (artistIds.size > 0) {
      try {
        await this.clickhouseClient.command({
          query: `
            ALTER TABLE artists UPDATE concerts_count = (
              SELECT COUNT(*) FROM concerts WHERE artist_id = artists.id
            )
            WHERE id IN ({artist_ids:Array(String)})
          `,
          query_params: { artist_ids: Array.from(artistIds) },
        });
      } catch (error) {
        this.logger.error('Failed to update artist concert counts', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Update venue concert counts
    if (venueIds.size > 0) {
      try {
        await this.clickhouseClient.command({
          query: `
            ALTER TABLE venues UPDATE concerts_count = (
              SELECT COUNT(*) FROM concerts WHERE venue_id = venues.id
            )
            WHERE id IN ({venue_ids:Array(String)})
          `,
          query_params: { venue_ids: Array.from(venueIds) },
        });
      } catch (error) {
        this.logger.error('Failed to update venue concert counts', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  // Utility sleep function
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get worker statistics
  getStats() {
    return {
      isRunning: !this.worker.closing,
      concurrency: this.worker.concurrency,
      scrapers: Array.from(this.scrapers.keys()),
    };
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down scraper worker...');

    // Close the worker
    await this.worker.close();

    // Shutdown all scrapers
    for (const [name, scraper] of this.scrapers) {
      this.logger.info(`Shutting down ${name} scraper`);
      await scraper.shutdown();
    }

    this.logger.info('Scraper worker shutdown complete');
  }
}