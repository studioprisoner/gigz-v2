import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatNumber, formatDate } from '@/lib/utils';
import {
  Play,
  Pause,
  RotateCcw,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react';

export function QueuesPage() {
  // TODO: Implement real queue data fetching
  const queues: any[] = [];
  const isLoading = false;
  const refetch = () => console.log('Refetch queues');

  const pauseQueueMutation = { isPending: false };
  const resumeQueueMutation = { isPending: false };
  const retryJobMutation = { isPending: false };
  const cleanQueueMutation = { isPending: false };

  const handlePauseQueue = async (queueName: string) => {
    console.log('Pause queue:', queueName);
  };

  const handleResumeQueue = async (queueName: string) => {
    console.log('Resume queue:', queueName);
  };

  const handleRetryJob = async (queueName: string, jobId: string) => {
    console.log('Retry job:', queueName, jobId);
  };

  const handleCleanQueue = async (queueName: string) => {
    if (confirm('Are you sure you want to clean completed and failed jobs from this queue?')) {
      console.log('Clean queue:', queueName);
    }
  };

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
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Queue Management</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Monitor and manage background job queues
        </p>
      </div>

      {/* Queue Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {queues?.map((queue: any) => (
          <Card key={queue.name}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="capitalize">{queue.name}</CardTitle>
                <div className="flex items-center space-x-1">
                  <div
                    className={`h-2 w-2 rounded-full ${
                      queue.isPaused ? 'bg-red-500' : 'bg-green-500'
                    }`}
                  />
                  <span className="text-sm text-gray-500">
                    {queue.isPaused ? 'Paused' : 'Active'}
                  </span>
                </div>
              </div>
              <CardDescription>{queue.description || 'Background job processing'}</CardDescription>
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
                {queue.isPaused ? (
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

              {/* Recent Jobs */}
              {queue.recentJobs?.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                    Recent Jobs
                  </h4>
                  <div className="space-y-2">
                    {queue.recentJobs.slice(0, 3).map((job: any) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded"
                      >
                        <div className="flex items-center space-x-2">
                          {job.status === 'completed' && (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          )}
                          {job.status === 'failed' && (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                          {job.status === 'active' && (
                            <Clock className="h-4 w-4 text-yellow-500" />
                          )}
                          {job.status === 'waiting' && (
                            <AlertCircle className="h-4 w-4 text-blue-500" />
                          )}
                          <div>
                            <div className="text-sm font-medium truncate max-w-32">
                              {job.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {formatDate(job.processedOn || job.timestamp)}
                            </div>
                          </div>
                        </div>

                        {job.status === 'failed' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRetryJob(queue.name, job.id)}
                            disabled={retryJobMutation.isPending}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ))}
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