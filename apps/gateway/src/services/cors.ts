import { z } from 'zod';

// CORS configuration schema
export const CorsConfigSchema = z.object({
  origins: z.array(z.string()),
  methods: z.array(z.string()),
  allowedHeaders: z.array(z.string()),
  exposedHeaders: z.array(z.string()).optional(),
  credentials: z.boolean().default(true),
  maxAge: z.number().default(86400), // 24 hours
  preflightContinue: z.boolean().default(false),
  optionsSuccessStatus: z.number().default(204),
});

export type CorsConfig = z.infer<typeof CorsConfigSchema>;

// Default CORS configuration optimized for iOS app
const DEFAULT_CORS_CONFIG: CorsConfig = {
  origins: [
    // Local development
    'http://localhost:3000',
    'http://127.0.0.1:3000',

    // iOS app (custom scheme)
    'gigz://app',

    // Production domains (to be updated)
    'https://gigz.app',
    'https://api.gigz.app',

    // Development/staging domains
    'https://dev.gigz.app',
    'https://staging.gigz.app',
  ],
  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
    'HEAD',
  ],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'User-Agent',
    'Cache-Control',
    'Pragma',
    'X-Gigz-Version', // Custom app version header
    'X-Gigz-Platform', // iOS/Android identifier
    'X-Gigz-Build', // Build number
  ],
  exposedHeaders: [
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-Total-Count', // For pagination
    'X-Request-ID', // For request tracing
  ],
  credentials: true,
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

// CORS handler for API Gateway
export class CorsHandler {
  private config: CorsConfig;
  private logger: any;

  constructor(config?: Partial<CorsConfig>, logger?: any) {
    this.config = {
      ...DEFAULT_CORS_CONFIG,
      ...config,
    };
    this.logger = logger;

    // Validate configuration
    CorsConfigSchema.parse(this.config);
  }

  // Handle CORS preflight requests (OPTIONS method)
  async handlePreflight(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    const method = request.headers.get('access-control-request-method');
    const headers = request.headers.get('access-control-request-headers');

    this.logger?.debug('CORS preflight request', {
      origin,
      method,
      headers,
    });

    // Check if origin is allowed
    if (!this.isOriginAllowed(origin)) {
      this.logger?.warn('CORS preflight rejected: origin not allowed', { origin });
      return new Response(null, {
        status: 403,
        statusText: 'Forbidden (CORS)',
      });
    }

    // Check if method is allowed
    if (method && !this.config.methods.includes(method)) {
      this.logger?.warn('CORS preflight rejected: method not allowed', { method });
      return new Response(null, {
        status: 405,
        statusText: 'Method Not Allowed (CORS)',
      });
    }

    // Build preflight response headers
    const responseHeaders = new Headers();

    // Set allowed origin
    responseHeaders.set('Access-Control-Allow-Origin', origin || '*');

    // Set allowed methods
    responseHeaders.set('Access-Control-Allow-Methods', this.config.methods.join(', '));

    // Set allowed headers
    if (headers) {
      const requestedHeaders = headers.split(',').map(h => h.trim());
      const allowedRequestedHeaders = requestedHeaders.filter(h =>
        this.config.allowedHeaders.some(allowed =>
          allowed.toLowerCase() === h.toLowerCase()
        )
      );

      if (allowedRequestedHeaders.length > 0) {
        responseHeaders.set('Access-Control-Allow-Headers', allowedRequestedHeaders.join(', '));
      }
    } else {
      responseHeaders.set('Access-Control-Allow-Headers', this.config.allowedHeaders.join(', '));
    }

    // Set credentials
    if (this.config.credentials) {
      responseHeaders.set('Access-Control-Allow-Credentials', 'true');
    }

    // Set max age
    responseHeaders.set('Access-Control-Max-Age', String(this.config.maxAge));

    // Set cache headers for preflight response
    responseHeaders.set('Cache-Control', `max-age=${this.config.maxAge}`);
    responseHeaders.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');

    this.logger?.debug('CORS preflight response sent', {
      origin,
      allowedMethods: this.config.methods.join(', '),
      maxAge: this.config.maxAge,
    });

    return new Response(null, {
      status: this.config.optionsSuccessStatus,
      headers: responseHeaders,
    });
  }

  // Add CORS headers to actual response
  addCorsHeaders(request: Request, response: Response): Response {
    const origin = request.headers.get('origin');

    // Check if origin is allowed
    if (!this.isOriginAllowed(origin)) {
      this.logger?.warn('CORS response blocked: origin not allowed', { origin });
      return response; // Return response without CORS headers
    }

    // Clone response to add headers
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });

    const headers = newResponse.headers;

    // Set allowed origin
    headers.set('Access-Control-Allow-Origin', origin || '*');

    // Set credentials
    if (this.config.credentials) {
      headers.set('Access-Control-Allow-Credentials', 'true');
    }

    // Set exposed headers
    if (this.config.exposedHeaders && this.config.exposedHeaders.length > 0) {
      headers.set('Access-Control-Expose-Headers', this.config.exposedHeaders.join(', '));
    }

    // Add Vary header for caching
    const existingVary = headers.get('Vary');
    const varyHeaders = existingVary ? `${existingVary}, Origin` : 'Origin';
    headers.set('Vary', varyHeaders);

    this.logger?.debug('CORS headers added to response', {
      origin,
      exposedHeaders: this.config.exposedHeaders?.join(', '),
    });

    return newResponse;
  }

  // Check if origin is allowed
  private isOriginAllowed(origin: string | null): boolean {
    if (!origin) {
      // Allow requests without origin (e.g., same-origin, mobile apps)
      return true;
    }

    // Check exact matches
    if (this.config.origins.includes(origin)) {
      return true;
    }

    // Check wildcard patterns
    for (const allowedOrigin of this.config.origins) {
      if (allowedOrigin === '*') {
        return true;
      }

      // Check subdomain patterns (e.g., *.gigz.app)
      if (allowedOrigin.startsWith('*.')) {
        const domain = allowedOrigin.slice(2);
        if (origin.endsWith(`.${domain}`) || origin === domain) {
          return true;
        }
      }

      // Check protocol-relative patterns
      if (allowedOrigin.startsWith('//')) {
        const pattern = allowedOrigin.slice(2);
        if (origin.endsWith(pattern)) {
          return true;
        }
      }
    }

    return false;
  }

  // Update CORS configuration
  updateConfig(newConfig: Partial<CorsConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };

    // Validate updated configuration
    CorsConfigSchema.parse(this.config);

    this.logger?.info('CORS configuration updated', {
      updatedKeys: Object.keys(newConfig),
    });
  }

  // Get current CORS configuration
  getConfig(): CorsConfig {
    return { ...this.config };
  }

  // Get CORS information for monitoring/debugging
  getCorsInfo(request: Request): {
    origin: string | null;
    isOriginAllowed: boolean;
    isPreflight: boolean;
    requestedMethod?: string | null;
    requestedHeaders?: string | null;
  } {
    const origin = request.headers.get('origin');
    const isPreflight = request.method === 'OPTIONS' &&
                       request.headers.has('access-control-request-method');

    return {
      origin,
      isOriginAllowed: this.isOriginAllowed(origin),
      isPreflight,
      requestedMethod: isPreflight ? request.headers.get('access-control-request-method') : undefined,
      requestedHeaders: isPreflight ? request.headers.get('access-control-request-headers') : undefined,
    };
  }
}

// Utility function to create a CORS handler with default settings
export function createCorsHandler(config?: Partial<CorsConfig>, logger?: any): CorsHandler {
  return new CorsHandler(config, logger);
}

// Helper function to check if request is a CORS preflight
export function isPreflightRequest(request: Request): boolean {
  return request.method === 'OPTIONS' &&
         request.headers.has('access-control-request-method');
}

// Helper function to get CORS error response
export function createCorsErrorResponse(message: string, status: number = 403): Response {
  return new Response(JSON.stringify({
    error: 'CORS Error',
    message,
    code: 'CORS_BLOCKED',
  }), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}