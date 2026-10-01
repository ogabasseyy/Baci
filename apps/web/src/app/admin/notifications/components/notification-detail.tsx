'use client';

import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  BarChart3,
  CheckCircle,
  Eye,
  Loader2,
  Send,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { NotificationWithStats } from '@/types/notifications';
import { canCancelAdminNotification } from './notification-cancellation';
import type { NotificationDeliveryRecord } from './notification-delivery-record';
import { NotificationDeliveryStatus } from './notification-delivery-status';
import { NotificationDetailContent } from './notification-detail-content';
import { NotificationDetailDeliveries } from './notification-detail-deliveries';

const statCards = [
  { key: 'total_sent', label: 'Total Sent', icon: Send },
  { key: 'total_push_sent', label: 'Push Accepted', icon: Send },
  { key: 'total_read', label: 'Read', icon: Eye },
  { key: 'total_dismissed', label: 'Dismissed', icon: CheckCircle },
  { key: 'read_rate', label: 'Read Rate', icon: BarChart3 },
] as const;

export function NotificationDetail({
  deliveries,
  isDeleting,
  notification,
  onDelete,
}: {
  deliveries: NotificationDeliveryRecord[];
  isDeleting: boolean;
  notification: NotificationWithStats;
  onDelete: () => void;
}) {
  const canCancel = canCancelAdminNotification(notification);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link
              aria-label="Back to notifications"
              href="/admin/notifications"
            >
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                {notification.title}
              </h1>
              <NotificationDeliveryStatus notification={notification} />
            </div>
            <p className="text-muted-foreground">
              Created{' '}
              {formatDistanceToNow(new Date(notification.created_at), {
                addSuffix: true,
              })}
            </p>
          </div>
        </div>
        {canCancel && (
          <Button
            variant="destructive"
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="size-4 mr-2" />
            )}
            Cancel Pending
          </Button>
        )}
      </div>
      {notification.sent_at && (
        <div className="grid gap-4 md:grid-cols-5">
          {statCards.map(({ icon: Icon, key, label }) => (
            <Card key={key}>
              <CardHeader className="flex flex-row items-center justify-between gap-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{label}</CardTitle>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {notification.stats?.[key] || 0}
                  {key === 'read_rate' ? '%' : ''}
                </div>
                {key === 'read_rate' && (
                  <Progress
                    value={notification.stats?.read_rate || 0}
                    className="mt-2"
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <NotificationDetailContent notification={notification} />
      {notification.sent_at && (
        <NotificationDetailDeliveries deliveries={deliveries} />
      )}
    </div>
  );
}
