'use client';

import { ArrowLeft, Clock, Loader2, Send } from 'lucide-react';
import Link from 'next/link';
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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type {
  CreateNotificationInput,
  NotificationChannel,
  NotificationPriority,
  NotificationType,
} from '@/types/notifications';
import { CreateNotificationAudienceDelivery } from './create-notification-audience-delivery';
import { CreateNotificationSelect } from './create-notification-select';
import { getNotificationTypePresentation } from './notification-presentation';

interface CreateNotificationFormProps {
  canTargetSpecificMerchants: boolean;
  expiresEnabled: boolean;
  formData: CreateNotificationInput;
  isSubmitting: boolean;
  minDateTime: string;
  onExpiresEnabledChange: (enabled: boolean) => void;
  onScheduleEnabledChange: (enabled: boolean) => void;
  onSubmit: (event: React.FormEvent) => void;
  onToggleChannel: (channel: NotificationChannel) => void;
  onUpdate: (updates: Partial<CreateNotificationInput>) => void;
  scheduleEnabled: boolean;
}

export function CreateNotificationForm(props: CreateNotificationFormProps) {
  const {
    canTargetSpecificMerchants,
    expiresEnabled,
    formData,
    isSubmitting,
    minDateTime,
    onExpiresEnabledChange,
    onScheduleEnabledChange,
    onSubmit,
    onToggleChannel,
    onUpdate,
    scheduleEnabled,
  } = props;
  const type = getNotificationTypePresentation(formData.notification_type);
  const TypeIcon = type.icon;
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link aria-label="Back to notifications" href="/admin/notifications">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Create Notification
          </h1>
          <p className="text-muted-foreground">
            Queue a notification for merchant delivery
          </p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
            <CardDescription>Write the notification message</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                required
                placeholder="Enter notification title"
                value={formData.title}
                onChange={(event) => onUpdate({ title: event.target.value })}
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">
                {formData.title.length}/200
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message *</Label>
              <Textarea
                id="message"
                required
                placeholder="Enter notification message"
                value={formData.message}
                onChange={(event) => onUpdate({ message: event.target.value })}
                rows={4}
                maxLength={1000}
              />
              <p className="text-xs text-muted-foreground">
                {formData.message.length}/1000
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <CreateNotificationSelect
                label="Type"
                value={formData.notification_type}
                onValueChange={(notification_type) =>
                  onUpdate({
                    notification_type: notification_type as NotificationType,
                  })
                }
                options={[
                  ['info', 'Information'],
                  ['success', 'Success'],
                  ['warning', 'Warning'],
                  ['error', 'Error'],
                ]}
                id="notification-type"
              />
              <CreateNotificationSelect
                label="Priority"
                value={formData.priority}
                onValueChange={(priority) =>
                  onUpdate({ priority: priority as NotificationPriority })
                }
                options={[
                  ['low', 'Low'],
                  ['normal', 'Normal'],
                  ['high', 'High'],
                  ['urgent', 'Urgent'],
                ]}
                id="notification-priority"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="action-label">Action Label</Label>
                <Input
                  id="action-label"
                  value={formData.action_label || ''}
                  onChange={(event) =>
                    onUpdate({ action_label: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="action-url">Action URL</Label>
                <Input
                  id="action-url"
                  // The notification contract accepts same-site paths (for
                  // example `/dashboard/orders`) as well as HTTPS URLs. A
                  // native `url` input rejects those paths before our shared
                  // schema gets a chance to validate them.
                  type="text"
                  value={formData.action_url || ''}
                  onChange={(event) =>
                    onUpdate({ action_url: event.target.value || undefined })
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>
        <CreateNotificationAudienceDelivery
          canTargetSpecificMerchants={canTargetSpecificMerchants}
          expiresEnabled={expiresEnabled}
          formData={formData}
          minDateTime={minDateTime}
          onExpiresEnabledChange={onExpiresEnabledChange}
          onScheduleEnabledChange={onScheduleEnabledChange}
          onToggleChannel={onToggleChannel}
          onUpdate={onUpdate}
          scheduleEnabled={scheduleEnabled}
        />
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg p-4 bg-muted/30 flex items-start gap-3">
              <TypeIcon className={cn('size-5 mt-0.5', type.iconClassName)} />
              <div>
                <h4 className="font-medium">
                  {formData.title || 'Notification Title'}
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  {formData.message ||
                    'Notification message will appear here...'}
                </p>
                {formData.action_label && (
                  <span className="mt-2 inline-block text-sm text-primary underline-offset-4">
                    {formData.action_label}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" asChild>
            <Link href="/admin/notifications">Cancel</Link>
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {scheduleEnabled ? 'Scheduling...' : 'Queueing...'}
              </>
            ) : scheduleEnabled ? (
              <>
                <Clock className="size-4 mr-2" />
                Schedule Notification
              </>
            ) : (
              <>
                <Send className="size-4 mr-2" />
                Queue for Delivery
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
