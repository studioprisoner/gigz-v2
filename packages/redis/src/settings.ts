import { createRedisFromEnv } from './client';

// Create a Redis client for settings management
const redis = createRedisFromEnv().getClient();

export interface ScraperServiceConfig {
  enabled: boolean;
  rateLimit: number;        // requests per second
  dailyQuota: number;       // max requests per day
  priority: number;         // 1-10, higher = more resources
  lastModified: string;     // ISO timestamp
  modifiedBy: string;       // admin user ID
}

export interface ScraperSettings {
  services: {
    setlistfm: ScraperServiceConfig;
    spotify: ScraperServiceConfig;
    musicbrainz: ScraperServiceConfig;
    bandsintown: ScraperServiceConfig;
    songkick: ScraperServiceConfig;
  };
  global: {
    maintenanceMode: boolean;      // pause all scrapers
    maxConcurrentJobs: number;     // across all services
    retryFailedJobs: boolean;
    retryDelayMinutes: number;
  };
}

const SETTINGS_KEY = 'scraper:settings';
const DEFAULTS: ScraperSettings = {
  services: {
    setlistfm: {
      enabled: true,
      rateLimit: 2,
      dailyQuota: 1440,
      priority: 10,
      lastModified: new Date().toISOString(),
      modifiedBy: 'system',
    },
    spotify: {
      enabled: false,  // Future
      rateLimit: 10,
      dailyQuota: 10000,
      priority: 5,
      lastModified: new Date().toISOString(),
      modifiedBy: 'system',
    },
    musicbrainz: {
      enabled: false,  // Future
      rateLimit: 1,
      dailyQuota: 5000,
      priority: 3,
      lastModified: new Date().toISOString(),
      modifiedBy: 'system',
    },
    bandsintown: {
      enabled: false,  // Future
      rateLimit: 5,
      dailyQuota: 5000,
      priority: 7,
      lastModified: new Date().toISOString(),
      modifiedBy: 'system',
    },
    songkick: {
      enabled: false,  // Future
      rateLimit: 5,
      dailyQuota: 5000,
      priority: 7,
      lastModified: new Date().toISOString(),
      modifiedBy: 'system',
    },
  },
  global: {
    maintenanceMode: false,
    maxConcurrentJobs: 5,
    retryFailedJobs: true,
    retryDelayMinutes: 60,
  },
};

export class ScraperSettingsManager {
  async get(): Promise<ScraperSettings> {
    const data = await redis.get(SETTINGS_KEY);
    if (!data) {
      await this.set(DEFAULTS);
      return DEFAULTS;
    }
    return JSON.parse(data);
  }

  async set(settings: ScraperSettings): Promise<void> {
    await redis.set(SETTINGS_KEY, JSON.stringify(settings));
    // Publish change event for workers to pick up
    await redis.publish('scraper:settings:changed', JSON.stringify(settings));
  }

  async getService(service: keyof ScraperSettings['services']): Promise<ScraperServiceConfig> {
    const settings = await this.get();
    return settings.services[service];
  }

  async setService(
    service: keyof ScraperSettings['services'],
    config: Partial<ScraperServiceConfig>,
    adminId: string
  ): Promise<void> {
    const settings = await this.get();
    settings.services[service] = {
      ...settings.services[service],
      ...config,
      lastModified: new Date().toISOString(),
      modifiedBy: adminId,
    };
    await this.set(settings);
  }

  async isServiceEnabled(service: keyof ScraperSettings['services']): Promise<boolean> {
    const settings = await this.get();
    if (settings.global.maintenanceMode) return false;
    return settings.services[service].enabled;
  }

  async toggleMaintenanceMode(enabled: boolean, adminId: string): Promise<void> {
    const settings = await this.get();
    settings.global.maintenanceMode = enabled;
    await this.set(settings);

    // Log the action
    await redis.lpush('scraper:audit', JSON.stringify({
      action: enabled ? 'maintenance_enabled' : 'maintenance_disabled',
      adminId,
      timestamp: new Date().toISOString(),
    }));
  }

  async updateGlobalSettings(
    globalConfig: Partial<ScraperSettings['global']>,
    adminId: string
  ): Promise<void> {
    const settings = await this.get();
    settings.global = { ...settings.global, ...globalConfig };
    await this.set(settings);

    // Log the action
    await redis.lpush('scraper:audit', JSON.stringify({
      action: 'update_global_settings',
      adminId,
      changes: globalConfig,
      timestamp: new Date().toISOString(),
    }));
  }

  async getAuditLog(limit: number = 50): Promise<Array<{
    action: string;
    adminId: string;
    timestamp: string;
    changes?: any;
  }>> {
    const logs = await redis.lrange('scraper:audit', 0, limit - 1);
    return logs.map((log: string) => JSON.parse(log)).reverse(); // Most recent first
  }
}

export const scraperSettings = new ScraperSettingsManager();