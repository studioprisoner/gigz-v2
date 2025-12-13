import React from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatNumber, formatDate } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Activity,
  Users
} from 'lucide-react';

export function QueueDetailPage() {
  const { queueName } = useParams({ from: '/_authenticated/queues/$queueName' });

  const { data: queueData, isLoading, refetch } = trpc.getQueueDetails.useQuery({
    queueName: queueName as string
  });

  const toggleQueueMutation = trpc.toggleQueueStatus.useMutation({
    onSuccess: () => refetch(),
  });

  const clearQueueMutation = trpc.clearQueue.useMutation({
    onSuccess: () => refetch(),
  });

  const handleAction = async (action: string, params?: any) => {
    try {
      switch (action) {
        case 'pause':
          await toggleQueueMutation.mutateAsync({ queueName: params.queueName, action: 'pause' });
          break;
        case 'resume':
          await toggleQueueMutation.mutateAsync({ queueName: params.queueName, action: 'resume' });
          break;
        case 'clear-completed':
          await clearQueueMutation.mutateAsync({ queueName: params.queueName, jobType: 'completed' });
          break;
        case 'clear-failed':
          await clearQueueMutation.mutateAsync({ queueName: params.queueName, jobType: 'failed' });
          break;
        case 'retry-failed':
          await clearQueueMutation.mutateAsync({ queueName: params.queueName, jobType: 'failed' });
          break;
        case 'refresh':
          refetch();
          break;
        default:
          console.log(`Action ${action} not implemented yet`);
      }
    } catch (error) {
      console.error(`Failed to ${action}:`, error);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          <div className="h-8 bg-gray-200 rounded w-8"></div>
          <div className="h-6 bg-gray-200 rounded w-48"></div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
                  <div className="h-8 bg-gray-200 rounded w-1/2"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link to="/queues">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Queues
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white capitalize">
              {queueData?.name || queueName} Queue
            </h1>
            <div className="flex items-center space-x-2 mt-2">
              <Badge variant={queueData?.status === 'active' ? 'default' : 'secondary'}>
                {queueData?.status || 'unknown'}
              </Badge>
              <span className="text-sm text-gray-500">
                {queueData?.workers || 0} workers • Last activity: {queueData?.lastActivity ? formatDate(queueData.lastActivity) : 'Never'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            onClick={() => handleAction('refresh')}
            variant="outline"
            size="sm"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {queueData?.status === 'paused' ? (
            <Button
              onClick={() => handleAction('resume', { queueName: queueData?.name || queueName })}
              size="sm"
            >
              <Play className="h-4 w-4 mr-2" />
              Resume
            </Button>
          ) : (
            <Button
              onClick={() => handleAction('pause', { queueName: queueData?.name || queueName })}
              variant="outline"
              size="sm"
            >
              <Pause className="h-4 w-4 mr-2" />
              Pause
            </Button>
          )}
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">
              {formatNumber(queueData?.stats?.waiting || 0)}
            </div>
            <div className="text-sm text-gray-500">Waiting</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-yellow-600">
              {formatNumber(queueData?.stats?.active || 0)}
            </div>
            <div className="text-sm text-gray-500">Active</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-600">
              {formatNumber(queueData?.stats?.completed || 0)}
            </div>
            <div className="text-sm text-gray-500">Completed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-red-600">
              {formatNumber(queueData?.stats?.failed || 0)}
            </div>
            <div className="text-sm text-gray-500">Failed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-purple-600">
              {formatNumber(queueData?.stats?.delayed || 0)}
            </div>
            <div className="text-sm text-gray-500">Delayed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-gray-600">
              {formatNumber(queueData?.stats?.paused || 0)}
            </div>
            <div className="text-sm text-gray-500">Paused</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Jobs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Jobs</CardTitle>
            <CardDescription>
              Latest jobs processed by this queue
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {queueData?.recentJobs?.length > 0 ? queueData.recentJobs.map((job: any) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    {job.status === 'completed' && (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    )}
                    {job.status === 'failed' && (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                    {job.status === 'active' && (
                      <Activity className="h-5 w-5 text-yellow-500" />
                    )}
                    {job.status === 'waiting' && (
                      <Clock className="h-5 w-5 text-blue-500" />
                    )}

                    <div className="flex-1">
                      <div className="font-medium text-sm">{job.name}</div>
                      <div className="text-xs text-gray-500">
                        {job.status === 'completed' && `Completed ${formatDate(job.processedOn)} (${job.duration}ms)`}
                        {job.status === 'active' && `Started ${formatDate(job.startedAt)}`}
                        {job.status === 'failed' && `Failed ${formatDate(job.failedAt)} (${job.attempts} attempts)`}
                        {job.status === 'waiting' && `Scheduled for ${formatDate(job.scheduledFor)}`}
                      </div>
                      {job.error && (
                        <div className="text-xs text-red-600 mt-1">
                          Error: {job.error}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {job.status === 'failed' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleAction('retry-job', { queueName: queueData?.name || queueName, jobId: job.id })}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {job.id}
                    </Badge>
                  </div>
                </div>
              )) : (
                <div className="text-center py-8 text-gray-500">
                  No recent jobs available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Queue Configuration</CardTitle>
            <CardDescription>
              Current settings and limits
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
                <span className="text-sm font-medium">Concurrency</span>
                <span className="text-sm text-gray-600">{queueData?.configuration?.concurrency || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
                <span className="text-sm font-medium">Retry Attempts</span>
                <span className="text-sm text-gray-600">{queueData?.configuration?.retryAttempts || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
                <span className="text-sm font-medium">Retry Delay</span>
                <span className="text-sm text-gray-600">{queueData?.configuration?.retryDelay || 'N/A'}ms</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
                <span className="text-sm font-medium">Timeout</span>
                <span className="text-sm text-gray-600">{queueData?.configuration?.timeout || 'N/A'}ms</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-medium">Priority</span>
                <Badge variant={queueData?.configuration?.priority === 'high' ? 'default' : 'secondary'}>
                  {queueData?.configuration?.priority || 'normal'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Queue Actions</CardTitle>
          <CardDescription>
            Manage and maintain this queue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => handleAction('clear-completed', { queueName: queueData?.name || queueName })}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Completed
            </Button>
            <Button
              variant="outline"
              onClick={() => handleAction('retry-failed', { queueName: queueData?.name || queueName })}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Retry Failed Jobs
            </Button>
            <Button
              variant="outline"
              onClick={() => handleAction('clear-failed', { queueName: queueData?.name || queueName })}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Failed Jobs
            </Button>
            {(queueData?.stats?.delayed || 0) > 0 && (
              <Button
                variant="outline"
                onClick={() => handleAction('promote-delayed', { queueName: queueData?.name || queueName })}
              >
                <Clock className="h-4 w-4 mr-2" />
                Promote Delayed Jobs
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}