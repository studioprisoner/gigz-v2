import PQueue from 'p-queue';
import { z } from 'zod';
import type { Artist, Venue, Concert } from '@gigz/clickhouse';

// Scraped data schemas - before entity resolution
export const ScrapedArtistSchema = z.object({
  name: z.string(),
  externalId: z.string().optional(),
  musicbrainzId: z.string().optional(),
  spotifyId: z.string().optional(),
  imageUrl: z.string().optional(),
  source: z.string(),
  aliases: z.array(z.string()).optional(),
});

export const ScrapedVenueSchema = z.object({
  name: z.string(),
  city: z.string(),
  country: z.string(),
  address: z.string().optional(),
  stateProvince: z.string().optional(),
  postalCode: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  capacity: z.number().optional(),
  venueType: z.string().optional(),
  websiteUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  externalId: z.string().optional(),
  source: z.string(),
});

export const ScrapedConcertSchema = z.object({
  date: z.string(),
  artist: ScrapedArtistSchema,
  venue: ScrapedVenueSchema,
  tourName: z.string().optional(),
  eventName: z.string().optional(),
  setlist: z.array(z.string()).optional(),
  setlistSource: z.string().optional(),
  supportingArtists: z.array(z.string()).optional(),
  attendanceCount: z.number().default(0),
  source: z.string(),
  sourceUrl: z.string().optional(),
  externalId: z.string().optional(),
});

export type ScrapedArtist = z.infer<typeof ScrapedArtistSchema>;
export type ScrapedVenue = z.infer<typeof ScrapedVenueSchema>;
export type ScrapedConcert = z.infer<typeof ScrapedConcertSchema>;

// Rate limiting configuration per source
export interface RateLimitConfig {
  requestsPerSecond: number;
  maxConcurrency: number;
  retryDelay: number;
  maxRetries: number;
}

export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  setlistfm: {
    requestsPerSecond: 2, // Setlist.fm allows 2 requests per second
    maxConcurrency: 1,
    retryDelay: 1000,
    maxRetries: 3,
  },
  songkick: {
    requestsPerSecond: 10,
    maxConcurrency: 2,
    retryDelay: 500,
    maxRetries: 3,
  },
  bandsintown: {
    requestsPerSecond: 10,
    maxConcurrency: 2,
    retryDelay: 500,
    maxRetries: 3,
  },
  musicbrainz: {
    requestsPerSecond: 1, // MusicBrainz has strict rate limits
    maxConcurrency: 1,
    retryDelay: 1000,
    maxRetries: 5,
  },
};

// Scraper configuration interface
export interface ScraperConfig {
  source: string;
  apiKey?: string;
  baseUrl: string;
  rateLimitConfig: RateLimitConfig;
  userAgent: string;
  timeout: number;
}

// Discovery parameters interface
export interface DiscoveryParams {
  location?: string;
  genre?: string;
  dateRange?: {
    start: string;
    end: string;
  };
  limit?: number;
  offset?: number;
}

// Abstract base scraper class
export abstract class BaseScraper {
  protected queue: PQueue;
  protected config: ScraperConfig;
  protected logger: any; // Will be injected

  constructor(config: ScraperConfig, logger: any) {
    this.config = config;
    this.logger = logger;

    // Set up rate-limited queue
    this.queue = new PQueue({
      interval: 1000,
      intervalCap: config.rateLimitConfig.requestsPerSecond,
      concurrency: config.rateLimitConfig.maxConcurrency,
    });

    // Log queue events for debugging
    this.queue.on('active', () => {
      this.logger.debug(`Active requests: ${this.queue.pending} pending, ${this.queue.size} queued`);
    });

    this.queue.on('error', (error: Error) => {
      this.logger.error('Queue error', { error: error.message, source: this.config.source });
    });
  }

  // Abstract methods that each scraper must implement
  abstract scrapeArtistConcerts(artistId: string, params?: any): Promise<ScrapedConcert[]>;
  abstract scrapeVenueConcerts(venueId: string, params?: any): Promise<ScrapedConcert[]>;
  abstract discoverConcerts(params: DiscoveryParams): Promise<ScrapedConcert[]>;

  // Optional method for getting artist/venue metadata
  async getArtistMetadata(artistId: string): Promise<ScrapedArtist | null> {
    return null; // Default implementation - override if supported
  }

  async getVenueMetadata(venueId: string): Promise<ScrapedVenue | null> {
    return null; // Default implementation - override if supported
  }

  // Utility method for making rate-limited HTTP requests
  protected async makeRequest<T = any>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    return this.queue.add(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            'User-Agent': this.config.userAgent,
            'Accept': 'application/json',
            ...options.headers,
          },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json() as T;
      } catch (error) {
        clearTimeout(timeout);
        this.logger.error('Request failed', {
          url,
          error: error instanceof Error ? error.message : 'Unknown error',
          source: this.config.source,
        });
        throw error;
      }
    });
  }

  // Utility method for handling retries with exponential backoff
  protected async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = this.config.rateLimitConfig.maxRetries,
    baseDelay: number = this.config.rateLimitConfig.retryDelay
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        if (attempt <= maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          this.logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms`, {
            error: lastError.message,
            source: this.config.source,
          });
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  // Helper method for sleeping/delays
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Normalize date to YYYY-MM-DD format
  protected normalizeDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toISOString().split('T')[0];
    } catch (error) {
      this.logger.warn('Invalid date format', { dateString, source: this.config.source });
      return dateString; // Return as-is if parsing fails
    }
  }

  // Normalize and clean text fields
  protected normalizeText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
      .replace(/[^\w\s\-'.&()]/g, '') // Remove special characters except common ones
      .toLowerCase();
  }

  // Generate a normalized name for matching
  protected generateNormalizedName(name: string): string {
    return this.normalizeText(name)
      .replace(/\b(the|a|an)\b/g, '') // Remove common articles
      .replace(/\s+/g, ''); // Remove all spaces
  }

  // Extract setlist from various formats
  protected extractSetlist(rawSetlist: any): string[] {
    if (!rawSetlist) return [];

    if (Array.isArray(rawSetlist)) {
      return rawSetlist.map(song => typeof song === 'string' ? song : song.name || song.title || '').filter(Boolean);
    }

    if (typeof rawSetlist === 'string') {
      return rawSetlist
        .split(/[\n\r]+/)
        .map(line => line.trim())
        .filter(Boolean);
    }

    return [];
  }

  // Validate scraped concert data
  protected validateScrapedConcert(concert: any): ScrapedConcert {
    try {
      return ScrapedConcertSchema.parse(concert);
    } catch (error) {
      this.logger.error('Invalid scraped concert data', {
        error: error instanceof Error ? error.message : 'Validation failed',
        concert,
        source: this.config.source,
      });
      throw new Error('Invalid concert data format');
    }
  }

  // Get scraper statistics
  getStats() {
    return {
      source: this.config.source,
      queue: {
        size: this.queue.size,
        pending: this.queue.pending,
        isPaused: this.queue.isPaused,
      },
      rateLimits: this.config.rateLimitConfig,
    };
  }

  // Cleanup resources
  async shutdown(): Promise<void> {
    this.logger.info(`Shutting down ${this.config.source} scraper`);
    await this.queue.onIdle();
    this.queue.pause();
  }
}