'use client';

import { formatDistanceToNow } from 'date-fns';
import { CheckCheck, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { NotificationBell } from '@/components/ui/notification-bell';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '@/hooks/use-notifications';
import { notificationActionUrl } from '@/lib/notification-action-url';
import { cn } from '@/lib/utils';
import type {
  MerchantNotificationWithDetails,
  NotificationType,
} from '@/types/notifications';

interface NotificationCenterProps {
  className?: string;
}

const typeStyles: Record<NotificationType, string> = {
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  success:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  warning:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const typeDotStyles: Record<NotificationType, string> = {
  info: 'bg-blue-500',
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
};

/**
 * NotificationCenter - Bell icon with dropdown showing recent notifications
 *
 * Features:
 * - Unread count badge
 * - Real-time updates via Supabase Broadcast
 * - Mark as read on click
 * - View all link
 */
export function NotificationCenter({ className }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, isLoading, markAsRead, markAllAsRead } =
    useNotifications();

  // Show only the 5 most recent notifications in the dropdown
  const recentNotifications = notifications.slice(0, 5);

  const handleNotificationClick = async (
    notification: MerchantNotificationWithDetails
  ) => {
    if (!notification.read_at) {
      await markAsRead(notification.id);
    }

    // If there's an action URL, navigate to it
    notificationActionUrl.open(notification.notification?.action_url);
  };

  const handleMarkAllAsRead = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await markAllAsRead();
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn(
            'relative h-11 w-11 min-w-[44px] min-h-[44px]',
            className
          )}
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
          <NotificationBell hasNotification={unreadCount > 0} size={20} />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-1 px-2 text-xs"
              onClick={handleMarkAllAsRead}
            >
              <CheckCheck className="size-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>

        {/* Notification List */}
        <ScrollArea className="h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-full py-8">
              <LoadingSpinner size={24} className="text-muted-foreground" />
            </div>
          ) : recentNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-8 text-muted-foreground">
              <NotificationBell size={32} className="mb-2 opacity-50" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : (
            <div className="py-1">
              {recentNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onClick={() => handleNotificationClick(notification)}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t px-4 py-2">
          <Link
            href="/dashboard/notifications"
            className="text-sm text-primary hover:underline flex items-center justify-center"
            onClick={() => setOpen(false)}
          >
            View all notifications
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface NotificationItemProps {
  notification: MerchantNotificationWithDetails;
  onClick: () => void;
}

function NotificationItem({ notification, onClick }: NotificationItemProps) {
  const isUnread = !notification.read_at;
  const notificationType =
    notification.notification?.notification_type || 'info';
  const actionUrl = notificationActionUrl.parse(
    notification.notification?.action_url
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors border-b last:border-b-0',
        isUnread && 'bg-muted/30'
      )}
    >
      <div className="flex gap-3">
        {/* Unread indicator */}
        <div className="shrink-0 mt-1">
          <div
            className={cn(
              'h-2 w-2 rounded-full',
              isUnread ? typeDotStyles[notificationType] : 'bg-transparent'
            )}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                'text-sm font-medium truncate',
                isUnread && 'font-semibold'
              )}
            >
              {notification.notification?.title}
            </p>
            <Badge
              variant="outline"
              className={cn('text-xs shrink-0', typeStyles[notificationType])}
            >
              {notificationType}
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {notification.notification?.message}
          </p>

          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(notification.created_at), {
                addSuffix: true,
              })}
            </span>

            {actionUrl && (
              <span className="text-xs text-primary flex items-center">
                <ExternalLink className="size-3 mr-0.5" />
                View
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
