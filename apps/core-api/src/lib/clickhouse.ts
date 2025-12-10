import { query, exec } from '@gigz/clickhouse';

// Since we don't have the Concert type yet, let's define a simple interface
interface Concert {
  id: string;
  artistName: string;
  venueName: string;
  city: string;
  country: string;
  date: string;
  attendanceCount: number;
}

export async function getConcertById(concertId: string): Promise<Concert | null> {
  const results = await query<Concert>(
    'SELECT * FROM concerts WHERE id = {id:String}',
    { id: concertId }
  );
  
  return results.length > 0 ? results[0] : null;
}

export async function getConcertsByIds(concertIds: string[]): Promise<Concert[]> {
  if (concertIds.length === 0) return [];
  
  const results = await query<Concert>(
    'SELECT * FROM concerts WHERE id IN {ids:Array(String)}',
    { ids: concertIds }
  );
  
  return results;
}

export async function incrementConcertAttendance(concertId: string): Promise<void> {
  await exec(
    `ALTER TABLE concerts UPDATE attendance_count = attendance_count + 1 WHERE id = '${concertId}'`
  );
}

export async function decrementConcertAttendance(concertId: string): Promise<void> {
  await exec(
    `ALTER TABLE concerts UPDATE attendance_count = attendance_count - 1 WHERE id = '${concertId}'`
  );
}

export async function searchConcerts(params: {
  query?: string;
  artistName?: string;
  venueName?: string;
  city?: string;
  country?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}): Promise<Concert[]> {
  const conditions: string[] = [];
  const queryParams: Record<string, any> = {};
  
  if (params.query) {
    conditions.push('(positionCaseInsensitive(artist_name, {query:String}) > 0 OR positionCaseInsensitive(venue_name, {query:String}) > 0)');
    queryParams.query = params.query;
  }
  
  if (params.artistName) {
    conditions.push('positionCaseInsensitive(artist_name, {artistName:String}) > 0');
    queryParams.artistName = params.artistName;
  }
  
  if (params.venueName) {
    conditions.push('positionCaseInsensitive(venue_name, {venueName:String}) > 0');
    queryParams.venueName = params.venueName;
  }
  
  if (params.city) {
    conditions.push('city = {city:String}');
    queryParams.city = params.city;
  }
  
  if (params.country) {
    conditions.push('country = {country:String}');
    queryParams.country = params.country;
  }
  
  if (params.dateFrom) {
    conditions.push('date >= {dateFrom:Date}');
    queryParams.dateFrom = params.dateFrom.toISOString().split('T')[0];
  }
  
  if (params.dateTo) {
    conditions.push('date <= {dateTo:Date}');
    queryParams.dateTo = params.dateTo.toISOString().split('T')[0];
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit || 50;
  const offset = params.offset || 0;
  
  const sql = `
    SELECT * FROM concerts 
    ${whereClause}
    ORDER BY date DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  
  return await query<Concert>(sql, queryParams);
}