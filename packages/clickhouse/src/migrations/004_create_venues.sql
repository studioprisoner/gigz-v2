CREATE TABLE IF NOT EXISTS venues (
  id UUID DEFAULT generateUUIDv4(),
  name String,
  name_normalized String,

  -- Location
  address Nullable(String),
  city String,
  state_province Nullable(String),
  country String,
  postal_code Nullable(String),
  latitude Nullable(Float64),
  longitude Nullable(Float64),

  -- Metadata
  capacity Nullable(UInt32),
  venue_type LowCardinality(Nullable(String)),
  website_url Nullable(String),
  image_url Nullable(String),

  -- External IDs
  setlistfm_id Nullable(String),

  -- Stats
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