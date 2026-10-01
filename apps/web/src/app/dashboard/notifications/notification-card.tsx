'use client';

import { formatDistanceToNow } from 'date-fns';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  Info,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { notificationActionUrl } from '@/lib/notification-action-url';
import { cn } from '@/lib/utils';
import type {
  MerchantNotificationWithDetails,
  NotificationType,
} from '@/types/notifications';

const typeStyles: Record<NotificationType, { bg: string; icon: typeof Info }> =
  {
    info: {
      bg: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      icon: Info,
    },
    success: {
      bg: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      icon: CheckCircle,
    },
    warning: {
      bg: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      icon: AlertTriangle,
    },
    error: {
      bg: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      icon: AlertCircle,
    },
  };

export function NotificationCard({
  notification,
  onDismiss,
  onMarkAsRead,
}: {
  notification: MerchantNotificationWithDetails;
  onDismiss: () => void;
  onMarkAsRead: () => void;
}) {
  const isUnread = !notification.read_at;
  const type = notification.notification?.notification_type || 'info';
  const typeStyle = typeStyles[type];
  const Icon = typeStyle.icon;
  const title = notification.notification?.title || 'Notification';
  const actionUrl = notificationActionUrl.parse(
    notification.notification?.action_url
  );
  const openAction = () => {
    onMarkAsRead();
    notificationActionUrl.open(notification.notification?.action_url);
  };

  return (
    <div
      className={cn(
        'border rounded-lg transition-colors hover:bg-muted/50',
        isUnread && 'bg-muted/30 border-primary/20'
      )}
    >
      <button
        type="button"
        className="flex w-full gap-4 p-4 text-left"
        onClick={openAction}
        aria-label={`Open notification: ${title}`}
      >
        <div className={cn('shrink-0 p-2 rounded-full', typeStyle.bg)}>
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4
                  className={cn(
                    'font-medium truncate',
                    isUnread && 'font-semibold'
                  )}
                >
                  {title}
                </h4>
                {isUnread && (
                  <>
                    <span
                      className="shrink-0 size-2 bg-primary rounded-full"
                      aria-hidden="true"
                    />
                    <span className="sr-only">Unread</span>
                  </>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {notification.notification?.message}
              </p>
            </div>
            <Badge variant="outline" className={cn('shrink-0', typeStyle.bg)}>
              {type}
            </Badge>
          </div>
          <span className="mt-3 block text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(notification.created_at), {
              addSuffix: true,
            })}
          </span>
        </div>
      </button>
      <div className="flex justify-end gap-2 px-4 pb-3">
        {actionUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={openAction}
          >
            <ExternalLink className="size-3 mr-1" aria-hidden="true" />
            {notification.notification?.action_label || 'View'}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
