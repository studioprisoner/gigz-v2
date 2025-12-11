import { z } from 'zod';
import {
  BaseScraper,
  type ScrapedArtist,
  type ScrapedVenue,
  type ScrapedConcert,
  type ScraperConfig,
  type DiscoveryParams,
  DEFAULT_RATE_LIMITS,
} from './base.js';

// Setlist.fm API response schemas
const SetlistFmArtistSchema = z.object({
  mbid: z.string(),
  name: z.string(),
  sortName: z.string().optional(),
  disambiguation: z.string().optional(),
  url: z.string().optional(),
});

const SetlistFmVenueSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.object({
    id: z.string(),
    name: z.string(),
    state: z.string().optional(),
    stateCode: z.string().optional(),
    coords: z.object({
      lat: z.number(),
      long: z.number(),
    }).optional(),
    country: z.object({
      code: z.string(),
      name: z.string(),
    }),
  }),
  url: z.string().optional(),
});

const SetlistFmSongSchema = z.object({
  name: z.string(),
  cover: z.object({
    mbid: z.string().optional(),
    name: z.string().optional(),
    sortName: z.string().optional(),
  }).optional(),
  info: z.string().optional(),
  tape: z.boolean().optional(),
});

const SetlistFmSetSchema = z.object({
  name: z.string().optional(),
  encore: z.number().optional(),
  song: z.array(SetlistFmSongSchema).optional(),
});

const SetlistFmSetlistSchema = z.object({
  id: z.string(),
  versionId: z.string(),
  eventDate: z.string(),
  lastUpdated: z.string(),
  artist: SetlistFmArtistSchema,
  venue: SetlistFmVenueSchema,
  tour: z.object({
    name: z.string(),
  }).optional(),
  sets: z.object({
    set: z.array(SetlistFmSetSchema).optional(),
  }).optional(),
  info: z.string().optional(),
  url: z.string().optional(),
});

const SetlistFmSearchResponseSchema = z.object({
  type: z.string(),
  itemsPerPage: z.number(),
  page: z.number(),
  total: z.number(),
  setlist: z.array(SetlistFmSetlistSchema).optional(),
});

type SetlistFmSetlist = z.infer<typeof SetlistFmSetlistSchema>;
type SetlistFmSearchResponse = z.infer<typeof SetlistFmSearchResponseSchema>;

// Setlist.fm scraper implementation
export class SetlistFmScraper extends BaseScraper {
  private apiKey: string;
  private baseUrl = 'https://api.setlist.fm/rest/1.0';

  constructor(apiKey: string, logger: any) {
    const config: ScraperConfig = {
      source: 'setlistfm',
      apiKey,
      baseUrl: 'https://api.setlist.fm/rest/1.0',
      rateLimitConfig: DEFAULT_RATE_LIMITS.setlistfm,
      userAgent: 'Gigz Concert Scraper/1.0',
      timeout: 10000,
    };

    super(config, logger);
    this.apiKey = apiKey;
  }

  // Scrape concerts for a specific artist
  async scrapeArtistConcerts(artistId: string, params?: any): Promise<ScrapedConcert[]> {
    const concerts: ScrapedConcert[] = [];
    let page = 1;
    const limit = params?.limit || 100;

    this.logger.info(`Starting artist scrape for ${artistId}`, { source: 'setlistfm' });

    try {
      while (concerts.length < limit) {
        const url = this.buildArtistSearchUrl(artistId, page, params);
        const response = await this.makeSetlistFmRequest<SetlistFmSearchResponse>(url.toString());

        if (!response.setlist || response.setlist.length === 0) {
          this.logger.debug(`No more setlists found for artist ${artistId} on page ${page}`);
          break;
        }

        for (const setlist of response.setlist) {
          const scrapedConcert = this.convertSetlistToConcert(setlist);
          if (scrapedConcert) {
            concerts.push(scrapedConcert);
          }

          if (concerts.length >= limit) break;
        }

        // Check if we've reached the end
        if (page * response.itemsPerPage >= response.total) {
          break;
        }

        page++;

        // Rate limiting between pages
        await this.sleep(500);
      }

      this.logger.info(`Scraped ${concerts.length} concerts for artist ${artistId}`, { source: 'setlistfm' });
      return concerts;

    } catch (error) {
      this.logger.error(`Failed to scrape artist concerts for ${artistId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        source: 'setlistfm'
      });
      return concerts; // Return partial results
    }
  }

  // Scrape concerts for a specific venue
  async scrapeVenueConcerts(venueId: string, params?: any): Promise<ScrapedConcert[]> {
    const concerts: ScrapedConcert[] = [];
    let page = 1;
    const limit = params?.limit || 100;

    this.logger.info(`Starting venue scrape for ${venueId}`, { source: 'setlistfm' });

    try {
      while (concerts.length < limit) {
        const url = this.buildVenueSearchUrl(venueId, page, params);
        const response = await this.makeSetlistFmRequest<SetlistFmSearchResponse>(url.toString());

        if (!response.setlist || response.setlist.length === 0) {
          this.logger.debug(`No more setlists found for venue ${venueId} on page ${page}`);
          break;
        }

        for (const setlist of response.setlist) {
          const scrapedConcert = this.convertSetlistToConcert(setlist);
          if (scrapedConcert) {
            concerts.push(scrapedConcert);
          }

          if (concerts.length >= limit) break;
        }

        // Check if we've reached the end
        if (page * response.itemsPerPage >= response.total) {
          break;
        }

        page++;

        // Rate limiting between pages
        await this.sleep(500);
      }

      this.logger.info(`Scraped ${concerts.length} concerts for venue ${venueId}`, { source: 'setlistfm' });
      return concerts;

    } catch (error) {
      this.logger.error(`Failed to scrape venue concerts for ${venueId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        source: 'setlistfm'
      });
      return concerts; // Return partial results
    }
  }

  // Discover concerts based on search parameters
  async discoverConcerts(params: DiscoveryParams): Promise<ScrapedConcert[]> {
    const concerts: ScrapedConcert[] = [];
    let page = 1;
    const limit = params.limit || 50;

    this.logger.info('Starting concert discovery', { params, source: 'setlistfm' });

    try {
      while (concerts.length < limit) {
        const url = this.buildDiscoveryUrl(page, params);
        const response = await this.makeSetlistFmRequest<SetlistFmSearchResponse>(url.toString());

        if (!response.setlist || response.setlist.length === 0) {
          this.logger.debug(`No more setlists found on page ${page}`);
          break;
        }

        for (const setlist of response.setlist) {
          const scrapedConcert = this.convertSetlistToConcert(setlist);
          if (scrapedConcert) {
            concerts.push(scrapedConcert);
          }

          if (concerts.length >= limit) break;
        }

        // Check if we've reached the end
        if (page * response.itemsPerPage >= response.total) {
          break;
        }

        page++;

        // Rate limiting between pages
        await this.sleep(500);
      }

      this.logger.info(`Discovered ${concerts.length} concerts`, { source: 'setlistfm' });
      return concerts;

    } catch (error) {
      this.logger.error('Failed to discover concerts', {
        error: error instanceof Error ? error.message : 'Unknown error',
        params,
        source: 'setlistfm'
      });
      return concerts; // Return partial results
    }
  }

  // Get artist metadata by MusicBrainz ID
  async getArtistMetadata(artistId: string): Promise<ScrapedArtist | null> {
    try {
      const url = `${this.baseUrl}/artist/${artistId}`;
      const artist = await this.makeSetlistFmRequest<any>(url);

      return {
        name: artist.name,
        musicbrainzId: artist.mbid,
        source: 'setlistfm',
        externalId: artist.mbid,
      };
    } catch (error) {
      this.logger.warn(`Failed to get artist metadata for ${artistId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        source: 'setlistfm'
      });
      return null;
    }
  }

  // Get venue metadata by Setlist.fm venue ID
  async getVenueMetadata(venueId: string): Promise<ScrapedVenue | null> {
    try {
      const url = `${this.baseUrl}/venue/${venueId}`;
      const venue = await this.makeSetlistFmRequest<any>(url);

      return {
        name: venue.name,
        city: venue.city.name,
        country: venue.city.country.name,
        stateProvince: venue.city.state,
        latitude: venue.city.coords?.lat,
        longitude: venue.city.coords?.long,
        externalId: venue.id,
        source: 'setlistfm',
      };
    } catch (error) {
      this.logger.warn(`Failed to get venue metadata for ${venueId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        source: 'setlistfm'
      });
      return null;
    }
  }

  // Build URL for artist setlist search
  private buildArtistSearchUrl(artistId: string, page: number, params?: any): string {
    const url = new URL(`${this.baseUrl}/search/setlists`);
    url.searchParams.append('artistMbid', artistId);
    url.searchParams.append('p', page.toString());

    if (params?.startDate) {
      url.searchParams.append('date', `>=${params.startDate}`);
    }

    if (params?.endDate) {
      url.searchParams.append('date', `<=${params.endDate}`);
    }

    return url.toString();
  }

  // Build URL for venue setlist search
  private buildVenueSearchUrl(venueId: string, page: number, params?: any): string {
    const url = new URL(`${this.baseUrl}/search/setlists`);
    url.searchParams.append('venueId', venueId);
    url.searchParams.append('p', page.toString());

    if (params?.startDate) {
      url.searchParams.append('date', `>=${params.startDate}`);
    }

    if (params?.endDate) {
      url.searchParams.append('date', `<=${params.endDate}`);
    }

    return url.toString();
  }

  // Build URL for discovery search
  private buildDiscoveryUrl(page: number, params: DiscoveryParams): string {
    const url = new URL(`${this.baseUrl}/search/setlists`);
    url.searchParams.append('p', page.toString());

    if (params.location) {
      url.searchParams.append('cityName', params.location);
    }

    if (params.dateRange) {
      url.searchParams.append('date', `>=${params.dateRange.start}`);
      url.searchParams.append('date', `<=${params.dateRange.end}`);
    }

    return url.toString();
  }

  // Make authenticated request to Setlist.fm API
  private async makeSetlistFmRequest<T>(url: string): Promise<T> {
    return this.makeRequest<T>(url, {
      headers: {
        'x-api-key': this.apiKey,
        'Accept': 'application/json',
      },
    });
  }

  // Convert Setlist.fm setlist to our ScrapedConcert format
  private convertSetlistToConcert(setlist: SetlistFmSetlist): ScrapedConcert | null {
    try {
      // Extract setlist songs
      const songs: string[] = [];
      if (setlist.sets?.set) {
        for (const set of setlist.sets.set) {
          if (set.song) {
            for (const song of set.song) {
              let songName = song.name;

              // Add cover notation if it's a cover
              if (song.cover) {
                songName = `${songName} (${song.cover.name} cover)`;
              }

              // Add additional info if present
              if (song.info) {
                songName = `${songName} [${song.info}]`;
              }

              songs.push(songName);
            }
          }
        }
      }

      // Convert artist data
      const artist: ScrapedArtist = {
        name: setlist.artist.name,
        musicbrainzId: setlist.artist.mbid,
        source: 'setlistfm',
        aliases: setlist.artist.sortName && setlist.artist.sortName !== setlist.artist.name
          ? [setlist.artist.sortName]
          : undefined,
      };

      // Convert venue data
      const venue: ScrapedVenue = {
        name: setlist.venue.name,
        city: setlist.venue.city.name,
        country: setlist.venue.city.country.name,
        stateProvince: setlist.venue.city.state,
        latitude: setlist.venue.city.coords?.lat,
        longitude: setlist.venue.city.coords?.long,
        externalId: setlist.venue.id,
        source: 'setlistfm',
      };

      // Create concert object
      const concert: ScrapedConcert = {
        date: this.normalizeDate(setlist.eventDate),
        artist,
        venue,
        tourName: setlist.tour?.name,
        setlist: songs,
        setlistSource: 'setlistfm',
        attendanceCount: 0, // Setlist.fm doesn't provide attendance
        source: 'setlistfm',
        sourceUrl: setlist.url,
        externalId: setlist.id,
      };

      return this.validateScrapedConcert(concert);

    } catch (error) {
      this.logger.warn('Failed to convert setlist to concert', {
        error: error instanceof Error ? error.message : 'Unknown error',
        setlistId: setlist.id,
        source: 'setlistfm'
      });
      return null;
    }
  }

  // Search for artist by name to get MusicBrainz ID
  async searchArtist(artistName: string): Promise<{ mbid: string; name: string }[]> {
    try {
      const url = new URL(`${this.baseUrl}/search/artists`);
      url.searchParams.append('artistName', artistName);

      const response = await this.makeSetlistFmRequest<any>(url.toString());

      return response.artist?.map((artist: any) => ({
        mbid: artist.mbid,
        name: artist.name,
      })) || [];

    } catch (error) {
      this.logger.error(`Failed to search for artist: ${artistName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        source: 'setlistfm'
      });
      return [];
    }
  }

  // Search for venue by name and city
  async searchVenue(venueName: string, cityName: string): Promise<{ id: string; name: string; city: string }[]> {
    try {
      const url = new URL(`${this.baseUrl}/search/venues`);
      url.searchParams.append('name', venueName);
      url.searchParams.append('cityName', cityName);

      const response = await this.makeSetlistFmRequest<any>(url.toString());

      return response.venue?.map((venue: any) => ({
        id: venue.id,
        name: venue.name,
        city: venue.city.name,
      })) || [];

    } catch (error) {
      this.logger.error(`Failed to search for venue: ${venueName}, ${cityName}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        source: 'setlistfm'
      });
      return [];
    }
  }
}