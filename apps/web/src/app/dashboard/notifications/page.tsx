'use client';

import { Bell, CheckCheck, Settings } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { BagLoader } from '@/components/ui/bag-loader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useNotifications } from '@/hooks/use-notifications';
import type { NotificationType } from '@/types/notifications';
import { NotificationCard } from './notification-card';

export default function NotificationsPage() {
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    hasMore,
    markAsRead,
    markAllAsRead,
    dismiss,
    loadMore,
    refetch,
  } = useNotifications();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [typeFilter, setTypeFilter] = useState<NotificationType | 'all'>('all');
  const filteredNotifications = notifications.filter((notification) => {
    if (filter === 'unread' && notification.read_at) return false;
    return (
      typeFilter === 'all' ||
      notification.notification?.notification_type === typeFilter
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-linear-to-r from-primary via-purple-500 to-blue-600 bg-clip-text text-transparent">
            Notifications 🔔
          </h1>
          <p className="text-muted-foreground">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
              : 'All caught up!'}
          </p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button variant="outline" onClick={() => void markAllAsRead()}>
              <CheckCheck className="size-4 mr-2" />
              Mark All Read
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link href="/dashboard/notifications/preferences">
              <Settings className="size-4 mr-2" />
              Preferences
            </Link>
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">All Notifications</CardTitle>
            <div className="flex gap-2">
              <Select
                value={filter}
                onValueChange={(value) => setFilter(value as 'all' | 'unread')}
              >
                <SelectTrigger
                  aria-label="Notification read status"
                  className="w-[120px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="unread">Unread</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={typeFilter}
                onValueChange={(value) =>
                  setTypeFilter(value as NotificationType | 'all')
                }
              >
                <SelectTrigger
                  aria-label="Notification type"
                  className="w-[120px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div
              className="flex items-center justify-center py-12"
              role="status"
              aria-live="polite"
            >
              <BagLoader size={32} />
              <span className="sr-only">Loading notifications</span>
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
            >
              <p className="font-medium">Notifications could not load.</p>
              <p>{error}</p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => void refetch()}
              >
                Try again
              </Button>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="text-center py-12">
              <Bell
                className="size-12 mx-auto mb-4 text-muted-foreground opacity-50"
                aria-hidden="true"
              />
              <h3 className="text-lg font-medium mb-1">No notifications</h3>
              <p className="text-muted-foreground">
                {filter === 'unread'
                  ? "You've read all your notifications"
                  : "You don't have any notifications yet"}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredNotifications.map((notification) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={() => {
                    if (!notification.read_at) void markAsRead(notification.id);
                  }}
                  onDismiss={() => void dismiss(notification.id)}
                />
              ))}
              {hasMore && (
                <div className="pt-4 text-center">
                  <Button variant="outline" onClick={() => void loadMore()}>
                    Load More
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
