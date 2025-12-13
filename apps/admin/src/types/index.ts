export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'super_admin';
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  status: 'active' | 'suspended' | 'deleted';
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  _count?: {
    attendances: number;
    friends: number;
  };
}

export interface Concert {
  id: string;
  title?: string;
  date: string;
  description?: string;
  status: 'verified' | 'unmatched' | 'duplicate' | 'pending';
  createdAt: string;
  updatedAt: string;
  artist?: {
    id: string;
    name: string;
  };
  venue?: {
    id: string;
    name: string;
    city?: string;
    country?: string;
  };
  _count?: {
    attendances: number;
  };
  duplicates?: Concert[];
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface Queue {
  name: string;
  description?: string;
  isPaused: boolean;
  stats: QueueStats;
  recentJobs?: Job[];
}

export interface Job {
  id: string;
  name: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  timestamp: string;
  processedOn?: string;
  finishedOn?: string;
  failedReason?: string;
  data?: any;
  returnvalue?: any;
  attemptsMade: number;
  opts?: {
    attempts?: number;
    delay?: number;
    priority?: number;
  };
}

export interface DashboardStats {
  users: {
    total: number;
    active: number;
    suspended: number;
    monthlyGrowth: number;
  };
  concerts: {
    total: number;
    verified: number;
    unmatched: number;
    duplicates: number;
  };
  queues: {
    total: number;
    active: number;
    pending: number;
    failed: number;
  };
  health: {
    [service: string]: {
      healthy: boolean;
      latency?: number;
      lastCheck: string;
    };
  };
  recentActivity: {
    users: User[];
    concerts: Concert[];
  };
}