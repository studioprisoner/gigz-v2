import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Artist, Venue, Concert, ArtistAlias } from '@gigz/clickhouse';
import type { ScrapedArtist, ScrapedVenue, ScrapedConcert } from '../scrapers/base.js';

// Resolution result interfaces
export interface ResolvedArtist extends Artist {
  isNew: boolean;
  aliases: ArtistAlias[];
}

export interface ResolvedVenue extends Venue {
  isNew: boolean;
}

export interface ResolvedConcert extends Concert {
  isNew: boolean;
  artist: ResolvedArtist;
  venue: ResolvedVenue;
}

// Matching criteria interfaces
export interface ArtistMatchCriteria {
  name: string;
  normalizedName: string;
  musicbrainzId?: string;
  spotifyId?: string;
  aliases?: string[];
}

export interface VenueMatchCriteria {
  name: string;
  normalizedName: string;
  city: string;
  country: string;
  latitude?: number;
  longitude?: number;
}

export interface ConcertMatchCriteria {
  artistId: string;
  venueId: string;
  date: string;
}

// Entity resolution service
export class EntityResolver {
  private logger: any;
  private clickhouseClient: any;

  constructor(clickhouseClient: any, logger: any) {
    this.clickhouseClient = clickhouseClient;
    this.logger = logger;
  }

  // Resolve artist - find existing or create new
  async resolveArtist(scrapedArtist: ScrapedArtist): Promise<ResolvedArtist> {
    const criteria = this.buildArtistMatchCriteria(scrapedArtist);

    // Try to find existing artist
    const existingArtist = await this.findExistingArtist(criteria);

    if (existingArtist) {
      this.logger.debug('Found existing artist', {
        artistId: existingArtist.id,
        name: existingArtist.name
      });

      // Update aliases if new ones provided
      const updatedAliases = await this.updateArtistAliases(existingArtist.id, scrapedArtist.aliases || []);

      return {
        ...existingArtist,
        isNew: false,
        aliases: updatedAliases,
      };
    }

    // Create new artist
    const newArtist = await this.createNewArtist(scrapedArtist);
    this.logger.info('Created new artist', {
      artistId: newArtist.id,
      name: newArtist.name,
      source: newArtist.source
    });

    return {
      ...newArtist,
      isNew: true,
      aliases: [],
    };
  }

  // Resolve venue - find existing or create new
  async resolveVenue(scrapedVenue: ScrapedVenue): Promise<ResolvedVenue> {
    const criteria = this.buildVenueMatchCriteria(scrapedVenue);

    // Try to find existing venue
    const existingVenue = await this.findExistingVenue(criteria);

    if (existingVenue) {
      this.logger.debug('Found existing venue', {
        venueId: existingVenue.id,
        name: existingVenue.name,
        city: existingVenue.city
      });

      return {
        ...existingVenue,
        isNew: false,
      };
    }

    // Create new venue
    const newVenue = await this.createNewVenue(scrapedVenue);
    this.logger.info('Created new venue', {
      venueId: newVenue.id,
      name: newVenue.name,
      city: newVenue.city,
      source: newVenue.source
    });

    return {
      ...newVenue,
      isNew: true,
    };
  }

  // Resolve concert - find existing or create new
  async resolveConcert(
    scrapedConcert: ScrapedConcert,
    resolvedArtist: ResolvedArtist,
    resolvedVenue: ResolvedVenue
  ): Promise<ResolvedConcert> {
    const criteria: ConcertMatchCriteria = {
      artistId: resolvedArtist.id,
      venueId: resolvedVenue.id,
      date: scrapedConcert.date,
    };

    // Try to find existing concert
    const existingConcert = await this.findExistingConcert(criteria);

    if (existingConcert) {
      this.logger.debug('Found existing concert', {
        concertId: existingConcert.id,
        artistName: resolvedArtist.name,
        venueName: resolvedVenue.name,
        date: existingConcert.date
      });

      return {
        ...existingConcert,
        isNew: false,
        artist: resolvedArtist,
        venue: resolvedVenue,
      };
    }

    // Create new concert
    const newConcert = await this.createNewConcert(scrapedConcert, resolvedArtist.id, resolvedVenue.id);
    this.logger.info('Created new concert', {
      concertId: newConcert.id,
      artistName: resolvedArtist.name,
      venueName: resolvedVenue.name,
      date: newConcert.date,
      source: newConcert.source
    });

    return {
      ...newConcert,
      isNew: true,
      artist: resolvedArtist,
      venue: resolvedVenue,
    };
  }

  // Build artist matching criteria
  private buildArtistMatchCriteria(scrapedArtist: ScrapedArtist): ArtistMatchCriteria {
    return {
      name: scrapedArtist.name,
      normalizedName: this.normalizeText(scrapedArtist.name),
      musicbrainzId: scrapedArtist.musicbrainzId,
      spotifyId: scrapedArtist.spotifyId,
      aliases: scrapedArtist.aliases,
    };
  }

  // Build venue matching criteria
  private buildVenueMatchCriteria(scrapedVenue: ScrapedVenue): VenueMatchCriteria {
    return {
      name: scrapedVenue.name,
      normalizedName: this.normalizeText(scrapedVenue.name),
      city: scrapedVenue.city,
      country: scrapedVenue.country,
      latitude: scrapedVenue.latitude,
      longitude: scrapedVenue.longitude,
    };
  }

  // Find existing artist using multiple matching strategies
  private async findExistingArtist(criteria: ArtistMatchCriteria): Promise<Artist | null> {
    // Strategy 1: Exact external ID match
    if (criteria.musicbrainzId) {
      const artist = await this.clickhouseClient.query(`
        SELECT * FROM artists
        WHERE musicbrainz_id = {musicbrainz_id:String}
        LIMIT 1
      `, { musicbrainz_id: criteria.musicbrainzId }).then((result: any) => result.data[0] || null);

      if (artist) return artist;
    }

    if (criteria.spotifyId) {
      const artist = await this.clickhouseClient.query(`
        SELECT * FROM artists
        WHERE spotify_id = {spotify_id:String}
        LIMIT 1
      `, { spotify_id: criteria.spotifyId }).then((result: any) => result.data[0] || null);

      if (artist) return artist;
    }

    // Strategy 2: Normalized name match
    const artistByName = await this.clickhouseClient.query(`
      SELECT * FROM artists
      WHERE name_normalized = {name_normalized:String}
      LIMIT 1
    `, { name_normalized: criteria.normalizedName }).then((result: any) => result.data[0] || null);

    if (artistByName) return artistByName;

    // Strategy 3: Alias match
    if (criteria.aliases && criteria.aliases.length > 0) {
      const normalizedAliases = criteria.aliases.map(alias => this.normalizeText(alias));

      const artistByAlias = await this.clickhouseClient.query(`
        SELECT a.* FROM artists a
        JOIN artist_aliases aa ON a.id = aa.artist_id
        WHERE aa.alias_normalized IN ({aliases:Array(String)})
        LIMIT 1
      `, { aliases: normalizedAliases }).then((result: any) => result.data[0] || null);

      if (artistByAlias) return artistByAlias;
    }

    return null;
  }

  // Find existing venue using multiple matching strategies
  private async findExistingVenue(criteria: VenueMatchCriteria): Promise<Venue | null> {
    // Strategy 1: Exact name + city + country match
    const venueByLocation = await this.clickhouseClient.query(`
      SELECT * FROM venues
      WHERE name_normalized = {name_normalized:String}
      AND city = {city:String}
      AND country = {country:String}
      LIMIT 1
    `, {
      name_normalized: criteria.normalizedName,
      city: criteria.city,
      country: criteria.country
    }).then((result: any) => result.data[0] || null);

    if (venueByLocation) return venueByLocation;

    // Strategy 2: Geographic proximity (within 1km)
    if (criteria.latitude && criteria.longitude) {
      const venueByGeo = await this.clickhouseClient.query(`
        SELECT * FROM venues
        WHERE geoDistance(longitude, latitude, {lng:Float64}, {lat:Float64}) < 1000
        AND city = {city:String}
        LIMIT 1
      `, {
        lng: criteria.longitude,
        lat: criteria.latitude,
        city: criteria.city
      }).then((result: any) => result.data[0] || null);

      if (venueByGeo) return venueByGeo;
    }

    return null;
  }

  // Find existing concert
  private async findExistingConcert(criteria: ConcertMatchCriteria): Promise<Concert | null> {
    return await this.clickhouseClient.query(`
      SELECT * FROM concerts
      WHERE artist_id = {artist_id:String}
      AND venue_id = {venue_id:String}
      AND date = {date:String}
      LIMIT 1
    `, criteria).then((result: any) => result.data[0] || null);
  }

  // Create new artist
  private async createNewArtist(scrapedArtist: ScrapedArtist): Promise<Artist> {
    const artist: Artist = {
      id: uuidv4(),
      name: scrapedArtist.name,
      name_normalized: this.normalizeText(scrapedArtist.name),
      musicbrainz_id: scrapedArtist.musicbrainzId,
      spotify_id: scrapedArtist.spotifyId,
      image_url: scrapedArtist.imageUrl,
      concerts_count: 0,
      verified: false,
      source: scrapedArtist.source,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await this.clickhouseClient.insert({
      table: 'artists',
      values: [artist],
      format: 'JSONEachRow',
    });

    // Create aliases if provided
    if (scrapedArtist.aliases && scrapedArtist.aliases.length > 0) {
      await this.createArtistAliases(artist.id, scrapedArtist.aliases);
    }

    return artist;
  }

  // Create new venue
  private async createNewVenue(scrapedVenue: ScrapedVenue): Promise<Venue> {
    const venue: Venue = {
      id: uuidv4(),
      name: scrapedVenue.name,
      name_normalized: this.normalizeText(scrapedVenue.name),
      address: scrapedVenue.address,
      city: scrapedVenue.city,
      state_province: scrapedVenue.stateProvince,
      country: scrapedVenue.country,
      postal_code: scrapedVenue.postalCode,
      latitude: scrapedVenue.latitude,
      longitude: scrapedVenue.longitude,
      capacity: scrapedVenue.capacity,
      venue_type: scrapedVenue.venueType,
      website_url: scrapedVenue.websiteUrl,
      image_url: scrapedVenue.imageUrl,
      setlistfm_id: scrapedVenue.externalId,
      concerts_count: 0,
      verified: false,
      source: scrapedVenue.source,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await this.clickhouseClient.insert({
      table: 'venues',
      values: [venue],
      format: 'JSONEachRow',
    });

    return venue;
  }

  // Create new concert
  private async createNewConcert(
    scrapedConcert: ScrapedConcert,
    artistId: string,
    venueId: string
  ): Promise<Concert> {
    const concert: Concert = {
      id: uuidv4(),
      artist_id: artistId,
      venue_id: venueId,
      date: scrapedConcert.date,
      tour_name: scrapedConcert.tourName,
      event_name: scrapedConcert.eventName,
      setlist: scrapedConcert.setlist ? JSON.stringify(scrapedConcert.setlist) : undefined,
      setlist_source: scrapedConcert.setlistSource,
      setlistfm_id: scrapedConcert.externalId,
      supporting_artists: scrapedConcert.supportingArtists ? JSON.stringify(scrapedConcert.supportingArtists) : undefined,
      attendance_count: scrapedConcert.attendanceCount,
      verified: false,
      source: scrapedConcert.source,
      source_url: scrapedConcert.sourceUrl,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await this.clickhouseClient.insert({
      table: 'concerts',
      values: [concert],
      format: 'JSONEachRow',
    });

    return concert;
  }

  // Create artist aliases
  private async createArtistAliases(artistId: string, aliases: string[]): Promise<ArtistAlias[]> {
    const aliasRecords = aliases.map(alias => ({
      id: uuidv4(),
      artist_id: artistId,
      alias: alias,
      alias_normalized: this.normalizeText(alias),
      alias_type: 'alternate',
      created_at: new Date(),
    }));

    await this.clickhouseClient.insert({
      table: 'artist_aliases',
      values: aliasRecords,
      format: 'JSONEachRow',
    });

    return aliasRecords;
  }

  // Update artist aliases (add new ones, don't duplicate)
  private async updateArtistAliases(artistId: string, newAliases: string[]): Promise<ArtistAlias[]> {
    if (!newAliases || newAliases.length === 0) return [];

    // Get existing aliases
    const existingAliases = await this.clickhouseClient.query(`
      SELECT * FROM artist_aliases WHERE artist_id = {artist_id:String}
    `, { artist_id: artistId }).then((result: any) => result.data || []);

    const existingNormalized = new Set(existingAliases.map((alias: any) => alias.alias_normalized));

    // Filter out existing aliases
    const newUniqueAliases = newAliases
      .filter(alias => !existingNormalized.has(this.normalizeText(alias)))
      .slice(0, 10); // Limit to 10 new aliases

    if (newUniqueAliases.length > 0) {
      await this.createArtistAliases(artistId, newUniqueAliases);
    }

    return existingAliases;
  }

  // Normalize text for matching
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-'.&()]/g, '')
      .replace(/\b(the|a|an)\b/g, '')
      .replace(/\s+/g, '');
  }

  // Bulk resolve concerts
  async resolveConcerts(scrapedConcerts: ScrapedConcert[]): Promise<ResolvedConcert[]> {
    const resolved: ResolvedConcert[] = [];

    for (const scrapedConcert of scrapedConcerts) {
      try {
        // Resolve artist and venue
        const [resolvedArtist, resolvedVenue] = await Promise.all([
          this.resolveArtist(scrapedConcert.artist),
          this.resolveVenue(scrapedConcert.venue),
        ]);

        // Resolve concert
        const resolvedConcert = await this.resolveConcert(scrapedConcert, resolvedArtist, resolvedVenue);
        resolved.push(resolvedConcert);

      } catch (error) {
        this.logger.error('Failed to resolve concert', {
          error: error instanceof Error ? error.message : 'Unknown error',
          concert: {
            artist: scrapedConcert.artist.name,
            venue: scrapedConcert.venue.name,
            date: scrapedConcert.date,
          }
        });
      }
    }

    return resolved;
  }
}