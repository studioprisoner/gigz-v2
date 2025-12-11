import { z } from 'zod';

// Metric types
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  TIMER = 'timer',
}

// Metric data point
export interface MetricDataPoint {
  timestamp: Date;
  value: number;
  labels?: Record<string, string>;
}

// Metric definition
export interface Metric {
  name: string;
  type: MetricType;
  description: string;
  unit?: string;
  dataPoints: MetricDataPoint[];
  labels?: string[];
}

// Aggregated metric values
export interface MetricAggregates {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  latest: number;
  percentiles?: {
    p50: number;
    p95: number;
    p99: number;
  };
}

// Scraper performance metrics
export interface ScraperMetrics {
  jobsProcessed: number;
  jobsSucceeded: number;
  jobsFailed: number;
  concertsScraped: number;
  concertsStored: number;
  artistsCreated: number;
  venuesCreated: number;
  apiRequestsMade: number;
  apiRequestsFailed: number;
  averageJobDuration: number;
  averageApiResponseTime: number;
  rateLimitHits: number;
  errorsTotal: number;
}

// Metrics collection and aggregation service
export class MetricsService {
  private metrics: Map<string, Metric> = new Map();
  private logger: any;
  private maxDataPoints = 10000; // Keep last 10k data points per metric

  constructor(logger: any) {
    this.logger = logger;
    this.initializeDefaultMetrics();
  }

  // Initialize default metrics for scraper worker
  private initializeDefaultMetrics(): void {
    // Job metrics
    this.createMetric('jobs_total', MetricType.COUNTER, 'Total number of jobs processed', 'count');
    this.createMetric('jobs_succeeded', MetricType.COUNTER, 'Number of jobs that succeeded', 'count');
    this.createMetric('jobs_failed', MetricType.COUNTER, 'Number of jobs that failed', 'count');
    this.createMetric('job_duration', MetricType.HISTOGRAM, 'Job processing duration', 'ms');

    // Scraping metrics
    this.createMetric('concerts_scraped', MetricType.COUNTER, 'Total concerts scraped from external sources', 'count');
    this.createMetric('concerts_stored', MetricType.COUNTER, 'Total concerts stored in database', 'count');
    this.createMetric('artists_created', MetricType.COUNTER, 'New artists created', 'count');
    this.createMetric('venues_created', MetricType.COUNTER, 'New venues created', 'count');

    // API metrics
    this.createMetric('api_requests', MetricType.COUNTER, 'API requests made to external services', 'count');
    this.createMetric('api_requests_failed', MetricType.COUNTER, 'Failed API requests', 'count');
    this.createMetric('api_response_time', MetricType.HISTOGRAM, 'API response time', 'ms');
    this.createMetric('rate_limit_hits', MetricType.COUNTER, 'Number of rate limit hits', 'count');

    // Error metrics
    this.createMetric('errors_total', MetricType.COUNTER, 'Total number of errors', 'count');

    // Queue metrics
    this.createMetric('queue_size', MetricType.GAUGE, 'Current queue size', 'count');
    this.createMetric('queue_pending', MetricType.GAUGE, 'Pending jobs in queue', 'count');
    this.createMetric('queue_active', MetricType.GAUGE, 'Active jobs being processed', 'count');

    // Database metrics
    this.createMetric('db_insert_duration', MetricType.HISTOGRAM, 'Database insert operation duration', 'ms');
    this.createMetric('db_query_duration', MetricType.HISTOGRAM, 'Database query duration', 'ms');
    this.createMetric('db_errors', MetricType.COUNTER, 'Database operation errors', 'count');

    this.logger.info('Default metrics initialized');
  }

  // Create a new metric
  createMetric(
    name: string,
    type: MetricType,
    description: string,
    unit?: string,
    labels?: string[]
  ): void {
    if (this.metrics.has(name)) {
      this.logger.warn(`Metric ${name} already exists`);
      return;
    }

    const metric: Metric = {
      name,
      type,
      description,
      unit,
      dataPoints: [],
      labels,
    };

    this.metrics.set(name, metric);
    this.logger.debug(`Created metric: ${name}`, { type, description, unit });
  }

  // Record a metric value
  record(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric) {
      this.logger.warn(`Metric ${name} not found`);
      return;
    }

    const dataPoint: MetricDataPoint = {
      timestamp: new Date(),
      value,
      labels,
    };

    metric.dataPoints.push(dataPoint);

    // Rotate old data points to prevent memory bloat
    if (metric.dataPoints.length > this.maxDataPoints) {
      metric.dataPoints = metric.dataPoints.slice(-this.maxDataPoints);
    }

    this.logger.debug(`Recorded metric: ${name}=${value}`, labels);
  }

  // Increment a counter metric
  increment(name: string, amount: number = 1, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== MetricType.COUNTER) {
      this.logger.warn(`Counter metric ${name} not found`);
      return;
    }

    this.record(name, amount, labels);
  }

  // Set a gauge metric
  gauge(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== MetricType.GAUGE) {
      this.logger.warn(`Gauge metric ${name} not found`);
      return;
    }

    this.record(name, value, labels);
  }

  // Record a histogram value
  histogram(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== MetricType.HISTOGRAM) {
      this.logger.warn(`Histogram metric ${name} not found`);
      return;
    }

    this.record(name, value, labels);
  }

  // Time a function execution and record the duration
  async timer<T>(
    name: string,
    fn: () => Promise<T>,
    labels?: Record<string, string>
  ): Promise<T> {
    const start = Date.now();

    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.histogram(name, duration, labels);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.histogram(name, duration, { ...labels, error: 'true' });
      throw error;
    }
  }

  // Get aggregated values for a metric
  getAggregates(name: string, timeWindow?: { start: Date; end: Date }): MetricAggregates | null {
    const metric = this.metrics.get(name);
    if (!metric) {
      return null;
    }

    let dataPoints = metric.dataPoints;

    // Filter by time window if provided
    if (timeWindow) {
      dataPoints = dataPoints.filter(
        dp => dp.timestamp >= timeWindow.start && dp.timestamp <= timeWindow.end
      );
    }

    if (dataPoints.length === 0) {
      return {
        count: 0,
        sum: 0,
        min: 0,
        max: 0,
        avg: 0,
        latest: 0,
      };
    }

    const values = dataPoints.map(dp => dp.value);
    const sum = values.reduce((acc, val) => acc + val, 0);
    const count = values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = sum / count;
    const latest = dataPoints[dataPoints.length - 1].value;

    const aggregates: MetricAggregates = {
      count,
      sum,
      min,
      max,
      avg,
      latest,
    };

    // Calculate percentiles for histograms
    if (metric.type === MetricType.HISTOGRAM) {
      const sortedValues = values.sort((a, b) => a - b);
      aggregates.percentiles = {
        p50: this.percentile(sortedValues, 0.5),
        p95: this.percentile(sortedValues, 0.95),
        p99: this.percentile(sortedValues, 0.99),
      };
    }

    return aggregates;
  }

  // Calculate percentile
  private percentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;

    const index = Math.floor(sortedValues.length * percentile);
    return sortedValues[Math.min(index, sortedValues.length - 1)];
  }

  // Get current scraper metrics summary
  getScraperMetrics(timeWindow?: { start: Date; end: Date }): ScraperMetrics {
    const getSum = (name: string) => {
      const agg = this.getAggregates(name, timeWindow);
      return agg ? agg.sum : 0;
    };

    const getAvg = (name: string) => {
      const agg = this.getAggregates(name, timeWindow);
      return agg ? agg.avg : 0;
    };

    return {
      jobsProcessed: getSum('jobs_total'),
      jobsSucceeded: getSum('jobs_succeeded'),
      jobsFailed: getSum('jobs_failed'),
      concertsScraped: getSum('concerts_scraped'),
      concertsStored: getSum('concerts_stored'),
      artistsCreated: getSum('artists_created'),
      venuesCreated: getSum('venues_created'),
      apiRequestsMade: getSum('api_requests'),
      apiRequestsFailed: getSum('api_requests_failed'),
      averageJobDuration: getAvg('job_duration'),
      averageApiResponseTime: getAvg('api_response_time'),
      rateLimitHits: getSum('rate_limit_hits'),
      errorsTotal: getSum('errors_total'),
    };
  }

  // Get all metrics with their current values
  getAllMetrics(): Record<string, MetricAggregates> {
    const result: Record<string, MetricAggregates> = {};

    for (const [name, _] of this.metrics) {
      const aggregates = this.getAggregates(name);
      if (aggregates) {
        result[name] = aggregates;
      }
    }

    return result;
  }

  // Get metric definition
  getMetricDefinition(name: string): Metric | null {
    return this.metrics.get(name) || null;
  }

  // Get all metric definitions
  getAllMetricDefinitions(): Metric[] {
    return Array.from(this.metrics.values());
  }

  // Export metrics in Prometheus format (simplified)
  exportPrometheus(): string {
    const lines: string[] = [];

    for (const [name, metric] of this.metrics) {
      // Add help comment
      lines.push(`# HELP ${name} ${metric.description}`);
      lines.push(`# TYPE ${name} ${this.getPrometheusType(metric.type)}`);

      const aggregates = this.getAggregates(name);
      if (!aggregates) continue;

      switch (metric.type) {
        case MetricType.COUNTER:
        case MetricType.GAUGE:
          lines.push(`${name} ${aggregates.latest}`);
          break;

        case MetricType.HISTOGRAM:
          if (aggregates.percentiles) {
            lines.push(`${name}_sum ${aggregates.sum}`);
            lines.push(`${name}_count ${aggregates.count}`);
            lines.push(`${name}_bucket{le="0.5"} ${aggregates.percentiles.p50}`);
            lines.push(`${name}_bucket{le="0.95"} ${aggregates.percentiles.p95}`);
            lines.push(`${name}_bucket{le="0.99"} ${aggregates.percentiles.p99}`);
          }
          break;
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  // Convert metric type to Prometheus type
  private getPrometheusType(type: MetricType): string {
    switch (type) {
      case MetricType.COUNTER:
        return 'counter';
      case MetricType.GAUGE:
        return 'gauge';
      case MetricType.HISTOGRAM:
      case MetricType.TIMER:
        return 'histogram';
      default:
        return 'gauge';
    }
  }

  // Reset all metrics
  resetAllMetrics(): void {
    for (const metric of this.metrics.values()) {
      metric.dataPoints = [];
    }
    this.logger.info('All metrics reset');
  }

  // Reset a specific metric
  resetMetric(name: string): void {
    const metric = this.metrics.get(name);
    if (metric) {
      metric.dataPoints = [];
      this.logger.info(`Metric ${name} reset`);
    }
  }

  // Clean old data points (older than specified age)
  cleanOldDataPoints(maxAgeMs: number): void {
    const cutoff = new Date(Date.now() - maxAgeMs);
    let totalCleaned = 0;

    for (const metric of this.metrics.values()) {
      const originalLength = metric.dataPoints.length;
      metric.dataPoints = metric.dataPoints.filter(dp => dp.timestamp > cutoff);
      totalCleaned += originalLength - metric.dataPoints.length;
    }

    if (totalCleaned > 0) {
      this.logger.info(`Cleaned ${totalCleaned} old data points`);
    }
  }

  // Record job metrics
  recordJobStart(source: string, type: string): void {
    this.increment('jobs_total', 1, { source, type });
  }

  recordJobSuccess(source: string, type: string, duration: number): void {
    this.increment('jobs_succeeded', 1, { source, type });
    this.histogram('job_duration', duration, { source, type, status: 'success' });
  }

  recordJobFailure(source: string, type: string, duration: number, error: string): void {
    this.increment('jobs_failed', 1, { source, type, error });
    this.histogram('job_duration', duration, { source, type, status: 'failed' });
  }

  // Record scraping metrics
  recordConcertsScraped(source: string, count: number): void {
    this.increment('concerts_scraped', count, { source });
  }

  recordConcertsStored(count: number): void {
    this.increment('concerts_stored', count);
  }

  recordEntitiesCreated(artists: number, venues: number): void {
    this.increment('artists_created', artists);
    this.increment('venues_created', venues);
  }

  // Record API metrics
  recordApiRequest(source: string, endpoint: string, duration: number, success: boolean): void {
    this.increment('api_requests', 1, { source, endpoint });

    if (!success) {
      this.increment('api_requests_failed', 1, { source, endpoint });
    }

    this.histogram('api_response_time', duration, { source, endpoint, success: success.toString() });
  }

  recordRateLimitHit(source: string): void {
    this.increment('rate_limit_hits', 1, { source });
  }

  // Record database metrics
  recordDatabaseOperation(operation: string, duration: number, success: boolean): void {
    if (operation.toLowerCase().includes('insert')) {
      this.histogram('db_insert_duration', duration, { success: success.toString() });
    } else {
      this.histogram('db_query_duration', duration, { success: success.toString() });
    }

    if (!success) {
      this.increment('db_errors', 1, { operation });
    }
  }

  // Record error
  recordError(source: string, category: string, severity: string): void {
    this.increment('errors_total', 1, { source, category, severity });
  }

  // Update queue metrics
  updateQueueMetrics(size: number, pending: number, active: number): void {
    this.gauge('queue_size', size);
    this.gauge('queue_pending', pending);
    this.gauge('queue_active', active);
  }
}