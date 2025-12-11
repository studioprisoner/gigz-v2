import { z } from 'zod';
import { Queue, Worker, Job, QueueOptions, WorkerOptions, JobsOptions, QueueEvents } from 'bullmq';
import type { Redis } from 'ioredis';
import { getRedisClient } from './client.js';

// Queue configuration schema
export const QueueConfigSchema = z.object({
  connection: z.object({
    host: z.string().optional(),
    port: z.number().optional(),
    url: z.string().optional(),
  }).optional(),
  defaultJobOptions: z.object({
    delay: z.number().min(0).optional(),
    priority: z.number().optional(),
    attempts: z.number().min(1).default(3),
    backoff: z.union([
      z.string(),
      z.object({
        type: z.enum(['fixed', 'exponential']),
        delay: z.number().min(0).default(1000),
      }),
    ]).default({ type: 'exponential', delay: 1000 }),
    removeOnComplete: z.union([z.number(), z.boolean()]).default(100),
    removeOnFail: z.union([z.number(), z.boolean()]).default(50),
    jobId: z.string().optional(),
  }).optional(),
  limiter: z.object({
    max: z.number().min(1),
    duration: z.number().min(1000),
  }).optional(),
});

export type QueueConfig = z.infer<typeof QueueConfigSchema>;

// Worker configuration schema
export const WorkerConfigSchema = z.object({
  connection: z.object({
    host: z.string().optional(),
    port: z.number().optional(),
    url: z.string().optional(),
  }).optional(),
  concurrency: z.number().min(1).default(1),
  limiter: z.object({
    max: z.number().min(1),
    duration: z.number().min(1000),
  }).optional(),
  maxStalledCount: z.number().min(0).default(1),
  stalledInterval: z.number().min(1000).default(30000),
  retryProcessDelay: z.number().min(0).default(5000),
});

export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

// Job processor function type
export type JobProcessor<T = any, R = any> = (job: Job<T>) => Promise<R>;

// Queue statistics interface
export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

// Job scheduling options
export interface ScheduleJobOptions extends Partial<JobsOptions> {
  cron?: string;
  every?: number; // milliseconds
  at?: Date;
}

// Redis queue factory class
export class RedisQueueFactory {
  private client: Redis;
  private logger?: any;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();

  constructor(client?: Redis, logger?: any) {
    this.client = client || getRedisClient().getClient();
    this.logger = logger;

    // Setup graceful shutdown
    this.setupGracefulShutdown();
  }

  // Create a new queue
  createQueue<T = any>(
    name: string,
    config?: Partial<QueueConfig>
  ): Queue<T> {
    if (this.queues.has(name)) {
      this.logger?.warn('Queue already exists, returning existing instance', { name });
      return this.queues.get(name) as Queue<T>;
    }

    const queueConfig = QueueConfigSchema.parse(config || {});

    const connection = queueConfig.connection || {
      host: this.client.options.host,
      port: this.client.options.port,
    };

    const queue = new Queue<T>(name, {
      connection,
      defaultJobOptions: queueConfig.defaultJobOptions,
    });

    this.queues.set(name, queue);

    this.logger?.info('Queue created', {
      name,
      connection: connection.url ? '[URL]' : `${connection.host}:${connection.port}`,
    });

    return queue;
  }

  // Create a worker for a queue
  createWorker<T = any, R = any>(
    queueName: string,
    processor: JobProcessor<T, R>,
    config?: Partial<WorkerConfig>
  ): Worker<T, R> {
    const workerKey = `${queueName}-worker`;

    if (this.workers.has(workerKey)) {
      this.logger?.warn('Worker already exists, returning existing instance', { queueName });
      return this.workers.get(workerKey) as Worker<T, R>;
    }

    const workerConfig = WorkerConfigSchema.parse(config || {});

    const connection = workerConfig.connection || {
      host: this.client.options.host,
      port: this.client.options.port,
    };

    const worker = new Worker<T, R>(queueName, processor, {
      connection,
      concurrency: workerConfig.concurrency,
      limiter: workerConfig.limiter,
      maxStalledCount: workerConfig.maxStalledCount,
      stalledInterval: workerConfig.stalledInterval,
      retryProcessDelay: workerConfig.retryProcessDelay,
    });

    // Setup worker event handlers
    this.setupWorkerEvents(worker, queueName);

    this.workers.set(workerKey, worker);

    this.logger?.info('Worker created', {
      queueName,
      concurrency: workerConfig.concurrency,
    });

    return worker;
  }

  // Create queue events listener
  createQueueEvents(queueName: string): QueueEvents {
    if (this.queueEvents.has(queueName)) {
      return this.queueEvents.get(queueName)!;
    }

    const connection = {
      host: this.client.options.host,
      port: this.client.options.port,
    };

    const queueEvents = new QueueEvents(queueName, { connection });

    // Setup queue events handlers
    this.setupQueueEventHandlers(queueEvents, queueName);

    this.queueEvents.set(queueName, queueEvents);

    this.logger?.info('Queue events listener created', { queueName });

    return queueEvents;
  }

  // Get queue by name
  getQueue<T = any>(name: string): Queue<T> | undefined {
    return this.queues.get(name) as Queue<T>;
  }

  // Get worker by queue name
  getWorker<T = any, R = any>(queueName: string): Worker<T, R> | undefined {
    return this.workers.get(`${queueName}-worker`) as Worker<T, R>;
  }

  // Get queue events by queue name
  getQueueEvents(queueName: string): QueueEvents | undefined {
    return this.queueEvents.get(queueName);
  }

  // Add job to queue
  async addJob<T = any>(
    queueName: string,
    jobName: string,
    data: T,
    options?: Partial<JobsOptions>
  ): Promise<Job<T>> {
    const queue = this.getQueue<T>(queueName);

    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    try {
      const job = await queue.add(jobName, data, options);

      this.logger?.debug('Job added to queue', {
        queueName,
        jobName,
        jobId: job.id,
        delay: options?.delay,
        priority: options?.priority,
      });

      return job;

    } catch (error) {
      this.logger?.error('Failed to add job to queue', {
        queueName,
        jobName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Schedule recurring job
  async scheduleJob<T = any>(
    queueName: string,
    jobName: string,
    data: T,
    schedule: ScheduleJobOptions
  ): Promise<Job<T>> {
    const queue = this.getQueue<T>(queueName);

    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    try {
      let jobOptions: Partial<JobsOptions> = {
        ...schedule,
        repeat: undefined, // Will be set below
      };

      if (schedule.cron) {
        jobOptions.repeat = { pattern: schedule.cron };
      } else if (schedule.every) {
        jobOptions.repeat = { every: schedule.every };
      } else if (schedule.at) {
        jobOptions.delay = schedule.at.getTime() - Date.now();
      }

      const job = await queue.add(jobName, data, jobOptions);

      this.logger?.info('Scheduled job added to queue', {
        queueName,
        jobName,
        jobId: job.id,
        schedule: schedule.cron || schedule.every || schedule.at,
      });

      return job;

    } catch (error) {
      this.logger?.error('Failed to schedule job', {
        queueName,
        jobName,
        schedule,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Get queue statistics
  async getQueueStats(queueName: string): Promise<QueueStats> {
    const queue = this.getQueue(queueName);

    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    try {
      const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
        queue.getDelayed(),
        queue.isPaused(),
      ]);

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused: paused ? 1 : 0,
      };

    } catch (error) {
      this.logger?.error('Failed to get queue stats', {
        queueName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: 0,
      };
    }
  }

  // Pause queue
  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);

    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    await queue.pause();
    this.logger?.info('Queue paused', { queueName });
  }

  // Resume queue
  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);

    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    await queue.resume();
    this.logger?.info('Queue resumed', { queueName });
  }

  // Clean queue
  async cleanQueue(
    queueName: string,
    grace: number = 5000,
    limit: number = 100,
    type: 'completed' | 'failed' | 'active' | 'waiting' | 'delayed' = 'completed'
  ): Promise<number> {
    const queue = this.getQueue(queueName);

    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    try {
      const cleaned = await queue.clean(grace, limit, type);

      this.logger?.info('Queue cleaned', {
        queueName,
        type,
        cleaned: cleaned.length,
        grace,
        limit,
      });

      return cleaned.length;

    } catch (error) {
      this.logger?.error('Failed to clean queue', {
        queueName,
        type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  // Get job by ID
  async getJob<T = any>(queueName: string, jobId: string): Promise<Job<T> | undefined> {
    const queue = this.getQueue<T>(queueName);

    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    try {
      return await queue.getJob(jobId);
    } catch (error) {
      this.logger?.error('Failed to get job', {
        queueName,
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  // Remove job
  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    const queue = this.getQueue(queueName);

    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    try {
      const job = await queue.getJob(jobId);
      if (job) {
        await job.remove();
        this.logger?.debug('Job removed', { queueName, jobId });
        return true;
      }
      return false;
    } catch (error) {
      this.logger?.error('Failed to remove job', {
        queueName,
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // Setup worker event handlers
  private setupWorkerEvents(worker: Worker, queueName: string): void {
    worker.on('ready', () => {
      this.logger?.info('Worker ready', { queueName });
    });

    worker.on('active', (job: Job) => {
      this.logger?.debug('Job started', {
        queueName,
        jobId: job.id,
        jobName: job.name,
      });
    });

    worker.on('completed', (job: Job, result: any) => {
      this.logger?.debug('Job completed', {
        queueName,
        jobId: job.id,
        jobName: job.name,
        processingTime: job.finishedOn ? job.finishedOn - job.processedOn! : 0,
      });
    });

    worker.on('failed', (job: Job | undefined, error: Error) => {
      this.logger?.error('Job failed', {
        queueName,
        jobId: job?.id,
        jobName: job?.name,
        error: error.message,
        attempts: job?.attemptsMade,
        maxAttempts: job?.opts.attempts,
      });
    });

    worker.on('stalled', (jobId: string) => {
      this.logger?.warn('Job stalled', { queueName, jobId });
    });

    worker.on('error', (error: Error) => {
      this.logger?.error('Worker error', {
        queueName,
        error: error.message,
        stack: error.stack,
      });
    });
  }

  // Setup queue event handlers
  private setupQueueEventHandlers(queueEvents: QueueEvents, queueName: string): void {
    queueEvents.on('added', ({ jobId, name }) => {
      this.logger?.debug('Job added to queue', { queueName, jobId, jobName: name });
    });

    queueEvents.on('waiting', ({ jobId }) => {
      this.logger?.debug('Job waiting', { queueName, jobId });
    });

    queueEvents.on('delayed', ({ jobId, delay }) => {
      this.logger?.debug('Job delayed', { queueName, jobId, delay });
    });

    queueEvents.on('removed', ({ jobId }) => {
      this.logger?.debug('Job removed', { queueName, jobId });
    });

    queueEvents.on('cleaned', ({ count }) => {
      this.logger?.info('Queue cleaned', { queueName, count });
    });

    queueEvents.on('error', (error: Error) => {
      this.logger?.error('Queue events error', {
        queueName,
        error: error.message,
      });
    });
  }

  // Setup graceful shutdown
  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      this.logger?.info('Shutting down queue factory...');

      try {
        // Close all workers
        for (const [name, worker] of this.workers) {
          await worker.close();
          this.logger?.debug('Worker closed', { name });
        }

        // Close all queues
        for (const [name, queue] of this.queues) {
          await queue.close();
          this.logger?.debug('Queue closed', { name });
        }

        // Close all queue events
        for (const [name, queueEvents] of this.queueEvents) {
          await queueEvents.close();
          this.logger?.debug('Queue events closed', { name });
        }

        this.logger?.info('Queue factory shutdown complete');

      } catch (error) {
        this.logger?.error('Error during queue factory shutdown', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  // Get all queue names
  getQueueNames(): string[] {
    return Array.from(this.queues.keys());
  }

  // Get all worker names
  getWorkerNames(): string[] {
    return Array.from(this.workers.keys());
  }

  // Check if queue exists
  hasQueue(name: string): boolean {
    return this.queues.has(name);
  }

  // Check if worker exists
  hasWorker(queueName: string): boolean {
    return this.workers.has(`${queueName}-worker`);
  }
}

// Default queue factory instance
let defaultQueueFactory: RedisQueueFactory | null = null;

// Initialize default queue factory
export function initializeQueueFactory(client?: Redis, logger?: any): RedisQueueFactory {
  if (defaultQueueFactory) {
    throw new Error('Queue factory already initialized. Use getQueueFactory() to access it.');
  }

  defaultQueueFactory = new RedisQueueFactory(client, logger);
  return defaultQueueFactory;
}

// Get default queue factory instance
export function getQueueFactory(): RedisQueueFactory {
  if (!defaultQueueFactory) {
    // Auto-initialize with default settings if not already done
    defaultQueueFactory = new RedisQueueFactory();
  }
  return defaultQueueFactory;
}

// Create a new queue factory instance
export function createQueueFactory(client?: Redis, logger?: any): RedisQueueFactory {
  return new RedisQueueFactory(client, logger);
}

// Utility functions for common queue operations

// Create queue with default configuration
export function createQueue<T = any>(
  name: string,
  config?: Partial<QueueConfig>
): Queue<T> {
  return getQueueFactory().createQueue<T>(name, config);
}

// Create worker with default configuration
export function createWorker<T = any, R = any>(
  queueName: string,
  processor: JobProcessor<T, R>,
  config?: Partial<WorkerConfig>
): Worker<T, R> {
  return getQueueFactory().createWorker<T, R>(queueName, processor, config);
}

// Add job to queue
export async function addJob<T = any>(
  queueName: string,
  jobName: string,
  data: T,
  options?: Partial<JobsOptions>
): Promise<Job<T>> {
  return getQueueFactory().addJob<T>(queueName, jobName, data, options);
}

// Schedule job
export async function scheduleJob<T = any>(
  queueName: string,
  jobName: string,
  data: T,
  schedule: ScheduleJobOptions
): Promise<Job<T>> {
  return getQueueFactory().scheduleJob<T>(queueName, jobName, data, schedule);
}

// Export queue factory class and utilities
export default RedisQueueFactory;