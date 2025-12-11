import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { z } from 'zod';

// Redis connection configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
};

export const redisConnection = new Redis(redisConfig);

// Job type definitions
export const ScrapeJobDataSchema = z.object({
  source: z.enum(['setlistfm', 'songkick', 'bandsintown', 'musicbrainz']),
  type: z.enum(['artist', 'venue', 'discover', 'backfill']),
  entityId: z.string().optional(),
  params: z.record(z.any()).optional(),
  priority: z.number().default(0),
  retryCount: z.number().default(3),
});

export type ScrapeJobData = z.infer<typeof ScrapeJobDataSchema>;

// Specific job schemas
export const ArtistScrapeJobSchema = ScrapeJobDataSchema.extend({
  type: z.literal('artist'),
  entityId: z.string(),
  params: z.object({
    artistId: z.string(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    limit: z.number().optional(),
  }).optional(),
});

export const VenueScrapeJobSchema = ScrapeJobDataSchema.extend({
  type: z.literal('venue'),
  entityId: z.string(),
  params: z.object({
    venueId: z.string(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    limit: z.number().optional(),
  }).optional(),
});

export const DiscoverJobSchema = ScrapeJobDataSchema.extend({
  type: z.literal('discover'),
  params: z.object({
    location: z.string().optional(),
    genre: z.string().optional(),
    dateRange: z.object({
      start: z.string(),
      end: z.string(),
    }).optional(),
    limit: z.number().optional(),
  }).optional(),
});

export const BackfillJobSchema = ScrapeJobDataSchema.extend({
  type: z.literal('backfill'),
  params: z.object({
    startDate: z.string(),
    endDate: z.string(),
    batchSize: z.number().default(100),
    source: z.string().optional(),
  }).optional(),
});

export type ArtistScrapeJob = z.infer<typeof ArtistScrapeJobSchema>;
export type VenueScrapeJob = z.infer<typeof VenueScrapeJobSchema>;
export type DiscoverJob = z.infer<typeof DiscoverJobSchema>;
export type BackfillJob = z.infer<typeof BackfillJobSchema>;

// Queue configuration
export const SCRAPER_QUEUE_NAME = 'scraper';

export const queueConfig = {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
};

// Create the main scraper queue
export const scraperQueue = new Queue(SCRAPER_QUEUE_NAME, queueConfig);

// Queue monitoring and utilities
export class QueueManager {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();

  constructor() {
    this.queues.set(SCRAPER_QUEUE_NAME, scraperQueue);
  }

  async addJob(
    queueName: string,
    jobName: string,
    data: ScrapeJobData,
    opts?: {
      priority?: number;
      delay?: number;
      repeat?: any;
    }
  ): Promise<Job> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    // Validate job data
    ScrapeJobDataSchema.parse(data);

    return queue.add(jobName, data, {
      priority: opts?.priority || data.priority || 0,
      delay: opts?.delay,
      repeat: opts?.repeat,
      jobId: this.generateJobId(data),
    });
  }

  async addArtistScrapeJob(data: ArtistScrapeJob, opts?: any): Promise<Job> {
    return this.addJob(SCRAPER_QUEUE_NAME, 'artist-scrape', data, opts);
  }

  async addVenueScrapeJob(data: VenueScrapeJob, opts?: any): Promise<Job> {
    return this.addJob(SCRAPER_QUEUE_NAME, 'venue-scrape', data, opts);
  }

  async addDiscoverJob(data: DiscoverJob, opts?: any): Promise<Job> {
    return this.addJob(SCRAPER_QUEUE_NAME, 'discover', data, opts);
  }

  async addBackfillJob(data: BackfillJob, opts?: any): Promise<Job> {
    return this.addJob(SCRAPER_QUEUE_NAME, 'backfill', data, opts);
  }

  private generateJobId(data: ScrapeJobData): string {
    const timestamp = Date.now();
    const source = data.source;
    const type = data.type;
    const entityId = data.entityId || 'discover';

    return `${source}-${type}-${entityId}-${timestamp}`;
  }

  async getQueueStats(queueName: string) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    await queue.pause();
  }

  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    await queue.resume();
  }

  async cleanQueue(queueName: string, grace: number = 5000): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.clean(grace, 10, 'completed');
    await queue.clean(grace, 10, 'failed');
  }

  async shutdown(): Promise<void> {
    // Close all workers first
    for (const [name, worker] of this.workers) {
      console.log(`Closing worker: ${name}`);
      await worker.close();
    }

    // Close all queues
    for (const [name, queue] of this.queues) {
      console.log(`Closing queue: ${name}`);
      await queue.close();
    }

    // Close Redis connection
    await redisConnection.quit();
  }
}

export const queueManager = new QueueManager();