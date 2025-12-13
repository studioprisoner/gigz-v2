import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Settings,
  RefreshCw,
  Activity,
  Users,
  Search,
  Mail,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Power
} from 'lucide-react';

export function WorkersPage() {
  const { data: workersData, isLoading, refetch } = trpc.listWorkers.useQuery();

  const controlWorkerMutation = trpc.controlWorker.useMutation({
    onSuccess: () => refetch(),
  });

  const updateWorkerConfigMutation = trpc.updateWorkerConfig.useMutation({
    onSuccess: () => refetch(),
  });

  const handleWorkerAction = async (workerId: string, action: 'start' | 'stop' | 'pause' | 'resume' | 'restart') => {
    try {
      await controlWorkerMutation.mutateAsync({ workerId, action });
    } catch (error) {
      console.error(`Failed to ${action} worker:`, error);
    }
  };

  const handleToggleWorker = async (workerId: string, enabled: boolean) => {
    try {
      await updateWorkerConfigMutation.mutateAsync({
        workerId,
        configuration: { enabled }
      });
    } catch (error) {
      console.error(`Failed to ${enabled ? 'enable' : 'disable'} worker:`, error);
    }
  };

  const getWorkerIcon = (type: string) => {
    switch (type) {
      case 'scraper':
        return <Search className="h-5 w-5" />;
      case 'notification':
        return <Activity className="h-5 w-5" />;
      case 'email':
        return <Mail className="h-5 w-5" />;
      default:
        return <Users className="h-5 w-5" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'stopped':
        return <XCircle className="h-4 w-4 text-gray-500" />;
      case 'paused':
        return <Pause className="h-4 w-4 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (status) {
      case 'running':
        return 'default';
      case 'stopped':
        return 'secondary';
      case 'error':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Workers Management</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Control and monitor background workers and scrapers
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
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

  const workers = workersData?.workers || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Workers Management</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Control and monitor background workers and scrapers
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

      {/* Scraper Overview */}
      <div className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Search className="h-5 w-5" />
              <span>Scrapers for Initial Launch</span>
            </CardTitle>
            <CardDescription>
              Control which scrapers are active. Disabled scrapers won't consume resources.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {workers.filter((worker: any) => worker.type === 'scraper').map((scraper: any) => (
                <div
                  key={scraper.id}
                  className={`p-3 border rounded-lg ${scraper.enabled ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <Search className={`h-4 w-4 ${scraper.enabled ? 'text-green-600' : 'text-gray-400'}`} />
                      <span className="font-medium text-sm">{scraper.name}</span>
                    </div>
                    <Button
                      size="sm"
                      variant={scraper.enabled ? "outline" : "default"}
                      onClick={() => handleToggleWorker(scraper.id, !scraper.enabled)}
                      disabled={updateWorkerConfigMutation.isPending}
                      className="h-6 text-xs"
                    >
                      {scraper.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                  <div className="text-xs text-gray-600">
                    Status: <Badge variant={getStatusVariant(scraper.status)} className="text-xs">
                      {scraper.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Workers Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {workers.map((worker: any) => (
          <Card key={worker.id} className={!worker.enabled ? 'opacity-50' : ''}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {getWorkerIcon(worker.type)}
                  <CardTitle className="capitalize">{worker.name}</CardTitle>
                </div>
                <div className="flex items-center space-x-2">
                  {getStatusIcon(worker.status)}
                  <Badge variant={getStatusVariant(worker.status)}>
                    {worker.status}
                  </Badge>
                </div>
              </div>
              <CardDescription>
                {worker.type === 'scraper' && 'Concert data scraping service'}
                {worker.type === 'notification' && 'Push notification service'}
                {worker.type === 'email' && 'Email service'}
                {worker.type === 'general' && 'General background processing'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Worker Stats */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {worker.processedJobs}
                  </div>
                  <div className="text-sm text-gray-500">Processed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {worker.failedJobs}
                  </div>
                  <div className="text-sm text-gray-500">Failed</div>
                </div>
              </div>

              {/* Worker Configuration */}
              <div className="space-y-2 mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Concurrency:</span>
                  <span className="font-medium">{worker.configuration.concurrency}</span>
                </div>
                {worker.configuration.rateLimits && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Rate Limit:</span>
                    <span className="font-medium">
                      {worker.configuration.rateLimits.requests}/
                      {Math.round(worker.configuration.rateLimits.windowMs / 1000)}s
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Last Activity:</span>
                  <span className="font-medium">
                    {worker.lastActivity ? formatDate(worker.lastActivity) : 'Never'}
                  </span>
                </div>
              </div>

              {/* Enable/Disable Toggle */}
              <div className="mb-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                  <div className="flex items-center space-x-2">
                    <Power className={`h-4 w-4 ${worker.enabled ? 'text-green-500' : 'text-gray-400'}`} />
                    <span className="text-sm font-medium">
                      Worker {worker.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={worker.enabled ? "destructive" : "default"}
                    onClick={() => handleToggleWorker(worker.id, !worker.enabled)}
                    disabled={updateWorkerConfigMutation.isPending}
                  >
                    {worker.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </div>

              {/* Worker Controls */}
              <div className="flex flex-wrap gap-2">
                {worker.status === 'stopped' ? (
                  <Button
                    size="sm"
                    onClick={() => handleWorkerAction(worker.id, 'start')}
                    disabled={controlWorkerMutation.isPending || !worker.enabled}
                  >
                    <Play className="h-4 w-4 mr-1" />
                    Start
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleWorkerAction(worker.id, 'stop')}
                    disabled={controlWorkerMutation.isPending}
                  >
                    <Square className="h-4 w-4 mr-1" />
                    Stop
                  </Button>
                )}

                {worker.status === 'paused' ? (
                  <Button
                    size="sm"
                    onClick={() => handleWorkerAction(worker.id, 'resume')}
                    disabled={controlWorkerMutation.isPending || !worker.enabled}
                  >
                    <Play className="h-4 w-4 mr-1" />
                    Resume
                  </Button>
                ) : worker.status === 'running' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleWorkerAction(worker.id, 'pause')}
                    disabled={controlWorkerMutation.isPending}
                  >
                    <Pause className="h-4 w-4 mr-1" />
                    Pause
                  </Button>
                ) : null}

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleWorkerAction(worker.id, 'restart')}
                  disabled={controlWorkerMutation.isPending || !worker.enabled}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Restart
                </Button>
              </div>

              {/* Worker Type Specific Info */}
              {worker.type === 'scraper' && (
                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                  <div className="text-sm text-blue-800 dark:text-blue-200">
                    <div className="flex items-center space-x-1 mb-1">
                      <Search className="h-4 w-4" />
                      <span className="font-medium">Scraper Service</span>
                    </div>
                    <p className="text-xs">
                      Automatically collects concert data from external sources.
                      Can be disabled if not needed initially.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {!workers.length && (
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400">No workers found</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}