import { z } from 'zod';

// Error severity levels
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// Error categories
export enum ErrorCategory {
  NETWORK = 'network',
  API = 'api',
  PARSING = 'parsing',
  VALIDATION = 'validation',
  RATE_LIMIT = 'rate_limit',
  AUTHENTICATION = 'authentication',
  DATABASE = 'database',
  UNKNOWN = 'unknown',
}

// Error context interface
export interface ErrorContext {
  source?: string;
  operation?: string;
  entityId?: string;
  jobId?: string;
  attempt?: number;
  maxAttempts?: number;
  metadata?: Record<string, any>;
}

// Processed error interface
export interface ProcessedError {
  id: string;
  originalError: Error;
  category: ErrorCategory;
  severity: ErrorSeverity;
  isRetryable: boolean;
  isRateLimited: boolean;
  retryDelay?: number;
  context: ErrorContext;
  timestamp: Date;
  message: string;
  stack?: string;
}

// Error statistics
export interface ErrorStats {
  total: number;
  byCategory: Record<ErrorCategory, number>;
  bySeverity: Record<ErrorSeverity, number>;
  bySource: Record<string, number>;
  retryable: number;
  nonRetryable: number;
  rateLimited: number;
}

// Error handler service
export class ErrorHandler {
  private errors: Map<string, ProcessedError> = new Map();
  private logger: any;
  private maxErrors = 1000; // Keep last 1000 errors in memory

  constructor(logger: any) {
    this.logger = logger;
  }

  // Process and categorize an error
  processError(error: Error, context: ErrorContext = {}): ProcessedError {
    const id = this.generateErrorId();
    const timestamp = new Date();

    const category = this.categorizeError(error);
    const severity = this.determineSeverity(error, category, context);
    const isRetryable = this.isRetryableError(error, category);
    const isRateLimited = this.isRateLimitedError(error);
    const retryDelay = this.calculateRetryDelay(error, context.attempt || 1);

    const processedError: ProcessedError = {
      id,
      originalError: error,
      category,
      severity,
      isRetryable,
      isRateLimited,
      retryDelay,
      context,
      timestamp,
      message: error.message,
      stack: error.stack,
    };

    // Store error (with rotation)
    this.storeError(processedError);

    // Log error
    this.logError(processedError);

    return processedError;
  }

  // Categorize error based on error details
  private categorizeError(error: Error): ErrorCategory {
    const message = error.message?.toLowerCase() || '';
    const name = error.name?.toLowerCase() || '';

    // Network errors
    const networkPatterns = [
      'network error',
      'connection refused',
      'connection reset',
      'timeout',
      'socket hang up',
      'enotfound',
      'econnreset',
      'econnrefused',
      'etimedout',
    ];

    if (networkPatterns.some(pattern => message.includes(pattern))) {
      return ErrorCategory.NETWORK;
    }

    // Rate limit errors
    const rateLimitPatterns = [
      'rate limit',
      'rate limited',
      'too many requests',
      'quota exceeded',
      'api quota',
    ];

    if (rateLimitPatterns.some(pattern => message.includes(pattern))) {
      return ErrorCategory.RATE_LIMIT;
    }

    // Authentication errors
    const authPatterns = [
      'unauthorized',
      'authentication',
      'invalid api key',
      'access denied',
      'forbidden',
    ];

    if (authPatterns.some(pattern => message.includes(pattern))) {
      return ErrorCategory.AUTHENTICATION;
    }

    // API errors (HTTP status codes)
    if (message.includes('http') || message.includes('status')) {
      return ErrorCategory.API;
    }

    // Parsing errors
    const parsePatterns = [
      'parse',
      'parsing',
      'json',
      'xml',
      'invalid format',
      'unexpected token',
    ];

    if (parsePatterns.some(pattern => message.includes(pattern)) || name.includes('syntaxerror')) {
      return ErrorCategory.PARSING;
    }

    // Validation errors
    const validationPatterns = [
      'validation',
      'invalid',
      'required',
      'missing',
      'expected',
    ];

    if (validationPatterns.some(pattern => message.includes(pattern)) || name.includes('validationerror')) {
      return ErrorCategory.VALIDATION;
    }

    // Database errors
    const dbPatterns = [
      'database',
      'clickhouse',
      'query',
      'insert',
      'connection pool',
    ];

    if (dbPatterns.some(pattern => message.includes(pattern))) {
      return ErrorCategory.DATABASE;
    }

    return ErrorCategory.UNKNOWN;
  }

  // Determine error severity
  private determineSeverity(error: Error, category: ErrorCategory, context: ErrorContext): ErrorSeverity {
    // Critical errors that require immediate attention
    if (category === ErrorCategory.AUTHENTICATION || category === ErrorCategory.DATABASE) {
      return ErrorSeverity.CRITICAL;
    }

    // Check HTTP status codes for API errors
    const statusCode = this.extractStatusCode(error);
    if (statusCode) {
      if (statusCode >= 500) return ErrorSeverity.HIGH;
      if (statusCode === 429) return ErrorSeverity.MEDIUM; // Rate limit
      if (statusCode >= 400) return ErrorSeverity.MEDIUM;
    }

    // High severity for repeated failures
    if (context.attempt && context.maxAttempts && context.attempt >= context.maxAttempts) {
      return ErrorSeverity.HIGH;
    }

    // Network errors are usually medium severity
    if (category === ErrorCategory.NETWORK) {
      return ErrorSeverity.MEDIUM;
    }

    // Parsing and validation errors are usually low severity (data quality issues)
    if (category === ErrorCategory.PARSING || category === ErrorCategory.VALIDATION) {
      return ErrorSeverity.LOW;
    }

    return ErrorSeverity.MEDIUM;
  }

  // Check if error is retryable
  private isRetryableError(error: Error, category: ErrorCategory): boolean {
    // Non-retryable categories
    if (category === ErrorCategory.AUTHENTICATION || category === ErrorCategory.VALIDATION) {
      return false;
    }

    // Check HTTP status codes
    const statusCode = this.extractStatusCode(error);
    if (statusCode) {
      // Client errors (4xx) are generally not retryable, except rate limits
      if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        return false;
      }
    }

    // Most other errors are retryable
    return true;
  }

  // Check if error is due to rate limiting
  private isRateLimitedError(error: Error): boolean {
    const message = error.message?.toLowerCase() || '';
    const statusCode = this.extractStatusCode(error);

    return statusCode === 429 ||
           message.includes('rate limit') ||
           message.includes('too many requests') ||
           message.includes('quota exceeded');
  }

  // Calculate retry delay based on error and attempt
  private calculateRetryDelay(error: Error, attempt: number): number | undefined {
    // Extract delay from rate limit headers
    const rateLimitDelay = this.extractRateLimitDelay(error);
    if (rateLimitDelay) return rateLimitDelay;

    // Exponential backoff for retryable errors
    if (this.isRetryableError(error, this.categorizeError(error))) {
      const baseDelay = 1000; // 1 second
      return Math.min(baseDelay * Math.pow(2, attempt - 1), 30000); // Max 30 seconds
    }

    return undefined;
  }

  // Extract HTTP status code from error
  private extractStatusCode(error: any): number | null {
    if (typeof error.status === 'number') return error.status;
    if (typeof error.statusCode === 'number') return error.statusCode;
    if (typeof error.code === 'number') return error.code;

    // Try to extract from message
    const statusMatch = error.message?.match(/http (\d{3})/i);
    if (statusMatch) {
      return parseInt(statusMatch[1], 10);
    }

    return null;
  }

  // Extract rate limit delay from error
  private extractRateLimitDelay(error: any): number | null {
    if (!error) return null;

    // Check for standard rate limit headers
    const retryAfter = error.headers?.['retry-after'];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) return seconds * 1000;
    }

    const resetTime = error.headers?.['x-ratelimit-reset'];
    if (resetTime) {
      const resetTimestamp = parseInt(resetTime, 10);
      if (!isNaN(resetTimestamp)) {
        const now = Math.floor(Date.now() / 1000);
        return Math.max((resetTimestamp - now) * 1000, 1000);
      }
    }

    return null;
  }

  // Store error with rotation
  private storeError(error: ProcessedError): void {
    // Remove oldest error if at capacity
    if (this.errors.size >= this.maxErrors) {
      const oldestId = this.errors.keys().next().value;
      if (oldestId) {
        this.errors.delete(oldestId);
      }
    }

    this.errors.set(error.id, error);
  }

  // Log error with appropriate level
  private logError(error: ProcessedError): void {
    const logData = {
      errorId: error.id,
      category: error.category,
      severity: error.severity,
      isRetryable: error.isRetryable,
      isRateLimited: error.isRateLimited,
      retryDelay: error.retryDelay,
      context: error.context,
    };

    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        this.logger.error(error.message, { ...logData, stack: error.stack });
        break;
      case ErrorSeverity.HIGH:
        this.logger.error(error.message, logData);
        break;
      case ErrorSeverity.MEDIUM:
        this.logger.warn(error.message, logData);
        break;
      case ErrorSeverity.LOW:
        this.logger.info(error.message, logData);
        break;
    }
  }

  // Generate unique error ID
  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get error statistics
  getStats(): ErrorStats {
    const stats: ErrorStats = {
      total: this.errors.size,
      byCategory: {} as Record<ErrorCategory, number>,
      bySeverity: {} as Record<ErrorSeverity, number>,
      bySource: {},
      retryable: 0,
      nonRetryable: 0,
      rateLimited: 0,
    };

    // Initialize counters
    Object.values(ErrorCategory).forEach(category => {
      stats.byCategory[category] = 0;
    });

    Object.values(ErrorSeverity).forEach(severity => {
      stats.bySeverity[severity] = 0;
    });

    // Count errors
    for (const error of this.errors.values()) {
      stats.byCategory[error.category]++;
      stats.bySeverity[error.severity]++;

      if (error.context.source) {
        stats.bySource[error.context.source] = (stats.bySource[error.context.source] || 0) + 1;
      }

      if (error.isRetryable) {
        stats.retryable++;
      } else {
        stats.nonRetryable++;
      }

      if (error.isRateLimited) {
        stats.rateLimited++;
      }
    }

    return stats;
  }

  // Get recent errors
  getRecentErrors(limit: number = 50): ProcessedError[] {
    const errors = Array.from(this.errors.values());
    return errors
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  // Get errors by category
  getErrorsByCategory(category: ErrorCategory): ProcessedError[] {
    return Array.from(this.errors.values())
      .filter(error => error.category === category)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  // Get errors by severity
  getErrorsBySeverity(severity: ErrorSeverity): ProcessedError[] {
    return Array.from(this.errors.values())
      .filter(error => error.severity === severity)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  // Clear all errors
  clearErrors(): void {
    this.errors.clear();
    this.logger.info('Error history cleared');
  }

  // Clear old errors (older than specified age)
  clearOldErrors(maxAgeMs: number): void {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const toDelete: string[] = [];

    for (const [id, error] of this.errors) {
      if (error.timestamp < cutoff) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.errors.delete(id);
    }

    if (toDelete.length > 0) {
      this.logger.info(`Cleared ${toDelete.length} old errors`);
    }
  }
}