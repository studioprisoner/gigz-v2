import React from 'react';
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatNumber, formatDate } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import {
  Play,
  Pause,
  RotateCcw,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  ExternalLink
} from 'lucide-react';

export function QueuesPage() {
  const { data: queuesData, isLoading, refetch } = trpc.listQueues.useQuery();

  const pauseQueueMutation = trpc.toggleQueueStatus.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const resumeQueueMutation = trpc.toggleQueueStatus.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const cleanQueueMutation = trpc.clearQueue.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const handlePauseQueue = async (queueName: string) => {
    await pauseQueueMutation.mutateAsync({
      queueName,
      action: 'pause',
    });
  };

  const handleResumeQueue = async (queueName: string) => {
    await resumeQueueMutation.mutateAsync({
      queueName,
      action: 'resume',
    });
  };

  const handleRetryJob = async (queueName: string, jobId: string) => {
    // TODO: Implement retry specific job functionality
    console.log('Retry job:', queueName, jobId);
  };

  const handleCleanQueue = async (queueName: string) => {
    if (confirm('Are you sure you want to clean completed and failed jobs from this queue?')) {
      await cleanQueueMutation.mutateAsync({
        queueName,
        jobType: 'completed',
      });
    }
  };

  const queues = queuesData?.queues || [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Queue Management</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Monitor and manage background job queues
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
                  <div className="h-8 bg-gray-200 rounded w-1/2 mb-4"></div>
                  <div className="space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-full"></div>
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  </div>
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Queue Management</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Monitor and manage background job queues
          </p>
        </div>
        <Button
          onClick={() => refetch()}
          disabled={isLoading}
          variant="outline"
          size="sm"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Queue Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {queues?.map((queue: any) => (
          <Card key={queue.name}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <Link to="/queues/$queueName" params={{ queueName: queue.name }}>
                  <CardTitle className="capitalize hover:text-blue-600 cursor-pointer">
                    {queue.name}
                  </CardTitle>
                </Link>
                <div className="flex items-center space-x-1">
                  <div
                    className={`h-2 w-2 rounded-full ${
                      queue.status === 'paused' ? 'bg-red-500' :
                      queue.status === 'failed' ? 'bg-red-500' : 'bg-green-500'
                    }`}
                  />
                  <span className="text-sm text-gray-500 capitalize">
                    {queue.status}
                  </span>
                </div>
              </div>
              <CardDescription>
                {queue.workers > 0 ? `${queue.workers} workers` : 'No workers'} •
                Last activity: {queue.lastActivity ? formatDate(queue.lastActivity) : 'Never'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Job Stats */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {formatNumber(queue.stats.waiting)}
                  </div>
                  <div className="text-sm text-gray-500">Waiting</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">
                    {formatNumber(queue.stats.active)}
                  </div>
                  <div className="text-sm text-gray-500">Active</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {formatNumber(queue.stats.completed)}
                  </div>
                  <div className="text-sm text-gray-500">Completed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {formatNumber(queue.stats.failed)}
                  </div>
                  <div className="text-sm text-gray-500">Failed</div>
                </div>
              </div>

              {/* Queue Actions */}
              <div className="flex flex-wrap gap-2">
                <Link to="/queues/$queueName" params={{ queueName: queue.name }}>
                  <Button
                    size="sm"
                    variant="outline"
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Details
                  </Button>
                </Link>

                {queue.status === 'paused' ? (
                  <Button
                    size="sm"
                    onClick={() => handleResumeQueue(queue.name)}
                    disabled={resumeQueueMutation.isPending}
                  >
                    <Play className="h-4 w-4 mr-1" />
                    Resume
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePauseQueue(queue.name)}
                    disabled={pauseQueueMutation.isPending}
                  >
                    <Pause className="h-4 w-4 mr-1" />
                    Pause
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCleanQueue(queue.name)}
                  disabled={cleanQueueMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Clean
                </Button>
              </div>

              {/* Queue Summary */}
              {(queue.stats.waiting > 0 || queue.stats.failed > 0) && (
                <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    {queue.stats.waiting > 0 && (
                      <div className="flex items-center space-x-1">
                        <Clock className="h-4 w-4 text-blue-500" />
                        <span>{formatNumber(queue.stats.waiting)} jobs waiting</span>
                      </div>
                    )}
                    {queue.stats.failed > 0 && (
                      <div className="flex items-center space-x-1">
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span>{formatNumber(queue.stats.failed)} failed jobs</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {!queues?.length && (
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400">No queues found</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}