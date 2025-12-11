import { z } from 'zod';

// Route configuration schema
export const RouteConfigSchema = z.object({
  target: z.string().url(),
  public: z.boolean().default(false),
  timeout: z.number().min(1000).default(30000), // 30 seconds default
  retries: z.number().min(0).max(5).default(1),
  healthCheck: z.string().optional(), // Health check path for this service
  loadBalancing: z.enum(['round-robin', 'least-connections', 'random']).default('round-robin'),
  circuitBreaker: z.object({
    enabled: z.boolean().default(true),
    failureThreshold: z.number().min(1).default(5),
    resetTimeout: z.number().min(1000).default(60000), // 1 minute
  }).optional(),
});

export type RouteConfig = z.infer<typeof RouteConfigSchema>;

// Service health status
export interface ServiceHealth {
  url: string;
  healthy: boolean;
  lastCheck: Date;
  responseTime: number;
  errors: number;
  circuitOpen: boolean;
}

// Route matching result
export interface RouteMatch {
  target: string;
  config: RouteConfig;
  params: Record<string, string>;
  remainingPath: string;
}

// Proxy response interface
export interface ProxyResponse {
  response: Response;
  duration: number;
  target: string;
  retries: number;
}

// Default routes based on GIG-119 specification
const DEFAULT_ROUTES: Record<string, RouteConfig> = {
  // Authentication service (public endpoints)
  '/auth': {
    target: 'http://auth-api:3001',
    public: true,
    timeout: 15000, // 15 seconds for auth
    retries: 2,
    healthCheck: '/health',
  },

  // Core API (private endpoints - users, attendance, friends)
  '/users': {
    target: 'http://core-api:3002',
    public: false,
    timeout: 30000,
    retries: 1,
    healthCheck: '/health',
  },
  '/attendance': {
    target: 'http://core-api:3002',
    public: false,
    timeout: 30000,
    retries: 1,
    healthCheck: '/health',
  },
  '/friends': {
    target: 'http://core-api:3002',
    public: false,
    timeout: 30000,
    retries: 1,
    healthCheck: '/health',
  },

  // Concert API (public endpoints - artists, venues, concerts)
  '/artists': {
    target: 'http://concert-api:3003',
    public: true,
    timeout: 30000,
    retries: 2,
    healthCheck: '/health',
  },
  '/venues': {
    target: 'http://concert-api:3003',
    public: true,
    timeout: 30000,
    retries: 2,
    healthCheck: '/health',
  },
  '/concerts': {
    target: 'http://concert-api:3003',
    public: true,
    timeout: 30000,
    retries: 2,
    healthCheck: '/health',
  },

  // Search API (public endpoint)
  '/search': {
    target: 'http://search-api:3004',
    public: true,
    timeout: 15000, // Faster timeout for search
    retries: 2,
    healthCheck: '/health',
  },
};

// Circuit breaker state
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: Date;
  state: 'closed' | 'open' | 'half-open';
}

// API Gateway Router
export class GatewayRouter {
  private routes: Record<string, RouteConfig>;
  private serviceHealth: Map<string, ServiceHealth>;
  private circuitBreakers: Map<string, CircuitBreakerState>;
  private logger: any;

  constructor(routes?: Record<string, RouteConfig>, logger?: any) {
    this.routes = routes || DEFAULT_ROUTES;
    this.serviceHealth = new Map();
    this.circuitBreakers = new Map();
    this.logger = logger;

    // Validate route configurations
    for (const [path, config] of Object.entries(this.routes)) {
      try {
        RouteConfigSchema.parse(config);
      } catch (error) {
        throw new Error(`Invalid route config for ${path}: ${error}`);
      }
    }

    // Initialize health monitoring
    this.initializeHealthMonitoring();
  }

  // Find matching route for request path
  findRoute(path: string): RouteMatch | null {
    // Remove query parameters and normalize path
    const normalizedPath = path.split('?')[0].replace(/\/+$/, '') || '/';

    // Try exact matches first
    if (this.routes[normalizedPath]) {
      return {
        target: this.routes[normalizedPath].target,
        config: this.routes[normalizedPath],
        params: {},
        remainingPath: '',
      };
    }

    // Try prefix matches (longest first)
    const sortedPaths = Object.keys(this.routes)
      .filter(routePath => normalizedPath.startsWith(routePath))
      .sort((a, b) => b.length - a.length);

    for (const routePath of sortedPaths) {
      const remainingPath = normalizedPath.slice(routePath.length);

      return {
        target: this.routes[routePath].target,
        config: this.routes[routePath],
        params: this.extractParams(routePath, normalizedPath),
        remainingPath,
      };
    }

    return null;
  }

  // Proxy request to target service
  async proxyRequest(
    request: Request,
    routeMatch: RouteMatch
  ): Promise<ProxyResponse> {
    const startTime = Date.now();
    const { target, config } = routeMatch;
    const url = new URL(request.url);

    // Check circuit breaker
    if (this.isCircuitOpen(target)) {
      this.logger?.warn('Circuit breaker open, rejecting request', { target });
      throw new Error('Service unavailable (circuit breaker open)');
    }

    // Construct target URL
    const targetURL = new URL(`${target}${url.pathname}${url.search}`);

    let lastError: Error | null = null;
    let retries = 0;

    // Retry logic
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      if (attempt > 0) {
        retries = attempt;
        this.logger?.debug('Retrying request', { target, attempt, maxRetries: config.retries });

        // Exponential backoff delay
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      try {
        // Create timeout controller
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeout);

        // Prepare headers (remove hop-by-hop headers)
        const proxyHeaders = this.prepareProxyHeaders(request.headers);

        // Make request to target service
        const response = await fetch(targetURL.toString(), {
          method: request.method,
          headers: proxyHeaders,
          body: request.body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Record successful request
        this.recordSuccess(target);

        const duration = Date.now() - startTime;

        this.logger?.debug('Request proxied successfully', {
          target,
          status: response.status,
          duration,
          retries,
        });

        return {
          response,
          duration,
          target,
          retries,
        };

      } catch (error) {
        lastError = error as Error;

        this.logger?.warn('Request failed', {
          target,
          attempt: attempt + 1,
          maxRetries: config.retries + 1,
          error: lastError.message,
        });

        // Record failure for circuit breaker
        this.recordFailure(target);

        // Don't retry if it's the last attempt
        if (attempt === config.retries) {
          break;
        }
      }
    }

    // All retries failed
    const duration = Date.now() - startTime;

    this.logger?.error('Request failed after all retries', {
      target,
      retries,
      duration,
      error: lastError?.message,
    });

    throw lastError || new Error('Request failed');
  }

  // Get service health status
  getServiceHealth(serviceUrl?: string): ServiceHealth | ServiceHealth[] {
    if (serviceUrl) {
      return this.serviceHealth.get(serviceUrl) || {
        url: serviceUrl,
        healthy: false,
        lastCheck: new Date(0),
        responseTime: 0,
        errors: 0,
        circuitOpen: this.isCircuitOpen(serviceUrl),
      };
    }

    return Array.from(this.serviceHealth.values());
  }

  // Update route configuration
  updateRoutes(newRoutes: Record<string, RouteConfig>): void {
    // Validate new routes
    for (const [path, config] of Object.entries(newRoutes)) {
      RouteConfigSchema.parse(config);
    }

    this.routes = { ...this.routes, ...newRoutes };

    this.logger?.info('Routes updated', {
      updatedPaths: Object.keys(newRoutes),
    });
  }

  // Get current route configuration
  getRoutes(): Record<string, RouteConfig> {
    return { ...this.routes };
  }

  // Get routing statistics
  getRoutingStats(): {
    totalRoutes: number;
    healthyServices: number;
    unhealthyServices: number;
    circuitBreakersOpen: number;
    routes: Array<{
      path: string;
      target: string;
      public: boolean;
      healthy: boolean;
      circuitOpen: boolean;
    }>;
  } {
    const routes = Object.entries(this.routes).map(([path, config]) => {
      const health = this.serviceHealth.get(config.target);
      return {
        path,
        target: config.target,
        public: config.public,
        healthy: health?.healthy || false,
        circuitOpen: this.isCircuitOpen(config.target),
      };
    });

    return {
      totalRoutes: routes.length,
      healthyServices: routes.filter(r => r.healthy).length,
      unhealthyServices: routes.filter(r => !r.healthy).length,
      circuitBreakersOpen: routes.filter(r => r.circuitOpen).length,
      routes,
    };
  }

  // Private helper methods

  private extractParams(routePath: string, actualPath: string): Record<string, string> {
    // Simple param extraction - can be enhanced for complex routing
    const params: Record<string, string> = {};

    // Handle path parameters like /users/:id
    const routeParts = routePath.split('/');
    const actualParts = actualPath.split('/');

    for (let i = 0; i < routeParts.length; i++) {
      const routePart = routeParts[i];
      const actualPart = actualParts[i];

      if (routePart && routePart.startsWith(':') && actualPart) {
        const paramName = routePart.slice(1);
        params[paramName] = actualPart;
      }
    }

    return params;
  }

  private prepareProxyHeaders(headers: Headers): Record<string, string> {
    const proxyHeaders: Record<string, string> = {};

    // Copy headers but exclude hop-by-hop headers
    const excludedHeaders = new Set([
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailers',
      'transfer-encoding',
      'upgrade',
      'host', // Will be set automatically by fetch
    ]);

    headers.forEach((value, key) => {
      if (!excludedHeaders.has(key.toLowerCase())) {
        proxyHeaders[key] = value;
      }
    });

    // Add gateway identification
    proxyHeaders['X-Forwarded-By'] = 'Gigz-Gateway/1.0';
    proxyHeaders['X-Gateway-Request-ID'] = crypto.randomUUID();

    return proxyHeaders;
  }

  private isCircuitOpen(serviceUrl: string): boolean {
    const circuitBreaker = this.circuitBreakers.get(serviceUrl);

    if (!circuitBreaker || circuitBreaker.state === 'closed') {
      return false;
    }

    if (circuitBreaker.state === 'open') {
      // Check if enough time has passed to try again (half-open)
      const timeSinceLastFailure = Date.now() - circuitBreaker.lastFailureTime.getTime();
      const resetTimeout = this.getCircuitBreakerConfig(serviceUrl)?.resetTimeout || 60000;

      if (timeSinceLastFailure >= resetTimeout) {
        circuitBreaker.state = 'half-open';
        this.logger?.info('Circuit breaker half-open', { serviceUrl });
        return false;
      }
      return true;
    }

    return false; // half-open state allows requests
  }

  private recordSuccess(serviceUrl: string): void {
    // Reset circuit breaker on success
    const circuitBreaker = this.circuitBreakers.get(serviceUrl);
    if (circuitBreaker) {
      if (circuitBreaker.state === 'half-open') {
        circuitBreaker.state = 'closed';
        circuitBreaker.failures = 0;
        this.logger?.info('Circuit breaker closed', { serviceUrl });
      }
    }

    // Update health status
    const health = this.serviceHealth.get(serviceUrl);
    if (health) {
      health.healthy = true;
      health.errors = Math.max(0, health.errors - 1);
    }
  }

  private recordFailure(serviceUrl: string): void {
    // Update circuit breaker
    let circuitBreaker = this.circuitBreakers.get(serviceUrl);
    if (!circuitBreaker) {
      circuitBreaker = {
        failures: 0,
        lastFailureTime: new Date(),
        state: 'closed',
      };
      this.circuitBreakers.set(serviceUrl, circuitBreaker);
    }

    circuitBreaker.failures++;
    circuitBreaker.lastFailureTime = new Date();

    const config = this.getCircuitBreakerConfig(serviceUrl);
    if (config && circuitBreaker.failures >= config.failureThreshold) {
      circuitBreaker.state = 'open';
      this.logger?.warn('Circuit breaker opened', {
        serviceUrl,
        failures: circuitBreaker.failures,
        threshold: config.failureThreshold,
      });
    }

    // Update health status
    const health = this.serviceHealth.get(serviceUrl);
    if (health) {
      health.healthy = false;
      health.errors++;
    }
  }

  private getCircuitBreakerConfig(serviceUrl: string) {
    for (const config of Object.values(this.routes)) {
      if (config.target === serviceUrl) {
        return config.circuitBreaker;
      }
    }
    return null;
  }

  private initializeHealthMonitoring(): void {
    // Initialize health status for all services
    const uniqueTargets = new Set(
      Object.values(this.routes).map(config => config.target)
    );

    for (const target of uniqueTargets) {
      this.serviceHealth.set(target, {
        url: target,
        healthy: true,
        lastCheck: new Date(),
        responseTime: 0,
        errors: 0,
        circuitOpen: false,
      });
    }

    // Start periodic health checks (every 30 seconds)
    setInterval(() => {
      this.performHealthChecks();
    }, 30000);
  }

  private async performHealthChecks(): Promise<void> {
    const healthPromises = Array.from(this.serviceHealth.keys()).map(async (serviceUrl) => {
      try {
        const route = Object.values(this.routes).find(r => r.target === serviceUrl);
        if (!route?.healthCheck) {
          return; // Skip health check if not configured
        }

        const healthUrl = `${serviceUrl}${route.healthCheck}`;
        const startTime = Date.now();

        const response = await fetch(healthUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(5000), // 5 second timeout for health checks
        });

        const responseTime = Date.now() - startTime;
        const health = this.serviceHealth.get(serviceUrl)!;

        health.healthy = response.ok;
        health.lastCheck = new Date();
        health.responseTime = responseTime;
        health.circuitOpen = this.isCircuitOpen(serviceUrl);

        if (!response.ok) {
          health.errors++;
        }

      } catch (error) {
        const health = this.serviceHealth.get(serviceUrl)!;
        health.healthy = false;
        health.lastCheck = new Date();
        health.errors++;
        health.circuitOpen = this.isCircuitOpen(serviceUrl);

        this.logger?.debug('Health check failed', {
          serviceUrl,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    await Promise.allSettled(healthPromises);
  }
}