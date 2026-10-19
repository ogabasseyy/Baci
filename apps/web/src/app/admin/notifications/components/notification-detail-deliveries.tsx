import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { NotificationDeliveryRecord } from './notification-delivery-record';

export function NotificationDetailDeliveries({
  deliveries,
}: {
  deliveries: NotificationDeliveryRecord[];
}) {
  if (deliveries.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery Status</CardTitle>
        <CardDescription>
          Durable in-app and banner records, plus read status. Push delivery is
          tracked separately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Merchant</TableHead>
              <TableHead>In-app created</TableHead>
              <TableHead>Read</TableHead>
              <TableHead>Dismissed</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((delivery) => (
              <TableRow key={delivery.id}>
                <TableCell>
                  <span className="font-medium">{delivery.business_name}</span>
                </TableCell>
                <TableCell>{relativeDate(delivery.created_at)}</TableCell>
                <TableCell>
                  {delivery.read_at ? relativeDate(delivery.read_at) : '-'}
                </TableCell>
                <TableCell>
                  {delivery.dismissed_at
                    ? relativeDate(delivery.dismissed_at)
                    : '-'}
                </TableCell>
                <TableCell>
                  {delivery.dismissed_at ? (
                    <Badge variant="secondary">Dismissed</Badge>
                  ) : delivery.read_at ? (
                    <Badge className="bg-green-600">Read</Badge>
                  ) : (
                    <Badge variant="outline">Unread</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function relativeDate(value: string) {
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}
