CREATE TABLE IF NOT EXISTS artist_aliases (
  id UUID DEFAULT generateUUIDv4(),
  artist_id UUID,

  alias String,
  alias_normalized String,
  alias_type LowCardinality(String), -- 'misspelling', 'former_name', 'alternate', 'localized'

  created_at DateTime64(3) DEFAULT now64()
)
ENGINE = MergeTree()
ORDER BY (alias_normalized, artist_id)
SETTINGS index_granularity = 8192;