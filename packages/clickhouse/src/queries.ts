import { query } from './client';
import type {
  Artist,
  Venue,
  Concert,
  ConcertWithVenue,
  ConcertWithArtistAndVenue,
  NearbyConcert
} from './types';

// Artist queries
export async function findArtistByName(name: string): Promise<Artist | null> {
  const results = await query<Artist>(
    `SELECT * FROM artists WHERE name_normalized = {name:String} LIMIT 1`,
    { name: name.toLowerCase() }
  );
  return results[0] || null;
}

export async function findArtistsByNamePartial(name: string, limit = 10): Promise<Artist[]> {
  return query<Artist>(
    `SELECT * FROM artists WHERE name_normalized LIKE {pattern:String} ORDER BY concerts_count DESC LIMIT {limit:UInt32}`,
    { pattern: `%${name.toLowerCase()}%`, limit }
  );
}

// Venue queries
export async function findVenuesByCity(city: string, country: string, limit = 20): Promise<Venue[]> {
  return query<Venue>(
    `SELECT * FROM venues WHERE city = {city:String} AND country = {country:String} ORDER BY concerts_count DESC LIMIT {limit:UInt32}`,
    { city, country, limit }
  );
}

export async function findNearbyVenues(lat: number, lng: number, radiusKm = 50, limit = 20): Promise<Array<Venue & { distance: number }>> {
  return query<Venue & { distance: number }>(
    `SELECT *,
      geoDistance(latitude, longitude, {lat:Float64}, {lng:Float64}) / 1000 as distance
     FROM venues
     WHERE latitude IS NOT NULL AND longitude IS NOT NULL
     AND geoDistance(latitude, longitude, {lat:Float64}, {lng:Float64}) < {radiusMeters:UInt32}
     ORDER BY distance ASC
     LIMIT {limit:UInt32}`,
    { lat, lng, radiusMeters: radiusKm * 1000, limit }
  );
}

// Concert queries
export async function findConcertsByArtist(artistId: string, limit = 100): Promise<ConcertWithVenue[]> {
  return query<ConcertWithVenue>(
    `SELECT c.*, v.name as venue_name, v.city as venue_city, v.country as venue_country
     FROM concerts c
     JOIN venues v ON c.venue_id = v.id
     WHERE c.artist_id = {artistId:UUID}
     ORDER BY c.date DESC
     LIMIT {limit:UInt32}`,
    { artistId, limit }
  );
}

export async function findConcertsByVenue(venueId: string, limit = 100): Promise<ConcertWithArtistAndVenue[]> {
  return query<ConcertWithArtistAndVenue>(
    `SELECT c.*, a.name as artist_name, v.name as venue_name, v.city as venue_city, v.country as venue_country
     FROM concerts c
     JOIN artists a ON c.artist_id = a.id
     JOIN venues v ON c.venue_id = v.id
     WHERE c.venue_id = {venueId:UUID}
     ORDER BY c.date DESC
     LIMIT {limit:UInt32}`,
    { venueId, limit }
  );
}

export async function findUpcomingConcerts(limit = 50): Promise<ConcertWithArtistAndVenue[]> {
  return query<ConcertWithArtistAndVenue>(
    `SELECT c.*, a.name as artist_name, v.name as venue_name, v.city as venue_city, v.country as venue_country
     FROM concerts c
     JOIN artists a ON c.artist_id = a.id
     JOIN venues v ON c.venue_id = v.id
     WHERE c.date >= today()
     ORDER BY c.date ASC
     LIMIT {limit:UInt32}`,
    { limit }
  );
}

export async function findNearbyConcerts(
  lat: number,
  lng: number,
  radiusKm = 80,
  fromDate?: string,
  limit = 50
): Promise<NearbyConcert[]> {
  const dateFilter = fromDate ? 'AND c.date >= {fromDate:Date}' : 'AND c.date >= today()';

  return query<NearbyConcert>(
    `SELECT c.*,
      a.name as artist_name,
      v.name as venue_name,
      geoDistance(v.latitude, v.longitude, {lat:Float64}, {lng:Float64}) / 1000 as distance
     FROM concerts c
     JOIN artists a ON c.artist_id = a.id
     JOIN venues v ON c.venue_id = v.id
     WHERE v.latitude IS NOT NULL AND v.longitude IS NOT NULL
     ${dateFilter}
     AND geoDistance(v.latitude, v.longitude, {lat:Float64}, {lng:Float64}) < {radiusMeters:UInt32}
     ORDER BY c.date ASC, distance ASC
     LIMIT {limit:UInt32}`,
    {
      lat,
      lng,
      radiusMeters: radiusKm * 1000,
      limit,
      ...(fromDate && { fromDate })
    }
  );
}

// Analytics queries
export async function getTopArtistsByConcertCount(limit = 10): Promise<Array<{ name: string; concerts_count: number }>> {
  return query<{ name: string; concerts_count: number }>(
    `SELECT name, concerts_count
     FROM artists
     WHERE concerts_count > 0
     ORDER BY concerts_count DESC
     LIMIT {limit:UInt32}`,
    { limit }
  );
}

export async function getTopVenuesByConcertCount(limit = 10): Promise<Array<{ name: string; city: string; country: string; concerts_count: number }>> {
  return query<{ name: string; city: string; country: string; concerts_count: number }>(
    `SELECT name, city, country, concerts_count
     FROM venues
     WHERE concerts_count > 0
     ORDER BY concerts_count DESC
     LIMIT {limit:UInt32}`,
    { limit }
  );
}

export async function getConcertsByMonth(year: number): Promise<Array<{ month: number; count: number }>> {
  return query<{ month: number; count: number }>(
    `SELECT toMonth(date) as month, count() as count
     FROM concerts
     WHERE toYear(date) = {year:UInt32}
     GROUP BY month
     ORDER BY month`,
    { year }
  );
}

// Search queries
export async function searchConcerts(
  searchTerm: string,
  limit = 20
): Promise<ConcertWithArtistAndVenue[]> {
  const pattern = `%${searchTerm.toLowerCase()}%`;

  return query<ConcertWithArtistAndVenue>(
    `SELECT c.*, a.name as artist_name, v.name as venue_name, v.city as venue_city, v.country as venue_country
     FROM concerts c
     JOIN artists a ON c.artist_id = a.id
     JOIN venues v ON c.venue_id = v.id
     WHERE lower(a.name) LIKE {pattern:String}
        OR lower(v.name) LIKE {pattern:String}
        OR lower(v.city) LIKE {pattern:String}
        OR lower(c.tour_name) LIKE {pattern:String}
        OR lower(c.event_name) LIKE {pattern:String}
     ORDER BY c.date DESC
     LIMIT {limit:UInt32}`,
    { pattern, limit }
  );
}