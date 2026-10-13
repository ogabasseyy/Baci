'use client';

import { Bell } from 'lucide-react';
import { FollowUpAlertSetting } from '@/components/notifications/follow-up-alert-setting';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type {
  NotificationPreferences,
  UpdatePreferencesInput,
} from '@/types/notifications';

interface NotificationChannelsCardProps {
  onUpdate: (updates: UpdatePreferencesInput) => void;
  preferences: NotificationPreferences;
}

export function NotificationChannelsCard({
  onUpdate,
  preferences,
}: NotificationChannelsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-5" />
          Notification Channels
        </CardTitle>
        <CardDescription>
          Choose how you want to receive notifications
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="in_app">In-App Notifications</Label>
            <p className="text-sm text-muted-foreground">
              Show notifications in the notification center
            </p>
          </div>
          <Switch
            id="in_app"
            checked={preferences.in_app_enabled}
            onCheckedChange={(checked) => onUpdate({ in_app_enabled: checked })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="banner">Banner Notifications</Label>
            <p className="text-sm text-muted-foreground">
              Show important notifications as banners at the top of the
              dashboard
            </p>
          </div>
          <Switch
            id="banner"
            checked={preferences.banner_enabled}
            onCheckedChange={(checked) => onUpdate({ banner_enabled: checked })}
          />
        </div>

        <FollowUpAlertSetting
          enabled={preferences.follow_up_notifications_enabled}
          onCheckedChange={(checked) =>
            onUpdate({ follow_up_notifications_enabled: checked })
          }
        />
      </CardContent>
    </Card>
  );
}
