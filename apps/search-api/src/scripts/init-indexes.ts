#!/usr/bin/env bun

/**
 * Meilisearch Index Initialization Script
 *
 * This script initializes all Meilisearch indexes with their proper configurations.
 * Run this script before starting the search API service for the first time.
 *
 * Usage:
 *   bun run src/scripts/init-indexes.ts
 *
 * Environment variables required:
 *   - MEILISEARCH_HOST: Meilisearch server URL (default: http://localhost:7700)
 *   - MEILISEARCH_API_KEY: Meilisearch API key (optional for local development)
 */

import { meilisearchService } from '../lib/meilisearch';

// Simple logger
const logger = {
  info: (message: string, meta?: any) => console.log(`[INFO] ${message}`, meta || ''),
  error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta || ''),
  success: (message: string) => console.log(`✅ ${message}`),
  warn: (message: string) => console.log(`⚠️ ${message}`),
};

async function checkEnvironment(): Promise<boolean> {
  const requiredVars = ['MEILISEARCH_HOST'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    logger.error('Missing required environment variables:', { missingVars });
    logger.info('Please set the following environment variables:');
    missingVars.forEach(varName => {
      logger.info(`  ${varName}`);
    });
    return false;
  }

  return true;
}

async function checkMeilisearchConnection(): Promise<boolean> {
  try {
    const isHealthy = await meilisearchService.isHealthy();
    if (isHealthy) {
      logger.success('Successfully connected to Meilisearch');
      return true;
    } else {
      logger.error('Meilisearch is not healthy');
      return false;
    }
  } catch (error) {
    logger.error('Failed to connect to Meilisearch', { error });
    return false;
  }
}

async function initializeIndexes(): Promise<boolean> {
  try {
    logger.info('Initializing Meilisearch indexes...');

    await meilisearchService.initializeIndexes();

    logger.success('All indexes initialized successfully');
    return true;
  } catch (error) {
    logger.error('Failed to initialize indexes', { error });
    return false;
  }
}

async function verifyIndexes(): Promise<boolean> {
  try {
    logger.info('Verifying index configurations...');

    const stats = await meilisearchService.getAllStats();
    const indexNames = ['artists', 'venues', 'concerts', 'users'];

    for (const indexName of indexNames) {
      if (stats[indexName]) {
        logger.success(`Index '${indexName}' is ready (${stats[indexName].numberOfDocuments || 0} documents)`);
      } else {
        logger.warn(`Index '${indexName}' may not be properly configured`);
      }
    }

    return true;
  } catch (error) {
    logger.error('Failed to verify indexes', { error });
    return false;
  }
}

async function showIndexConfiguration() {
  logger.info('Index Configuration Summary:');
  logger.info('');

  logger.info('📚 Artists Index:');
  logger.info('  • Primary Key: id');
  logger.info('  • Searchable: name, aliases');
  logger.info('  • Filterable: verified, concerts_count');
  logger.info('  • Sortable: concerts_count, name');
  logger.info('');

  logger.info('🏢 Venues Index:');
  logger.info('  • Primary Key: id');
  logger.info('  • Searchable: name, city, country, aliases');
  logger.info('  • Filterable: city, country, capacity, _geo');
  logger.info('  • Sortable: concerts_count, name');
  logger.info('  • Geo-enabled: Yes');
  logger.info('');

  logger.info('🎵 Concerts Index:');
  logger.info('  • Primary Key: id');
  logger.info('  • Searchable: artist_name, venue_name, city, tour_name');
  logger.info('  • Filterable: artist_id, venue_id, date, city, country, _geo');
  logger.info('  • Sortable: date, attendance_count');
  logger.info('  • Geo-enabled: Yes');
  logger.info('');

  logger.info('👥 Users Index:');
  logger.info('  • Primary Key: id');
  logger.info('  • Searchable: username, display_name');
  logger.info('  • Filterable: profile_visibility');
  logger.info('  • Sortable: total_shows_count');
  logger.info('');
}

async function main() {
  logger.info('🔍 Meilisearch Index Initialization');
  logger.info('=====================================');
  logger.info('');

  // Check environment
  const envOk = await checkEnvironment();
  if (!envOk) {
    process.exit(1);
  }

  // Check Meilisearch connection
  const connectionOk = await checkMeilisearchConnection();
  if (!connectionOk) {
    logger.error('Cannot proceed without Meilisearch connection');
    process.exit(1);
  }

  // Show configuration summary
  showIndexConfiguration();

  // Initialize indexes
  const initOk = await initializeIndexes();
  if (!initOk) {
    logger.error('Index initialization failed');
    process.exit(1);
  }

  // Verify indexes
  const verifyOk = await verifyIndexes();
  if (!verifyOk) {
    logger.warn('Index verification had issues, but initialization may have succeeded');
  }

  logger.info('');
  logger.success('🎉 Index initialization completed successfully!');
  logger.info('');
  logger.info('Next steps:');
  logger.info('1. Run the search API service: bun run dev');
  logger.info('2. Use admin endpoints to populate indexes with data');
  logger.info('   • POST /admin/reindex-artists');
  logger.info('   • POST /admin/reindex-venues');
  logger.info('   • POST /admin/reindex-concerts');
  logger.info('   • POST /admin/sync-users');
  logger.info('   • Or use POST /admin/reindex-all for everything');
  logger.info('');
}

// Handle errors and exit gracefully
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', { error });
  process.exit(1);
});

// Run the script
if (import.meta.main) {
  main().catch((error) => {
    logger.error('Script failed:', { error });
    process.exit(1);
  });
}