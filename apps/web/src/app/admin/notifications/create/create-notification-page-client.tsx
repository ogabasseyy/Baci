'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useSyncExternalStore } from 'react';
import { useToast } from '@/hooks/use-toast';
import { apiPost } from '@/lib/api-client';
import {
  createNotificationSchema,
  dateTimeLocalToUtcIso,
} from '@/schemas/notifications';
import type {
  CreateNotificationInput,
  NotificationChannel,
} from '@/types/notifications';
import { CreateNotificationForm } from '../components/create-notification-form';

interface CreateNotificationResponse {
  scheduled_for?: string | null;
  status: 'queued' | 'scheduled' | (string & {});
}

// biome-ignore lint/suspicious/noEmptyBlockStatements: useSyncExternalStore requires a no-op subscription.
const subscribeToNothing = () => () => {};
const getMinDateTimeServerSnapshot = () => '';

function useMinDateTime() {
  const cacheRef = useRef<string | null>(null);
  const getClientSnapshot = () => {
    if (cacheRef.current === null) {
      cacheRef.current = new Date(
        Date.now() - new Date().getTimezoneOffset() * 60000
      )
        .toISOString()
        .slice(0, 16);
    }
    return cacheRef.current;
  };
  return useSyncExternalStore(
    subscribeToNothing,
    getClientSnapshot,
    getMinDateTimeServerSnapshot
  );
}

export function CreateNotificationPageClient({
  canTargetSpecificMerchants,
}: {
  canTargetSpecificMerchants: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<CreateNotificationInput>({
    title: '',
    message: '',
    notification_type: 'info',
    priority: 'normal',
    target_type: 'all',
    channels: ['in_app'],
  });
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [expiresEnabled, setExpiresEnabled] = useState(false);
  const minDateTime = useMinDateTime();
  const updateFormData = (updates: Partial<CreateNotificationInput>) =>
    setFormData((current) => ({ ...current, ...updates }));
  const toggleChannel = (channel: NotificationChannel) => {
    const channels = formData.channels.includes(channel)
      ? formData.channels.filter((value) => value !== channel)
      : [...formData.channels, channel];
    updateFormData({ channels: channels.length ? channels : ['in_app'] });
  };
  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (scheduleEnabled && !formData.scheduled_for) {
      toast({
        title: 'Error',
        description: 'Please select a schedule date and time',
        variant: 'destructive',
      });
      return;
    }

    // The datetime input's min can become stale while the form is open. Check
    // the local value against the current clock before queueing a broadcast.
    if (
      scheduleEnabled &&
      formData.scheduled_for &&
      new Date(formData.scheduled_for).getTime() <= Date.now()
    ) {
      toast({
        title: 'Error',
        description: 'Please select a future schedule date and time',
        variant: 'destructive',
      });
      return;
    }
    if (expiresEnabled && !formData.expires_at) {
      toast({
        title: 'Error',
        description: 'Please select an expiration date and time',
        variant: 'destructive',
      });
      return;
    }
    let normalizedPayload: CreateNotificationInput;
    try {
      normalizedPayload = {
        ...formData,
        scheduled_for:
          scheduleEnabled && formData.scheduled_for
            ? dateTimeLocalToUtcIso(formData.scheduled_for)
            : undefined,
        expires_at:
          expiresEnabled && formData.expires_at
            ? dateTimeLocalToUtcIso(formData.expires_at)
            : undefined,
      };
    } catch {
      toast({
        title: 'Error',
        description: 'Please enter a valid date and time',
        variant: 'destructive',
      });
      return;
    }
    const parsed = createNotificationSchema.safeParse(normalizedPayload);
    if (!parsed.success) {
      toast({
        title: 'Error',
        description:
          parsed.error.issues[0]?.message ?? 'Please check the notification',
        variant: 'destructive',
      });
      return;
    }
    setIsSubmitting(true);
    void apiPost<CreateNotificationResponse>(
      '/api/admin/notifications',
      parsed.data
    )
      .then((result) => {
        toast({
          title:
            result.status === 'queued'
              ? 'Notification Queued'
              : 'Notification Scheduled',
          description:
            result.status === 'queued'
              ? 'Notification has been queued for delivery'
              : result.scheduled_for
                ? `Scheduled for ${new Date(result.scheduled_for).toLocaleString()}`
                : 'Notification has been scheduled',
        });
        router.push('/admin/notifications');
      })
      .catch((error: unknown) => {
        console.error('Error creating notification:', error);
        toast({
          title: 'Error',
          description:
            error instanceof Error
              ? error.message
              : 'Failed to create notification',
          variant: 'destructive',
        });
      })
      .finally(() => setIsSubmitting(false));
  };
  return (
    <CreateNotificationForm
      canTargetSpecificMerchants={canTargetSpecificMerchants}
      expiresEnabled={expiresEnabled}
      formData={formData}
      isSubmitting={isSubmitting}
      minDateTime={minDateTime}
      onExpiresEnabledChange={setExpiresEnabled}
      onScheduleEnabledChange={setScheduleEnabled}
      onSubmit={onSubmit}
      onToggleChannel={toggleChannel}
      onUpdate={updateFormData}
      scheduleEnabled={scheduleEnabled}
    />
  );
}
