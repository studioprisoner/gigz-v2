import { z } from 'zod';

// Request context for logging
export interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  query: string;
  userAgent?: string;
  ip: string;
  userId?: string;
  origin?: string;
  referer?: string;
  startTime: number;
}

// Response context for logging
export interface ResponseContext {
  status: number;
  statusText: string;
  duration: number;
  size?: number;
  contentType?: string;
  target?: string;
  retries?: number;
}

// Error context for logging
export interface ErrorContext {
  error: Error;
  stack?: string;
  code?: string;
  target?: string;
  retries?: number;
}

// Log level configuration
export const LogLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

// Logging configuration
export const LogConfigSchema = z.object({
  level: LogLevelSchema.default('info'),
  includeHeaders: z.boolean().default(false),
  includeBody: z.boolean().default(false),
  maxBodySize: z.number().min(0).default(1024), // bytes
  sensitiveHeaders: z.array(z.string()).default([
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
  ]),
  excludePaths: z.array(z.string()).default([
    '/health',
    '/favicon.ico',
  ]),
  slowRequestThreshold: z.number().min(100).default(1000), // milliseconds
  errorStackTrace: z.boolean().default(true),
});

export type LogConfig = z.infer<typeof LogConfigSchema>;

// Request metrics for monitoring
export interface RequestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  slowRequests: number;
  errorsByStatus: Record<number, number>;
  requestsByPath: Record<string, number>;
  requestsByUserAgent: Record<string, number>;
}

// Gateway request logger
export class GatewayLogger {
  private config: LogConfig;
  private logger: any;
  private metrics: RequestMetrics;
  private requestContexts: Map<string, RequestContext>;

  constructor(pinoLogger: any, config?: Partial<LogConfig>) {
    this.config = {
      ...LogConfigSchema.parse({}),
      ...config,
    };
    this.logger = pinoLogger;
    this.metrics = this.initializeMetrics();
    this.requestContexts = new Map();

    // Clean up old request contexts periodically
    setInterval(() => {
      this.cleanupOldContexts();
    }, 60000); // Every minute
  }

  // Log incoming request
  logRequest(request: Request, userId?: string): string {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);

    // Skip logging for excluded paths
    if (this.config.excludePaths.includes(url.pathname)) {
      return requestId;
    }

    const context: RequestContext = {
      requestId,
      method: request.method,
      path: url.pathname,
      query: url.search,
      userAgent: request.headers.get('user-agent') || undefined,
      ip: this.getClientIP(request),
      userId,
      origin: request.headers.get('origin') || undefined,
      referer: request.headers.get('referer') || undefined,
      startTime: Date.now(),
    };

    // Store context for response logging
    this.requestContexts.set(requestId, context);

    // Update metrics
    this.metrics.totalRequests++;
    this.metrics.requestsByPath[url.pathname] = (this.metrics.requestsByPath[url.pathname] || 0) + 1;
    if (context.userAgent) {
      this.metrics.requestsByUserAgent[context.userAgent] = (this.metrics.requestsByUserAgent[context.userAgent] || 0) + 1;
    }

    // Log request
    const logData: any = {
      requestId,
      method: context.method,
      path: context.path,
      query: context.query,
      ip: context.ip,
      userAgent: context.userAgent,
      origin: context.origin,
      userId: context.userId,
    };

    // Include headers if configured
    if (this.config.includeHeaders) {
      logData.headers = this.sanitizeHeaders(request.headers);
    }

    // Include body if configured (for POST/PUT requests)
    if (this.config.includeBody && this.shouldLogBody(request)) {
      // Note: In a real implementation, we'd need to clone the request
      // to avoid consuming the body stream
      logData.bodyNote = 'Body logging requires request cloning';
    }

    this.logger.info(logData, 'Request received');

    return requestId;
  }

  // Log response
  logResponse(
    requestId: string,
    response: Response,
    target?: string,
    retries?: number
  ): void {
    const context = this.requestContexts.get(requestId);
    if (!context) {
      this.logger.warn({ requestId }, 'No context found for response logging');
      return;
    }

    const duration = Date.now() - context.startTime;

    const responseContext: ResponseContext = {
      status: response.status,
      statusText: response.statusText,
      duration,
      size: this.getResponseSize(response),
      contentType: response.headers.get('content-type') || undefined,
      target,
      retries,
    };

    // Update metrics
    if (response.status >= 200 && response.status < 400) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
      this.metrics.errorsByStatus[response.status] = (this.metrics.errorsByStatus[response.status] || 0) + 1;
    }

    // Update average response time
    const totalRequests = this.metrics.successfulRequests + this.metrics.failedRequests;
    this.metrics.avgResponseTime = ((this.metrics.avgResponseTime * (totalRequests - 1)) + duration) / totalRequests;

    // Track slow requests
    if (duration >= this.config.slowRequestThreshold) {
      this.metrics.slowRequests++;
    }

    // Determine log level based on status and duration
    const logLevel = this.getResponseLogLevel(response.status, duration);

    const logData: any = {
      requestId,
      method: context.method,
      path: context.path,
      ip: context.ip,
      userId: context.userId,
      status: responseContext.status,
      statusText: responseContext.statusText,
      duration: responseContext.duration,
      size: responseContext.size,
      contentType: responseContext.contentType,
      target: responseContext.target,
      retries: responseContext.retries,
    };

    // Include response headers if configured
    if (this.config.includeHeaders) {
      logData.responseHeaders = this.sanitizeHeaders(response.headers);
    }

    this.logger[logLevel](logData, 'Request completed');

    // Clean up context
    this.requestContexts.delete(requestId);
  }

  // Log error
  logError(
    requestId: string,
    error: Error,
    target?: string,
    retries?: number
  ): void {
    const context = this.requestContexts.get(requestId);

    const errorContext: ErrorContext = {
      error,
      stack: this.config.errorStackTrace ? error.stack : undefined,
      code: (error as any).code,
      target,
      retries,
    };

    // Update metrics
    this.metrics.failedRequests++;
    this.metrics.errorsByStatus[500] = (this.metrics.errorsByStatus[500] || 0) + 1;

    const logData: any = {
      requestId,
      error: {
        message: error.message,
        name: error.name,
        code: errorContext.code,
        stack: errorContext.stack,
      },
      target: errorContext.target,
      retries: errorContext.retries,
    };

    if (context) {
      logData.method = context.method;
      logData.path = context.path;
      logData.ip = context.ip;
      logData.userId = context.userId;
      logData.duration = Date.now() - context.startTime;
    }

    this.logger.error(logData, 'Request failed');

    // Clean up context if exists
    if (context) {
      this.requestContexts.delete(requestId);
    }
  }

  // Log rate limit event
  logRateLimit(
    requestId: string,
    identifier: string,
    remaining: number,
    resetTime: Date
  ): void {
    const context = this.requestContexts.get(requestId);

    const logData: any = {
      requestId,
      identifier,
      remaining,
      resetTime: resetTime.toISOString(),
      type: 'rate_limit',
    };

    if (context) {
      logData.method = context.method;
      logData.path = context.path;
      logData.ip = context.ip;
      logData.userId = context.userId;
    }

    this.logger.warn(logData, 'Rate limit applied');
  }

  // Log CORS event
  logCors(
    requestId: string,
    origin: string | null,
    allowed: boolean,
    reason?: string
  ): void {
    const context = this.requestContexts.get(requestId);

    const logData: any = {
      requestId,
      origin,
      allowed,
      reason,
      type: 'cors',
    };

    if (context) {
      logData.method = context.method;
      logData.path = context.path;
      logData.ip = context.ip;
    }

    if (allowed) {
      this.logger.debug(logData, 'CORS request allowed');
    } else {
      this.logger.warn(logData, 'CORS request blocked');
    }
  }

  // Log authentication event
  logAuth(
    requestId: string,
    userId?: string,
    success: boolean = true,
    reason?: string
  ): void {
    const context = this.requestContexts.get(requestId);

    const logData: any = {
      requestId,
      userId,
      success,
      reason,
      type: 'auth',
    };

    if (context) {
      logData.method = context.method;
      logData.path = context.path;
      logData.ip = context.ip;
    }

    if (success) {
      this.logger.debug(logData, 'Authentication successful');
    } else {
      this.logger.warn(logData, 'Authentication failed');
    }
  }

  // Get current metrics
  getMetrics(): RequestMetrics {
    return { ...this.metrics };
  }

  // Reset metrics
  resetMetrics(): void {
    this.metrics = this.initializeMetrics();
  }

  // Update configuration
  updateConfig(newConfig: Partial<LogConfig>): void {
    this.config = {
      ...this.config,
      ...LogConfigSchema.parse({ ...this.config, ...newConfig }),
    };

    this.logger.info('Gateway logger configuration updated', {
      updatedKeys: Object.keys(newConfig),
    });
  }

  // Private helper methods

  private initializeMetrics(): RequestMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
      slowRequests: 0,
      errorsByStatus: {},
      requestsByPath: {},
      requestsByUserAgent: {},
    };
  }

  private getClientIP(request: Request): string {
    const headers = request.headers;

    // Check common proxy headers
    const xForwardedFor = headers.get('x-forwarded-for');
    if (xForwardedFor) {
      return xForwardedFor.split(',')[0].trim();
    }

    const xRealIP = headers.get('x-real-ip');
    if (xRealIP) {
      return xRealIP;
    }

    const cfConnectingIP = headers.get('cf-connecting-ip');
    if (cfConnectingIP) {
      return cfConnectingIP;
    }

    return '127.0.0.1'; // Fallback
  }

  private sanitizeHeaders(headers: Headers): Record<string, string> {
    const sanitized: Record<string, string> = {};

    headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (this.config.sensitiveHeaders.includes(lowerKey)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    });

    return sanitized;
  }

  private shouldLogBody(request: Request): boolean {
    const method = request.method.toUpperCase();
    const contentType = request.headers.get('content-type') || '';

    // Only log body for certain methods and content types
    return (method === 'POST' || method === 'PUT' || method === 'PATCH') &&
           (contentType.includes('application/json') || contentType.includes('application/x-www-form-urlencoded'));
  }

  private getResponseSize(response: Response): number | undefined {
    const contentLength = response.headers.get('content-length');
    return contentLength ? parseInt(contentLength, 10) : undefined;
  }

  private getResponseLogLevel(status: number, duration: number): string {
    // Error status codes
    if (status >= 500) return 'error';
    if (status >= 400) return 'warn';

    // Slow requests
    if (duration >= this.config.slowRequestThreshold) return 'warn';

    // Success
    return 'info';
  }

  private cleanupOldContexts(): void {
    const now = Date.now();
    const maxAge = 300000; // 5 minutes

    for (const [requestId, context] of this.requestContexts.entries()) {
      if (now - context.startTime > maxAge) {
        this.logger.warn({ requestId }, 'Cleaning up orphaned request context');
        this.requestContexts.delete(requestId);
      }
    }
  }
}

// Utility function to create a gateway logger
export function createGatewayLogger(pinoLogger: any, config?: Partial<LogConfig>): GatewayLogger {
  return new GatewayLogger(pinoLogger, config);
}

// Helper function to extract user ID from request (e.g., JWT token)
export function extractUserIdFromRequest(request: Request): string | undefined {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return undefined;
  }

  try {
    // In a real implementation, you'd decode and validate the JWT
    // For now, we'll just extract from a custom header or return undefined
    const customUserId = request.headers.get('x-user-id');
    return customUserId || undefined;
  } catch (error) {
    return undefined;
  }
}

// Helper function to generate request correlation ID
export function generateRequestId(): string {
  return crypto.randomUUID();
}