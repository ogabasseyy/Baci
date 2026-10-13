'use client';

import { format, formatDistanceToNow } from 'date-fns';
import { Eye, MoreHorizontal, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  NotificationPriority,
  NotificationWithStats,
} from '@/types/notifications';
import { canCancelAdminNotification } from './notification-cancellation';
import { NotificationDeliveryStatus } from './notification-delivery-status';
import { getNotificationTypePresentation } from './notification-presentation';
import { getNotificationTargetLabel } from './notification-target-label';

const priorityStyles: Record<NotificationPriority, string> = {
  low: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  normal: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  urgent: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export function NotificationListTable({
  notifications,
  onDelete,
  onView,
}: {
  notifications: NotificationWithStats[];
  onDelete: (id: string) => void;
  onView: (id: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Read Rate</TableHead>
          <TableHead>Date</TableHead>
          <TableHead className="w-[50px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {notifications.map((notification) => {
          const canCancel = canCancelAdminNotification(notification);
          const type = getNotificationTypePresentation(
            notification.notification_type
          );
          const date = notification.sent_at
            ? formatDistanceToNow(new Date(notification.sent_at), {
                addSuffix: true,
              })
            : notification.scheduled_for
              ? format(
                  new Date(notification.scheduled_for),
                  'MMM d, yyyy HH:mm'
                )
              : formatDistanceToNow(new Date(notification.created_at), {
                  addSuffix: true,
                });
          return (
            <TableRow key={notification.id}>
              <TableCell>
                <div className="max-w-[200px]">
                  <p className="font-medium truncate">{notification.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {notification.message}
                  </p>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={type.badge}>
                  {notification.notification_type}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={priorityStyles[notification.priority]}
                >
                  {notification.priority}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1 text-sm">
                  <Users className="size-3" />
                  {getNotificationTargetLabel(notification)}
                </div>
              </TableCell>
              <TableCell>
                <NotificationDeliveryStatus notification={notification} />
              </TableCell>
              <TableCell>
                {notification.sent_at ? (
                  <span className="text-sm">
                    {notification.stats?.read_rate || 0}%
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">{date}</span>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="size-4" />
                      <span className="sr-only">
                        Open actions for {notification.title}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onView(notification.id)}>
                      <Eye className="size-4 mr-2" />
                      View Details
                    </DropdownMenuItem>
                    {canCancel && (
                      <DropdownMenuItem
                        onClick={() => onDelete(notification.id)}
                        className="text-red-600"
                      >
                        <Trash2 className="size-4 mr-2" />
                        Cancel Pending
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
