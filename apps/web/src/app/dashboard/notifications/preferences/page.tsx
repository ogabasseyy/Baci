'use client';

import { AlertTriangle, ArrowLeft, RefreshCw, Save } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { NotificationChannelsCard } from '@/components/notifications/notification-channels-card';
import { BagLoader } from '@/components/ui/bag-loader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';
import type {
  NotificationPreferences,
  UpdatePreferencesInput,
} from '@/types/notifications';

export default function NotificationPreferencesPage() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [preferences, setPreferences] =
    useState<NotificationPreferences | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry token reloads preferences
  useEffect(() => {
    let isStale = false;

    fetch('/api/notifications/preferences')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to fetch preferences');
        }
        return response.json() as Promise<NotificationPreferences>;
      })
      .then((data) => {
        if (isStale) return;
        setPreferences(data);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (isStale) return;
        console.error('Error fetching preferences:', error);
        setLoadError('Failed to load notification preferences.');
        toast({
          title: 'Error',
          description: 'Failed to load notification preferences',
          variant: 'destructive',
        });
      })
      .finally(() => {
        if (isStale) return;
        setIsLoading(false);
      });

    return () => {
      isStale = true;
    };
  }, [toast, reloadToken]);

  const retryLoad = () => {
    setIsLoading(true);
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  const updatePreference = (updates: UpdatePreferencesInput) => {
    if (!preferences) return;
    setPreferences({ ...preferences, ...updates });
  };

  const handleSave = () => {
    if (!preferences) return;

    setIsSaving(true);
    fetchWithCsrf('/api/notifications/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        in_app_enabled: preferences.in_app_enabled,
        banner_enabled: preferences.banner_enabled,
        follow_up_notifications_enabled:
          preferences.follow_up_notifications_enabled,
        quiet_hours_start: preferences.quiet_hours_start,
        quiet_hours_end: preferences.quiet_hours_end,
        quiet_hours_time_zone: preferences.quiet_hours_time_zone,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to save preferences');
        }

        toast({
          title: 'Saved',
          description: 'Your notification preferences have been updated',
        });
      })
      .catch((error: unknown) => {
        console.error('Error saving preferences:', error);
        toast({
          title: 'Error',
          description: 'Failed to save notification preferences',
          variant: 'destructive',
        });
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <BagLoader size={32} />
      </div>
    );
  }

  if (loadError || !preferences) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/notifications">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Notification Preferences
            </h1>
            <p className="text-muted-foreground">
              Manage how you receive notifications
            </p>
          </div>
        </div>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="size-4" />
              {loadError || 'Failed to load notification preferences.'}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={retryLoad}
            >
              <RefreshCw className="size-4 mr-1.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/notifications">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Notification Preferences
          </h1>
          <p className="text-muted-foreground">
            Manage how you receive notifications
          </p>
        </div>
      </div>

      <NotificationChannelsCard
        onUpdate={updatePreference}
        preferences={preferences}
      />

      <Card>
        <CardHeader>
          <CardTitle>Quiet Hours</CardTitle>
          <CardDescription>
            Set times when you don't want to receive notification alerts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quiet_start">Start Time</Label>
              <Input
                id="quiet_start"
                type="time"
                value={preferences?.quiet_hours_start || ''}
                onChange={(e) =>
                  updatePreference({
                    quiet_hours_start: e.target.value || null,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quiet_end">End Time</Label>
              <Input
                id="quiet_end"
                type="time"
                value={preferences?.quiet_hours_end || ''}
                onChange={(e) =>
                  updatePreference({ quiet_hours_end: e.target.value || null })
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quiet_time_zone">Time Zone</Label>
            <Input
              id="quiet_time_zone"
              value={preferences?.quiet_hours_time_zone || 'Africa/Lagos'}
              onChange={(e) =>
                updatePreference({ quiet_hours_time_zone: e.target.value })
              }
              placeholder="Africa/Lagos"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            During quiet hours, notifications will still be delivered but won't
            show alerts.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <BagLoader size={16} />
              Saving…
            </>
          ) : (
            <>
              <Save className="size-4 mr-2" />
              Save Preferences
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
