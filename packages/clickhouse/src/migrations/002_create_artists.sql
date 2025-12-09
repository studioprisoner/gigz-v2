CREATE TABLE IF NOT EXISTS artists (
  id UUID DEFAULT generateUUIDv4(),
  name String,
  name_normalized String,

  -- External IDs
  musicbrainz_id Nullable(String),
  spotify_id Nullable(String),
  image_url Nullable(String),

  -- Stats (materialized view can update these)
  concerts_count UInt32 DEFAULT 0,

  -- Data quality
  verified UInt8 DEFAULT 0,
  source LowCardinality(String),

  created_at DateTime64(3) DEFAULT now64(),
  updated_at DateTime64(3) DEFAULT now64()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (id)
SETTINGS index_granularity = 8192;