import PQueue from 'p-queue';

// Rate limiter configuration
export interface RateLimiterConfig {
  requestsPerSecond: number;
  maxConcurrency: number;
  maxRetries: number;
  retryDelay: number;
  timeoutMs: number;
}

// Interface to match the RateLimitConfig from base scraper
export interface RateLimitConfig {
  requestsPerSecond: number;
  maxConcurrency: number;
  retryDelay: number;
  maxRetries: number;
}

// Rate limiter for different sources
export class RateLimiter {
  private queues: Map<string, PQueue> = new Map();
  private configs: Map<string, RateLimiterConfig> = new Map();
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
  }

  // Register a rate limiter for a specific source
  register(source: string, config: RateLimiterConfig): void {
    this.configs.set(source, config);

    const queue = new PQueue({
      interval: 1000,
      intervalCap: config.requestsPerSecond,
      concurrency: config.maxConcurrency,
      timeout: config.timeoutMs,
    });

    // Log queue events
    queue.on('active', () => {
      this.logger.debug(`[${source}] Active requests: ${queue.pending} pending, ${queue.size} queued`);
    });

    queue.on('error', (error: Error) => {
      this.logger.error(`[${source}] Queue error`, { error: error.message });
    });

    queue.on('idle', () => {
      this.logger.debug(`[${source}] Queue is idle`);
    });

    this.queues.set(source, queue);
    this.logger.info(`Rate limiter registered for ${source}`, config);
  }

  // Execute a function with rate limiting
  async execute<T>(
    source: string,
    operation: () => Promise<T>,
    operationName?: string
  ): Promise<T> {
    const queue = this.queues.get(source);
    const config = this.configs.get(source);

    if (!queue || !config) {
      throw new Error(`No rate limiter registered for source: ${source}`);
    }

    return queue.add(async () => {
      return this.withRetry(operation, config.maxRetries, config.retryDelay, source, operationName);
    });
  }

  // Execute operation with exponential backoff retry
  private async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    baseDelay: number,
    source: string,
    operationName?: string
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await operation();

        // Log successful retry if this wasn't the first attempt
        if (attempt > 1) {
          this.logger.info(`[${source}] Operation succeeded on attempt ${attempt}`, {
            operation: operationName,
          });
        }

        return result;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        // Check if this is a rate limit error
        if (this.isRateLimitError(error)) {
          const rateLimitDelay = this.extractRateLimitDelay(error) || baseDelay * Math.pow(2, attempt);

          this.logger.warn(`[${source}] Rate limited, waiting ${rateLimitDelay}ms`, {
            attempt,
            operation: operationName,
            error: lastError.message,
          });

          if (attempt <= maxRetries) {
            await this.sleep(rateLimitDelay);
            continue;
          }
        }

        // Check if this is a retryable error
        if (this.isRetryableError(error)) {
          if (attempt <= maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt - 1);

            this.logger.warn(`[${source}] Retryable error, attempt ${attempt}/${maxRetries + 1}`, {
              operation: operationName,
              error: lastError.message,
              nextRetryIn: delay,
            });

            await this.sleep(delay);
            continue;
          }
        }

        // Non-retryable error or max retries exceeded
        this.logger.error(`[${source}] Operation failed permanently`, {
          operation: operationName,
          attempt,
          maxRetries,
          error: lastError.message,
        });

        throw lastError;
      }
    }

    throw lastError;
  }

  // Check if an error is due to rate limiting
  private isRateLimitError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message?.toLowerCase() || '';
    const statusCode = error.status || error.statusCode || error.code;

    // HTTP 429 Too Many Requests
    if (statusCode === 429) return true;

    // Common rate limit error messages
    const rateLimitMessages = [
      'rate limit',
      'rate limited',
      'too many requests',
      'quota exceeded',
      'api quota',
      'request limit',
    ];

    return rateLimitMessages.some(msg => errorMessage.includes(msg));
  }

  // Check if an error is retryable
  private isRetryableError(error: any): boolean {
    if (!error) return false;

    const statusCode = error.status || error.statusCode || error.code;

    // HTTP status codes that are generally retryable
    const retryableStatuses = [
      408, // Request Timeout
      500, // Internal Server Error
      502, // Bad Gateway
      503, // Service Unavailable
      504, // Gateway Timeout
      520, // Web server is returning an unknown error
      522, // Connection timed out
      524, // A timeout occurred
    ];

    if (retryableStatuses.includes(statusCode)) return true;

    // Network-related errors
    const errorMessage = error.message?.toLowerCase() || '';
    const networkErrors = [
      'network error',
      'connection reset',
      'connection refused',
      'timeout',
      'socket hang up',
      'enotfound',
      'econnreset',
      'econnrefused',
      'etimedout',
    ];

    return networkErrors.some(msg => errorMessage.includes(msg));
  }

  // Extract rate limit delay from error response
  private extractRateLimitDelay(error: any): number | null {
    if (!error) return null;

    // Check for Retry-After header (in seconds)
    const retryAfter = error.headers?.['retry-after'] || error.retryAfter;
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000; // Convert to milliseconds
      }
    }

    // Check for X-RateLimit-Reset header (timestamp)
    const resetTime = error.headers?.['x-ratelimit-reset'] || error.ratelimitReset;
    if (resetTime) {
      const resetTimestamp = parseInt(resetTime, 10);
      if (!isNaN(resetTimestamp)) {
        const now = Math.floor(Date.now() / 1000);
        const delay = (resetTimestamp - now) * 1000;
        return Math.max(delay, 1000); // At least 1 second
      }
    }

    // Check for X-RateLimit-Reset-After header (seconds)
    const resetAfter = error.headers?.['x-ratelimit-reset-after'] || error.ratelimitResetAfter;
    if (resetAfter) {
      const seconds = parseInt(resetAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }

    return null;
  }

  // Sleep utility
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get statistics for all rate limiters
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    for (const [source, queue] of this.queues) {
      const config = this.configs.get(source);
      stats[source] = {
        pending: queue.pending,
        size: queue.size,
        isPaused: queue.isPaused,
        config,
      };
    }

    return stats;
  }

  // Pause rate limiter for a specific source
  async pause(source: string): Promise<void> {
    const queue = this.queues.get(source);
    if (queue) {
      queue.pause();
      this.logger.info(`Rate limiter paused for ${source}`);
    }
  }

  // Resume rate limiter for a specific source
  async resume(source: string): Promise<void> {
    const queue = this.queues.get(source);
    if (queue) {
      queue.start();
      this.logger.info(`Rate limiter resumed for ${source}`);
    }
  }

  // Pause all rate limiters
  async pauseAll(): Promise<void> {
    for (const [source, queue] of this.queues) {
      queue.pause();
      this.logger.info(`Rate limiter paused for ${source}`);
    }
  }

  // Resume all rate limiters
  async resumeAll(): Promise<void> {
    for (const [source, queue] of this.queues) {
      queue.start();
      this.logger.info(`Rate limiter resumed for ${source}`);
    }
  }

  // Shutdown all rate limiters
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down rate limiters...');

    const shutdownPromises = Array.from(this.queues.entries()).map(async ([source, queue]) => {
      this.logger.debug(`Waiting for ${source} queue to idle...`);
      await queue.onIdle();
      queue.pause();
    });

    await Promise.all(shutdownPromises);
    this.logger.info('Rate limiters shutdown complete');
  }
}