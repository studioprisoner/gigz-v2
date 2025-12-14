import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Settings, Power, AlertTriangle, Activity,
  Music, Radio, Database, Globe,
  Sliders, RefreshCw, Clock
} from 'lucide-react';
import { coretrpc } from '@/lib/trpc';
import { formatDate } from '@/lib/utils';

const SERVICE_INFO = {
  setlistfm: {
    name: 'Setlist.fm',
    icon: Music,
    description: 'Concert setlists and tour dates',
    color: 'bg-green-500',
  },
  spotify: {
    name: 'Spotify',
    icon: Radio,
    description: 'Artist metadata and images',
    color: 'bg-emerald-500',
  },
  musicbrainz: {
    name: 'MusicBrainz',
    icon: Database,
    description: 'Artist and release metadata',
    color: 'bg-purple-500',
  },
  bandsintown: {
    name: 'Bandsintown',
    icon: Globe,
    description: 'Upcoming concert announcements',
    color: 'bg-blue-500',
  },
  songkick: {
    name: 'Songkick',
    icon: Activity,
    description: 'Concert discovery and tracking',
    color: 'bg-pink-500',
  },
};

export function SettingsPage() {
  const utils = coretrpc.useUtils();
  const [configDialogOpen, setConfigDialogOpen] = useState<string | null>(null);

  const { data: settings, isLoading } = coretrpc.admin.settings.getScraperSettings.useQuery();

  const toggleService = coretrpc.admin.settings.toggleService.useMutation({
    onSuccess: () => {
      utils.admin.settings.getScraperSettings.invalidate();
    },
  });

  const updateService = coretrpc.admin.settings.updateService.useMutation({
    onSuccess: () => {
      utils.admin.settings.getScraperSettings.invalidate();
    },
  });

  const toggleMaintenance = coretrpc.admin.settings.toggleMaintenanceMode.useMutation({
    onSuccess: () => {
      utils.admin.settings.getScraperSettings.invalidate();
    },
  });

  const updateGlobal = coretrpc.admin.settings.updateGlobalSettings.useMutation({
    onSuccess: () => {
      utils.admin.settings.getScraperSettings.invalidate();
    },
  });

  if (isLoading || !settings) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="grid gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-40 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Scraper Settings</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Configure individual scraper services and global worker settings
          </p>
        </div>
        <Badge variant={settings.global.maintenanceMode ? 'destructive' : 'secondary'}>
          {settings.global.maintenanceMode ? 'Maintenance Mode' : 'Operational'}
        </Badge>
      </div>

      {/* Maintenance Mode Banner */}
      {settings.global.maintenanceMode && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Maintenance mode is enabled. All scrapers are paused.
          </AlertDescription>
        </Alert>
      )}

      {/* Global Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Global Controls
          </CardTitle>
          <CardDescription>
            System-wide settings that affect all scraper services
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Maintenance Mode</div>
              <div className="text-sm text-gray-500">
                Pause all scraper activity system-wide
              </div>
            </div>
            <Switch
              checked={settings.global.maintenanceMode}
              onCheckedChange={(checked) => toggleMaintenance.mutate({ enabled: checked })}
              disabled={toggleMaintenance.isPending}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="font-medium">Max Concurrent Jobs</div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{settings.global.maxConcurrentJobs}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const newValue = window.prompt(
                      'Enter max concurrent jobs (1-50):',
                      settings.global.maxConcurrentJobs.toString()
                    );
                    if (newValue && !isNaN(Number(newValue))) {
                      const value = Math.min(50, Math.max(1, Number(newValue)));
                      updateGlobal.mutate({ maxConcurrentJobs: value });
                    }
                  }}
                >
                  <Sliders className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="font-medium">Auto-retry Failed Jobs</div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={settings.global.retryFailedJobs}
                  onCheckedChange={(enabled) => updateGlobal.mutate({ retryFailedJobs: enabled })}
                />
                <span className="text-sm text-gray-500">
                  {settings.global.retryFailedJobs ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="font-medium">Retry Delay</div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-500" />
                <span className="font-medium">{settings.global.retryDelayMinutes} minutes</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const newValue = window.prompt(
                      'Enter retry delay in minutes (1-1440):',
                      settings.global.retryDelayMinutes.toString()
                    );
                    if (newValue && !isNaN(Number(newValue))) {
                      const value = Math.min(1440, Math.max(1, Number(newValue)));
                      updateGlobal.mutate({ retryDelayMinutes: value });
                    }
                  }}
                >
                  <Sliders className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Service Cards */}
      <div className="grid gap-4">
        {Object.entries(settings.services).map(([key, config]) => {
          const info = SERVICE_INFO[key as keyof typeof SERVICE_INFO];
          const Icon = info.icon;

          return (
            <Card key={key} className={!config.enabled ? 'opacity-75' : ''}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-lg ${info.color} text-white`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">{info.name}</h3>
                        <Badge variant={config.enabled ? 'default' : 'secondary'}>
                          {config.enabled ? 'Active' : 'Disabled'}
                        </Badge>
                        {key === 'setlistfm' && (
                          <Badge variant="outline" className="text-xs">
                            Production Ready
                          </Badge>
                        )}
                        {key !== 'setlistfm' && (
                          <Badge variant="outline" className="text-xs">
                            Planned
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-3">{info.description}</p>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">Rate:</span>{' '}
                          <span className="font-medium">{config.rateLimit}/s</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Daily Quota:</span>{' '}
                          <span className="font-medium">{config.dailyQuota.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Priority:</span>{' '}
                          <span className="font-medium">{config.priority}/10</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Modified:</span>{' '}
                          <span className="text-xs">{formatDate(config.lastModified)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfigDialogOpen(key)}
                    >
                      <Sliders className="h-4 w-4 mr-1" />
                      Configure
                    </Button>
                    <Switch
                      checked={config.enabled}
                      onCheckedChange={(enabled) => {
                        toggleService.mutate({ service: key as any, enabled });
                      }}
                      disabled={toggleService.isPending}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Audit Log */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Changes</CardTitle>
          <CardDescription>Audit log of setting modifications</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsAuditLog />
        </CardContent>
      </Card>

      {/* Service Configuration Dialog */}
      {configDialogOpen && (
        <ServiceConfigDialog
          service={configDialogOpen}
          config={settings.services[configDialogOpen as keyof typeof settings.services]}
          open={!!configDialogOpen}
          onClose={() => setConfigDialogOpen(null)}
          onSave={(config) => {
            updateService.mutate({
              service: configDialogOpen as any,
              config
            });
            setConfigDialogOpen(null);
          }}
        />
      )}
    </div>
  );
}

function SettingsAuditLog() {
  const { data: logs, isLoading } = coretrpc.admin.settings.getSettingsAuditLog.useQuery({ limit: 10 });

  if (isLoading) {
    return <div className="text-sm text-gray-500">Loading audit log...</div>;
  }

  if (!logs?.length) {
    return <p className="text-gray-500 text-sm">No recent changes</p>;
  }

  return (
    <div className="space-y-2">
      {logs.map((log, index) => (
        <div key={index} className="flex justify-between text-sm py-2 border-b last:border-0">
          <div>
            <span className="font-medium capitalize">{log.action.replace('_', ' ')}</span>
            {log.changes && (
              <span className="text-gray-500 ml-2">
                {JSON.stringify(log.changes)}
              </span>
            )}
          </div>
          <div className="text-gray-500 text-xs">
            {formatDate(log.timestamp)}
          </div>
        </div>
      ))}
    </div>
  );
}

interface ServiceConfigDialogProps {
  service: string;
  config: any;
  open: boolean;
  onClose: () => void;
  onSave: (config: any) => void;
}

function ServiceConfigDialog({ service, config, open, onClose, onSave }: ServiceConfigDialogProps) {
  const [localConfig, setLocalConfig] = useState(config);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Configure {service}</CardTitle>
          <CardDescription>Adjust service parameters</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Rate Limit (requests/second)</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.1"
                max="20"
                step="0.1"
                value={localConfig.rateLimit}
                onChange={(e) => setLocalConfig({ ...localConfig, rateLimit: parseFloat(e.target.value) })}
                className="flex-1"
              />
              <span className="w-16 text-right text-sm">{localConfig.rateLimit}</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Daily Quota</label>
            <input
              type="number"
              value={localConfig.dailyQuota}
              onChange={(e) => setLocalConfig({
                ...localConfig,
                dailyQuota: parseInt(e.target.value) || 0
              })}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Priority (1-10)</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={localConfig.priority}
                onChange={(e) => setLocalConfig({ ...localConfig, priority: parseInt(e.target.value) })}
                className="flex-1"
              />
              <span className="w-16 text-right text-sm">{localConfig.priority}</span>
            </div>
            <p className="text-xs text-gray-500">
              Higher priority services get more resources when quota is limited
            </p>
          </div>
        </CardContent>
        <div className="p-6 pt-0 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(localConfig)}>
            Save Changes
          </Button>
        </div>
      </Card>
    </div>
  );
}