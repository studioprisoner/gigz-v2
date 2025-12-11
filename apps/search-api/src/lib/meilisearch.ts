import { MeiliSearch } from 'meilisearch';

// Simple logger for now
const logger = {
  info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta || ''),
  error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta || ''),
};

// Meilisearch client configuration
const client = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
  apiKey: process.env.MEILISEARCH_API_KEY,
});

// Index configurations
export const INDEX_CONFIGS = {
  artists: {
    uid: 'artists',
    primaryKey: 'id',
    settings: {
      searchableAttributes: ['name', 'aliases'] as string[],
      filterableAttributes: ['verified', 'concerts_count'] as string[],
      sortableAttributes: ['concerts_count', 'name'] as string[],
      rankingRules: [
        'words',
        'typo',
        'proximity',
        'attribute',
        'sort',
        'exactness',
        'concerts_count:desc',
      ] as string[],
    },
  },
  venues: {
    uid: 'venues',
    primaryKey: 'id',
    settings: {
      searchableAttributes: ['name', 'city', 'country', 'aliases'] as string[],
      filterableAttributes: ['city', 'country', 'capacity', '_geo'] as string[],
      sortableAttributes: ['concerts_count', 'name'] as string[],
      rankingRules: [
        'words',
        'typo',
        'proximity',
        'attribute',
        'sort',
        'exactness',
        'concerts_count:desc',
      ] as string[],
    },
  },
  concerts: {
    uid: 'concerts',
    primaryKey: 'id',
    settings: {
      searchableAttributes: ['artist_name', 'venue_name', 'city', 'tour_name'] as string[],
      filterableAttributes: ['artist_id', 'venue_id', 'date', 'city', 'country', '_geo'] as string[],
      sortableAttributes: ['date', 'attendance_count'] as string[],
      rankingRules: [
        'words',
        'typo',
        'proximity',
        'attribute',
        'sort',
        'exactness',
        'date:desc',
      ] as string[],
    },
  },
  users: {
    uid: 'users',
    primaryKey: 'id',
    settings: {
      searchableAttributes: ['username', 'display_name'] as string[],
      filterableAttributes: ['profile_visibility'] as string[],
      sortableAttributes: ['total_shows_count'] as string[],
      rankingRules: [
        'words',
        'typo',
        'proximity',
        'attribute',
        'sort',
        'exactness',
        'total_shows_count:desc',
      ] as string[],
    },
  },
} as const;

// Document type definitions
export interface ArtistDocument {
  id: string;
  name: string;
  aliases: string[];
  image_url: string | null;
  spotify_id: string | null;
  concerts_count: number;
  verified: boolean;
}

export interface VenueDocument {
  id: string;
  name: string;
  aliases: string[];
  city: string;
  country: string;
  capacity: number | null;
  concerts_count: number;
  _geo: { lat: number; lng: number } | null;
}

export interface ConcertDocument {
  id: string;
  artist_id: string;
  artist_name: string;
  venue_id: string;
  venue_name: string;
  city: string;
  country: string;
  date: number; // Unix timestamp for filtering
  date_display: string; // ISO string for display
  tour_name: string | null;
  attendance_count: number;
  _geo: { lat: number; lng: number } | null;
}

export interface UserDocument {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  total_shows_count: number;
  profile_visibility: string;
}

// Client wrapper class
export class MeilisearchService {
  private client: MeiliSearch;

  constructor() {
    this.client = client;
  }

  // Get the raw client for advanced operations
  getClient(): MeiliSearch {
    return this.client;
  }

  // Health check
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.health();
      return true;
    } catch (error) {
      logger.error('Meilisearch health check failed', { error });
      return false;
    }
  }

  // Get index
  getIndex(indexName: keyof typeof INDEX_CONFIGS) {
    return this.client.index(indexName);
  }

  // Initialize all indexes
  async initializeIndexes(): Promise<void> {
    const indexNames = Object.keys(INDEX_CONFIGS) as (keyof typeof INDEX_CONFIGS)[];

    for (const indexName of indexNames) {
      const config = INDEX_CONFIGS[indexName];

      try {
        // Try to get the index first
        await this.client.getIndex(config.uid);
        logger.info(`Index '${config.uid}' already exists`);
      } catch (error) {
        // Index doesn't exist, create it
        logger.info(`Creating index '${config.uid}'`);
        await this.client.createIndex(config.uid, { primaryKey: config.primaryKey });
      }

      // Update settings
      logger.info(`Updating settings for index '${config.uid}'`);
      await this.client.index(config.uid).updateSettings(config.settings);
    }
  }

  // Multi-search across indexes
  async multiSearch(queries: Array<{
    indexUid: string;
    q: string;
    limit?: number;
    offset?: number;
    filter?: string;
    sort?: string[];
  }>) {
    return this.client.multiSearch({ queries });
  }

  // Add documents to an index
  async addDocuments(
    indexName: keyof typeof INDEX_CONFIGS,
    documents: any[],
    options?: { primaryKey?: string }
  ) {
    const index = this.getIndex(indexName);
    return index.addDocuments(documents, options);
  }

  // Update documents in an index
  async updateDocuments(
    indexName: keyof typeof INDEX_CONFIGS,
    documents: any[]
  ) {
    const index = this.getIndex(indexName);
    return index.updateDocuments(documents);
  }

  // Delete documents from an index
  async deleteDocuments(
    indexName: keyof typeof INDEX_CONFIGS,
    documentIds: string[]
  ) {
    const index = this.getIndex(indexName);
    return index.deleteDocuments(documentIds);
  }

  // Clear all documents from an index
  async clearIndex(indexName: keyof typeof INDEX_CONFIGS) {
    const index = this.getIndex(indexName);
    return index.deleteAllDocuments();
  }

  // Get index stats
  async getIndexStats(indexName: keyof typeof INDEX_CONFIGS) {
    const index = this.getIndex(indexName);
    return index.getStats();
  }

  // Get all index stats
  async getAllStats() {
    const indexNames = Object.keys(INDEX_CONFIGS) as (keyof typeof INDEX_CONFIGS)[];
    const stats: Record<string, any> = {};

    for (const indexName of indexNames) {
      try {
        stats[indexName] = await this.getIndexStats(indexName);
      } catch (error) {
        logger.error(`Failed to get stats for index '${indexName}'`, { error });
        stats[indexName] = { error: 'Failed to fetch stats' };
      }
    }

    return stats;
  }

  // Get task status
  async getTask(taskUid: number) {
    return this.client.getTask(taskUid);
  }

  // Wait for a task to complete
  async waitForTask(taskUid: number, timeoutMs = 5000) {
    return this.client.waitForTask(taskUid, { timeOutMs: timeoutMs });
  }

  // Search suggestions/autocomplete
  async getSuggestions(
    query: string,
    indexNames: (keyof typeof INDEX_CONFIGS)[],
    limit = 5
  ): Promise<Array<{ type: string; id: string; label: string }>> {
    const queries = indexNames.map(indexName => ({
      indexUid: indexName,
      q: query,
      limit,
      attributesToRetrieve: ['id', 'name', 'city'], // Basic attributes for suggestions
    }));

    const results = await this.multiSearch(queries);
    const suggestions: Array<{ type: string; id: string; label: string }> = [];

    results.results.forEach((result, index) => {
      const indexName = indexNames[index];
      result.hits.forEach((hit: any) => {
        let label = hit.name;

        // Add city for venues to make them more descriptive
        if (indexName === 'venues' && hit.city) {
          label = `${hit.name}, ${hit.city}`;
        }

        suggestions.push({
          type: indexName === 'artists' ? 'artist' :
                indexName === 'venues' ? 'venue' :
                indexName === 'concerts' ? 'concert' : 'user',
          id: hit.id,
          label,
        });
      });
    });

    return suggestions.slice(0, limit);
  }
}

// Create singleton instance
export const meilisearchService = new MeilisearchService();