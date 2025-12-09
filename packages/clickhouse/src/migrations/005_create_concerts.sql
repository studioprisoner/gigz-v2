CREATE TABLE IF NOT EXISTS concerts (
  id UUID DEFAULT generateUUIDv4(),

  artist_id UUID,
  venue_id UUID,
  date Date,

  -- Optional metadata
  tour_name Nullable(String),
  event_name Nullable(String),

  -- Setlist (stored as JSON string)
  setlist Nullable(String),
  setlist_source LowCardinality(Nullable(String)),
  setlistfm_id Nullable(String),

  -- Supporting acts (JSON array)
  supporting_artists Nullable(String),

  -- Stats
  attendance_count UInt32 DEFAULT 0,

  -- Data quality
  verified UInt8 DEFAULT 0,
  source LowCardinality(String),
  source_url Nullable(String),

  created_at DateTime64(3) DEFAULT now64(),
  updated_at DateTime64(3) DEFAULT now64()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (artist_id, venue_id, date)
PARTITION BY toYYYYMM(date)
SETTINGS index_granularity = 8192;