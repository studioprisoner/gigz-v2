-- Add indexes for better query performance

-- Index for artist name lookups
ALTER TABLE artists ADD INDEX IF NOT EXISTS idx_name_normalized name_normalized TYPE bloom_filter GRANULARITY 1;

-- Geo index for venue location queries
ALTER TABLE venues ADD INDEX IF NOT EXISTS idx_geo (latitude, longitude) TYPE minmax GRANULARITY 1;

-- Concert date and venue indexes
ALTER TABLE concerts ADD INDEX IF NOT EXISTS idx_date date TYPE minmax GRANULARITY 1;
ALTER TABLE concerts ADD INDEX IF NOT EXISTS idx_venue venue_id TYPE bloom_filter GRANULARITY 1;