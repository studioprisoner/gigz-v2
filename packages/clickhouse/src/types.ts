export interface Artist {
  id: string;
  name: string;
  name_normalized: string;
  musicbrainz_id?: string;
  spotify_id?: string;
  image_url?: string;
  concerts_count: number;
  verified: boolean;
  source: string;
  created_at: Date;
  updated_at: Date;
}

export interface ArtistAlias {
  id: string;
  artist_id: string;
  alias: string;
  alias_normalized: string;
  alias_type: string; // 'misspelling', 'former_name', 'alternate', 'localized'
  created_at: Date;
}

export interface Venue {
  id: string;
  name: string;
  name_normalized: string;
  address?: string;
  city: string;
  state_province?: string;
  country: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  capacity?: number;
  venue_type?: string;
  website_url?: string;
  image_url?: string;
  setlistfm_id?: string;
  concerts_count: number;
  verified: boolean;
  source: string;
  created_at: Date;
  updated_at: Date;
}

export interface Concert {
  id: string;
  artist_id: string;
  venue_id: string;
  date: string; // YYYY-MM-DD format
  tour_name?: string;
  event_name?: string;
  setlist?: string; // JSON string
  setlist_source?: string;
  setlistfm_id?: string;
  supporting_artists?: string; // JSON array
  attendance_count: number;
  verified: boolean;
  source: string;
  source_url?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ConcertSource {
  id: string;
  concert_id: string;
  source_type: string;
  source_name?: string;
  source_url?: string;
  raw_data?: string; // JSON
  scraped_at: Date;
}

// Query result types for common queries
export interface ConcertWithVenue extends Concert {
  venue_name: string;
  venue_city: string;
  venue_country: string;
}

export interface ConcertWithArtistAndVenue extends Concert {
  artist_name: string;
  venue_name: string;
  venue_city: string;
  venue_country: string;
}

export interface NearbyConcert extends Concert {
  distance: number;
  venue_name: string;
  artist_name: string;
}