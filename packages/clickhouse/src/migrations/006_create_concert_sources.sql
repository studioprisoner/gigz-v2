CREATE TABLE IF NOT EXISTS concert_sources (
  id UUID DEFAULT generateUUIDv4(),
  concert_id UUID,

  source_type LowCardinality(String),
  source_name LowCardinality(Nullable(String)),
  source_url Nullable(String),
  raw_data Nullable(String), -- JSON

  scraped_at DateTime64(3) DEFAULT now64()
)
ENGINE = MergeTree()
ORDER BY (concert_id, scraped_at)
SETTINGS index_granularity = 8192;