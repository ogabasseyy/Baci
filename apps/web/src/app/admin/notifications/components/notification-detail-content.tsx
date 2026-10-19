import { format } from 'date-fns';
import { Clock, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { notificationActionUrl } from '@/lib/notification-action-url';
import { cn } from '@/lib/utils';
import type { NotificationWithStats } from '@/types/notifications';
import { NotificationDeliveryStatus } from './notification-delivery-status';
import { getNotificationTypePresentation } from './notification-presentation';
import { getNotificationTargetLabel } from './notification-target-label';

export function NotificationDetailContent({
  notification,
}: {
  notification: NotificationWithStats;
}) {
  const type = getNotificationTypePresentation(notification.notification_type);
  const TypeIcon = type.icon;
  const actionUrl = notificationActionUrl.parse(notification.action_url);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Notification Content</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 p-4 border rounded-lg bg-muted/30">
            <TypeIcon className={cn('h-5 w-5 mt-0.5', type.iconClassName)} />
            <div className="flex-1">
              <h4 className="font-medium">{notification.title}</h4>
              <p className="text-sm text-muted-foreground mt-1">
                {notification.message}
              </p>
              {notification.action_label && (
                <p className="text-sm text-primary mt-2">
                  {notification.action_label}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Type</p>
              <Badge variant="outline" className={type.badge}>
                {notification.notification_type}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground">Priority</p>
              <p className="font-medium capitalize">{notification.priority}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Channels</p>
              <div className="flex gap-1 flex-wrap">
                {notification.channels.map((channel) => (
                  <Badge key={channel} variant="secondary" className="text-xs">
                    {channel === 'in_app'
                      ? 'In-App'
                      : channel === 'banner'
                        ? 'Banner'
                        : 'Push'}
                  </Badge>
                ))}
              </div>
            </div>
            {actionUrl && (
              <div>
                <p className="text-muted-foreground">Action URL</p>
                <a
                  href={actionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline text-xs break-all"
                >
                  {actionUrl}
                </a>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Delivery Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Target</p>
              <div className="flex items-center gap-1">
                <Users className="size-4" />
                <span className="font-medium capitalize">
                  {getNotificationTargetLabel(notification)}
                </span>
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <NotificationDeliveryStatus notification={notification} />
              {notification.delivery_state !== 'sent' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Delivery attempts: {notification.delivery_attempts}
                </p>
              )}
              {notification.delivery_last_error &&
                notification.delivery_state === 'failed' && (
                  <p className="mt-1 text-xs text-destructive">
                    Delivery could not be completed:{' '}
                    {notification.delivery_last_error}
                  </p>
                )}
            </div>
            <DateDetail label="Created" value={notification.created_at} />
            {notification.sent_at && (
              <DateDetail label="Sent" value={notification.sent_at} />
            )}
            {notification.scheduled_for && !notification.sent_at && (
              <DateDetail
                label="Scheduled For"
                value={notification.scheduled_for}
                icon
              />
            )}
            {notification.expires_at && (
              <DateDetail label="Expires" value={notification.expires_at} />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DateDetail({
  icon = false,
  label,
  value,
}: {
  icon?: boolean;
  label: string;
  value: string;
}) {
  const text = format(new Date(value), 'MMM d, yyyy HH:mm');
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      {icon ? (
        <div className="flex items-center gap-1">
          <Clock className="size-4" />
          <span className="font-medium">{text}</span>
        </div>
      ) : (
        <p className="font-medium">{text}</p>
      )}
    </div>
  );
}
