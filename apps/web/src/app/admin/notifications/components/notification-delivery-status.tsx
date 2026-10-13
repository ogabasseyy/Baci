import { Badge } from '@/components/ui/badge';
import type { NotificationWithStats } from '@/types/notifications';

export function NotificationDeliveryStatus({
  notification,
}: {
  notification: NotificationWithStats;
}) {
  if (notification.delivery_state === 'sent')
    return <Badge className="bg-green-600">Sent</Badge>;
  if (notification.delivery_state === 'processing')
    return <Badge>Processing</Badge>;
  if (notification.delivery_state === 'failed')
    return <Badge variant="destructive">Failed</Badge>;
  if (notification.delivery_state === 'expired')
    return <Badge variant="secondary">Expired</Badge>;
  if (notification.scheduled_for)
    return (
      <Badge variant="outline" className="border-orange-500 text-orange-600">
        {new Date(notification.scheduled_for) <= new Date()
          ? 'Queued'
          : 'Scheduled'}
      </Badge>
    );
  return <Badge variant="secondary">Draft</Badge>;
}
