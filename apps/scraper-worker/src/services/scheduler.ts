import * as cron from 'node-cron';
import { queueManager, type ScrapeJobData } from '../queue/index.js';

// Schedule configuration
export interface ScheduleConfig {
  enabled: boolean;
  cronExpression: string;
  jobData: ScrapeJobData;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
}

// Scheduled job definition
export interface ScheduledJob {
  id: string;
  name: string;
  description: string;
  config: ScheduleConfig;
  task: cron.ScheduledTask;
}

// Job scheduler service
export class JobScheduler {
  private jobs: Map<string, ScheduledJob> = new Map();
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
    this.setupDefaultSchedules();
  }

  // Setup default scheduled jobs
  private setupDefaultSchedules(): void {
    // Daily discovery for recent concerts
    this.scheduleJob(
      'daily-discovery',
      'Daily Concert Discovery',
      'Discover new concerts from the last 7 days',
      {
        enabled: true,
        cronExpression: '0 2 * * *', // Daily at 2 AM
        jobData: {
          source: 'setlistfm',
          type: 'discover',
          params: {
            dateRange: {
              start: this.formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), // 7 days ago
              end: this.formatDate(new Date()), // Today
            },
            limit: 1000,
          },
          priority: 5,
          retryCount: 3,
        },
        runCount: 0,
      }
    );

    // Weekly backfill for older concerts
    this.scheduleJob(
      'weekly-backfill',
      'Weekly Historical Backfill',
      'Backfill historical concerts from previous month',
      {
        enabled: true,
        cronExpression: '0 1 * * 0', // Weekly on Sunday at 1 AM
        jobData: {
          source: 'setlistfm',
          type: 'backfill',
          params: {
            startDate: this.formatDate(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)), // 60 days ago
            endDate: this.formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)), // 30 days ago
            batchSize: 500,
          },
          priority: 3,
          retryCount: 2,
        },
        runCount: 0,
      }
    );

    // Hourly discovery for popular venues
    this.scheduleJob(
      'venue-discovery',
      'Popular Venue Discovery',
      'Discover new concerts at popular venues',
      {
        enabled: false, // Disabled by default - can be enabled via configuration
        cronExpression: '0 * * * *', // Hourly
        jobData: {
          source: 'setlistfm',
          type: 'discover',
          params: {
            location: 'New York', // Example - should be configurable
            dateRange: {
              start: this.formatDate(new Date()),
              end: this.formatDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), // Next 30 days
            },
            limit: 100,
          },
          priority: 4,
          retryCount: 3,
        },
        runCount: 0,
      }
    );

    this.logger.info('Default scheduled jobs configured');
  }

  // Schedule a new job
  scheduleJob(
    id: string,
    name: string,
    description: string,
    config: ScheduleConfig
  ): boolean {
    try {
      // Validate cron expression
      if (!cron.validate(config.cronExpression)) {
        throw new Error(`Invalid cron expression: ${config.cronExpression}`);
      }

      // Remove existing job if it exists
      this.unscheduleJob(id);

      // Create the scheduled task
      const task = cron.schedule(config.cronExpression, async () => {
        await this.executeScheduledJob(id);
      }, {
        timezone: 'UTC',
      });

      // Stop the task initially if not enabled
      if (!config.enabled) {
        task.stop();
      }

      // Calculate next run time
      config.nextRun = this.getNextRunTime(config.cronExpression);

      const scheduledJob: ScheduledJob = {
        id,
        name,
        description,
        config,
        task,
      };

      this.jobs.set(id, scheduledJob);

      // Start the job if enabled
      if (config.enabled) {
        task.start();
        this.logger.info(`Scheduled job started: ${name}`, {
          id,
          cronExpression: config.cronExpression,
          nextRun: config.nextRun,
        });
      } else {
        this.logger.info(`Scheduled job created but disabled: ${name}`, { id });
      }

      return true;

    } catch (error) {
      this.logger.error(`Failed to schedule job: ${name}`, {
        id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // Unschedule a job
  unscheduleJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) {
      return false;
    }

    job.task.stop();
    job.task.destroy();
    this.jobs.delete(id);

    this.logger.info(`Unscheduled job: ${job.name}`, { id });
    return true;
  }

  // Execute a scheduled job
  private async executeScheduledJob(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) {
      this.logger.error(`Scheduled job not found: ${id}`);
      return;
    }

    const startTime = Date.now();

    this.logger.info(`Executing scheduled job: ${job.name}`, {
      id,
      runCount: job.config.runCount,
    });

    try {
      // Update run information
      job.config.lastRun = new Date();
      job.config.runCount++;
      job.config.nextRun = this.getNextRunTime(job.config.cronExpression);

      // Add the job to the queue
      await queueManager.addJob('scraper', `scheduled-${id}`, job.config.jobData, {
        priority: job.config.jobData.priority,
      });

      const duration = Date.now() - startTime;

      this.logger.info(`Scheduled job completed: ${job.name}`, {
        id,
        duration,
        nextRun: job.config.nextRun,
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error(`Scheduled job failed: ${job.name}`, {
        id,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      });
    }
  }

  // Enable a scheduled job
  enableJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) {
      return false;
    }

    if (!job.config.enabled) {
      job.config.enabled = true;
      job.config.nextRun = this.getNextRunTime(job.config.cronExpression);
      job.task.start();

      this.logger.info(`Enabled scheduled job: ${job.name}`, {
        id,
        nextRun: job.config.nextRun,
      });
    }

    return true;
  }

  // Disable a scheduled job
  disableJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) {
      return false;
    }

    if (job.config.enabled) {
      job.config.enabled = false;
      job.config.nextRun = undefined;
      job.task.stop();

      this.logger.info(`Disabled scheduled job: ${job.name}`, { id });
    }

    return true;
  }

  // Update job configuration
  updateJobConfig(id: string, updates: Partial<ScheduleConfig>): boolean {
    const job = this.jobs.get(id);
    if (!job) {
      return false;
    }

    const wasEnabled = job.config.enabled;

    // Stop the job if it's running
    if (wasEnabled) {
      job.task.stop();
    }

    // Update configuration
    job.config = { ...job.config, ...updates };

    // If cron expression changed, recreate the task
    if (updates.cronExpression && updates.cronExpression !== job.config.cronExpression) {
      job.task.destroy();

      job.task = cron.schedule(job.config.cronExpression, async () => {
        await this.executeScheduledJob(id);
      }, {
        timezone: 'UTC',
      });

      // Stop initially
      job.task.stop();
    }

    // Recalculate next run time
    if (job.config.enabled) {
      job.config.nextRun = this.getNextRunTime(job.config.cronExpression);
    } else {
      job.config.nextRun = undefined;
    }

    // Start the job if it should be enabled
    if (job.config.enabled) {
      job.task.start();
    }

    this.logger.info(`Updated job configuration: ${job.name}`, {
      id,
      enabled: job.config.enabled,
      nextRun: job.config.nextRun,
    });

    return true;
  }

  // Get all scheduled jobs
  getAllJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  // Get a specific job
  getJob(id: string): ScheduledJob | undefined {
    return this.jobs.get(id);
  }

  // Get job statistics
  getJobStats(): Record<string, any> {
    const stats = {
      totalJobs: this.jobs.size,
      enabledJobs: 0,
      disabledJobs: 0,
      totalRuns: 0,
      jobDetails: [] as any[],
    };

    for (const job of this.jobs.values()) {
      if (job.config.enabled) {
        stats.enabledJobs++;
      } else {
        stats.disabledJobs++;
      }

      stats.totalRuns += job.config.runCount;

      stats.jobDetails.push({
        id: job.id,
        name: job.name,
        enabled: job.config.enabled,
        cronExpression: job.config.cronExpression,
        lastRun: job.config.lastRun,
        nextRun: job.config.nextRun,
        runCount: job.config.runCount,
      });
    }

    return stats;
  }

  // Manually trigger a scheduled job
  async triggerJob(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) {
      return false;
    }

    this.logger.info(`Manually triggering job: ${job.name}`, { id });

    try {
      await queueManager.addJob('scraper', `manual-${id}`, job.config.jobData, {
        priority: job.config.jobData.priority + 1, // Higher priority for manual triggers
      });

      return true;

    } catch (error) {
      this.logger.error(`Failed to manually trigger job: ${job.name}`, {
        id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // Calculate next run time for a cron expression
  private getNextRunTime(cronExpression: string): Date {
    // This is a simplified implementation
    // In production, you might want to use a more robust cron parser

    // For now, return a time 1 minute from now as a placeholder
    // A proper implementation would parse the cron expression to calculate the actual next run
    return new Date(Date.now() + 60 * 1000);
  }

  // Format date as YYYY-MM-DD
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  // Shutdown all scheduled jobs
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down job scheduler...');

    for (const [id, job] of this.jobs) {
      try {
        job.task.stop();
        job.task.destroy();
        this.logger.debug(`Stopped scheduled job: ${job.name}`, { id });
      } catch (error) {
        this.logger.warn(`Failed to stop scheduled job: ${job.name}`, {
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.jobs.clear();
    this.logger.info('Job scheduler shutdown complete');
  }

  // Load job configurations from external source (placeholder)
  async loadJobConfigurations(configs: Array<{
    id: string;
    name: string;
    description: string;
    config: ScheduleConfig;
  }>): Promise<void> {
    this.logger.info(`Loading ${configs.length} job configurations`);

    for (const jobConfig of configs) {
      this.scheduleJob(
        jobConfig.id,
        jobConfig.name,
        jobConfig.description,
        jobConfig.config
      );
    }
  }

  // Export current job configurations
  exportJobConfigurations(): Array<{
    id: string;
    name: string;
    description: string;
    config: ScheduleConfig;
  }> {
    return Array.from(this.jobs.values()).map(job => ({
      id: job.id,
      name: job.name,
      description: job.description,
      config: { ...job.config },
    }));
  }
}